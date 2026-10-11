// Fork-only persistence wrapper. Existing sponsor journal/state machine is not changed.
import { readFileSync, existsSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync, rmdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { openGiftSponsorLedger, SPONSOR_LEDGER_STATES } from "./gift-sponsor-service.mjs";

export function atomicForkJson(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  const fd = openSync(temp, "w", 0o600);
  try { writeSync(fd, JSON.stringify(data)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, file);
  const dir = openSync(path.dirname(file), "r");
  try { fsyncSync(dir); } finally { closeSync(dir); }
}

// Linux /proc is present in the Railway image. Unknown owner identity is NOT dead.
export function linuxProcessIdentity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${fields[19]}`;
  } catch (e) { if (e.code === "ENOENT" && existsSync("/proc/self/stat")) return null; throw new Error("OWNER_IDENTITY_UNKNOWN"); }
}

export function acquireForkOwner(file, { identity = linuxProcessIdentity, pid = process.pid } = {}) {
  const mine = { pid, start: identity(pid), token: randomUUID() };
  if (!mine.start) throw new Error("OWNER_IDENTITY_UNKNOWN");
  // Serializes creation AND stale takeover. A crash inside this tiny critical section
  // deliberately needs human attention, rather than a second unsafe stale-lock heuristic.
  const gate = `${file}.takeover`;
  try { mkdirSync(gate, { mode: 0o700 }); } catch { throw new Error("OWNER_TAKEOVER_BUSY"); }
  let recovered = false;
  try {
    if (existsSync(file)) {
      let old; try { old = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("OWNER_CORRUPT"); }
      if (!Number.isSafeInteger(old.pid) || old.pid < 1 || typeof old.start !== "string" || !old.start || typeof old.token !== "string") throw new Error("OWNER_CORRUPT");
      const live = identity(old.pid);
      if (live === old.start) throw new Error("OWNER_LIVE");
      // null = dead; different start = PID reused (not this lock's owner).
      if (live !== null && typeof live !== "string") throw new Error("OWNER_IDENTITY_UNKNOWN");
      unlinkSync(file);
      recovered = true;
    }
    const fd = openSync(file, "wx", 0o600);
    try { writeSync(fd, JSON.stringify(mine)); fsyncSync(fd); } finally { closeSync(fd); }
  } finally { rmdirSync(gate); }
  return { recovered, close() {
    const old = JSON.parse(readFileSync(file, "utf8"));
    if (old.token !== mine.token) throw new Error("OWNER_CHANGED");
    unlinkSync(file);
  } };
}

export function readForkCheckpoint(file) {
  const s = JSON.parse(readFileSync(file, "utf8"));
  if (s.v !== 1 || s.chainId !== 31337143 || typeof s.forkInstanceId !== "string" || !/^fork-143-[A-Za-z0-9-]+$/.test(s.forkInstanceId)
    || !Number.isSafeInteger(s.block) || s.block < 0 || typeof s.state !== "string"
    || createHash("sha256").update(s.state).digest("hex") !== s.sha256) throw new Error("CHECKPOINT_INVALID");
  return { forkInstanceId: s.forkInstanceId, block: s.block, snapshotHash: s.sha256 };
}

// Read-only inspection. Null receipts alone never authorize replay. Preserve ALL
// original journal rows; quarantine facts are additive and disable the worker.
export async function auditForkJournal(raw, checkpoint, inspect) {
  const old = raw.forkCheckpoint;
  const rows = [...Object.values(raw.entries), ...raw.archived];
  const hasHistory = rows.length > 0 || Object.keys(raw.gasTxs || {}).length > 0;
  const findings = raw.forkReview?.needsHuman && Array.isArray(raw.forkReview.findings) ? [...raw.forkReview.findings] : [];
  if (hasHistory && !old) findings.push({ reason: "checkpoint_missing" });
  const other = old && old.forkInstanceId !== checkpoint.forkInstanceId;
  const changed = !old || JSON.stringify(old) !== JSON.stringify(checkpoint);
  for (const row of rows) {
    if (other) { findings.push({ giftId: row.giftId, reason: "other_instance" }); continue; }
    try {
      const verdict = await inspect(row);
      if (verdict !== "ok") findings.push({ giftId: row.giftId, reason: verdict === "absent" ? "orphaned_by_restore" : "unexplained_mismatch" });
    } catch { findings.push({ giftId: row.giftId, reason: "chain_read_unknown" }); }
  }
  // Registration-only rows are also evidence, not disposable cache entries.
  for (const [giftId, hash] of Object.entries(raw.gasTxs || {})) {
    try {
      const verdict = other ? "unknown" : await inspect({ giftId, registrationTx: hash });
      if (verdict !== "ok") findings.push({ giftId, reason: verdict === "absent" ? "orphaned_by_restore" : "registration_unknown" });
    } catch { findings.push({ giftId, reason: "chain_read_unknown" }); }
  }
  if (other && hasHistory && findings.length === 0) findings.push({ reason: "other_instance" });
  if (raw.forkReview?.needsHuman) findings.push({ reason: "previous_quarantine" });
  return { changed, needsHuman: findings.length > 0, findings };
}

export async function openForkGiftJournal({ dir, checkpoint, inspect, ownerOptions }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "gift-sponsor-fork-ledger.json");
  const owner = acquireForkOwner(`${file}.owner`, ownerOptions);
  try {
    // Only a PROVEN dead owner lets this wrapper reclaim its legacy ledger lock.
    if (existsSync(`${file}.lock`)) {
      if (!owner.recovered) throw new Error("UNOWNED_LEDGER_LOCK");
      unlinkSync(`${file}.lock`);
    }
    if (owner.recovered && !existsSync(file)) throw new Error("FORK_LEDGER_MISSING");
    const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { version: 3, entries: {}, archived: [], gasTxs: {} };
    const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
    const hash = (x) => typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
    const row = (x) => object(x) && hash(x.giftId) && SPONSOR_LEDGER_STATES.includes(x.state);
    if (!object(raw) || raw.version !== 3 || !object(raw.entries) || !Array.isArray(raw.archived) || !object(raw.gasTxs)
      || Object.entries(raw.entries).some(([id, x]) => !row(x) || x.giftId !== id) || raw.archived.some((x) => !row(x))
      || Object.entries(raw.gasTxs).some(([id, tx]) => !hash(id) || !hash(tx))) throw new Error("FORK_LEDGER_CORRUPT");
    const review = await auditForkJournal(raw, checkpoint, inspect);
    raw.forkReview = review;
    if (!review.needsHuman) raw.forkCheckpoint = checkpoint;
    atomicForkJson(file, raw);
    if (review.needsHuman) throw new Error("FORK_RESTORE_NEEDS_HUMAN");
    const store = openGiftSponsorLedger(file);
    const close = store.close;
    store.close = () => { close(); owner.close(); };
    return store;
  } catch (e) { owner.close(); throw e; }
}
