// [A-869] giftId-scoped MON gas-delivery ledger (server side, file durable). Supersedes the A-858 version.
// NOT wired into server.mjs / api/grant.js (separate card). Sibling of ledger.mjs (address-scoped /grant).
//
// States:  PENDING (reserved, NOTHING signed)  ->  SENT (rawTx + nonce + txHash durable; broadcast allowed)
//          SENT -> CONFIRMED (explicit)        PENDING|SENT -> UNKNOWN (human decides)
//          UNKNOWN -> CONFIRMED only via resolveUnknownToConfirmed() (explicit, txHash must equal the recorded one).
//
// Discipline:
//  - single writer: `<path>.lock` O_EXCL; a leftover lock is never removed automatically (LEDGER_LOCKED);
//  - reserve() flushes BEFORE any send; a second reserve for a giftId is always refused (exactly once);
//  - caps (per-sender / global count + wei) are evaluated INSIDE reserve(), i.e. inside the same single-writer
//    critical section as the write; unset limits => LEDGER_LIMITS_UNSET (fail closed);
//  - rawTx + nonce are fixed per entry: recordSigned() only from PENDING, nonce unique across entries
//    => the same nonce can never be signed twice;
//  - flush = unique tmp (wx, 0600) -> write -> fsync(file) -> rename -> fsync(dir). Failure before the rename is
//    rolled back in memory (disk unchanged). Failure after the rename (dir fsync) => FAIL-STOP: every later
//    mutation throws LEDGER_FAILSTOP until the process restarts and re-reads the file;
//  - audit trail is append-only (appendAudit); entries are never deleted.

import {
  readFileSync, existsSync, lstatSync, mkdirSync, chmodSync,
  openSync, closeSync, writeSync, fsyncSync, renameSync, unlinkSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

const GIFT_ID = /^0x[0-9a-f]{64}$/;
const ADDR_LC = /^0x[0-9a-f]{40}$/;
const ADDR_ANY = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-f]{64}$/;
const RAW_TX = /^0x(?:[0-9a-f]{2})+$/;
const NONCE = /^(0|[1-9][0-9]{0,15})$/;
const REASON = /^[a-z_]{1,40}$/;
const STATES = new Set(["PENDING", "SENT", "CONFIRMED", "UNKNOWN"]);
export const AUDIT_ACTIONS = new Set(["NOTE", "VOID_REVIEWED", "CHAIN_CHECKED", "AUTO_UNKNOWN", "RESOLVED_CONFIRMED"]);

const defaultIo = { openSync, closeSync, writeSync, fsyncSync, renameSync, unlinkSync };

function validateData(parsed, path) {
  const bad0 = (why) => { throw new Error(`LEDGER_SCHEMA: ${why}: ${path}`); };
  if (typeof parsed.entries !== "object" || parsed.entries === null || Array.isArray(parsed.entries)) bad0("entries must be an object");
  if (!Array.isArray(parsed.audit)) bad0("audit must be an array");
  for (const a of parsed.audit) {
    if (typeof a !== "object" || a === null || typeof a.at !== "string" || !AUDIT_ACTIONS.has(a.action) || typeof a.note !== "string" || a.note.length > 200) bad0("audit record invalid");
    if (!(a.giftId === null || GIFT_ID.test(a.giftId))) bad0("audit giftId invalid");
  }
  const nonces = new Set();
  for (const [k, e] of Object.entries(parsed.entries)) {
    const bad = (why) => { throw new Error(`LEDGER_SCHEMA: ${why} (${k}): ${path}`); };
    if (!GIFT_ID.test(k)) bad("key must be a lowercase bytes32 giftId");
    if (typeof e !== "object" || e === null || Array.isArray(e)) bad("entry must be an object");
    if (e.giftId !== k) bad("giftId mismatch");
    if (typeof e.to !== "string" || !ADDR_LC.test(e.to)) bad("to must be a lowercase address");
    if (typeof e.sender !== "string" || !ADDR_LC.test(e.sender)) bad("sender must be a lowercase address");
    if (typeof e.valueWei !== "string" || !/^[0-9]+$/.test(e.valueWei) || BigInt(e.valueWei) <= 0n) bad("valueWei invalid");
    if (!STATES.has(e.state)) bad("state invalid");
    const signed = e.rawTx !== null || e.nonce !== null || e.txHash !== null;
    if (signed && !(typeof e.rawTx === "string" && RAW_TX.test(e.rawTx) && typeof e.nonce === "string" && NONCE.test(e.nonce) && typeof e.txHash === "string" && TX_HASH.test(e.txHash))) bad("rawTx/nonce/txHash must be all set or all null and well-formed");
    if ((e.state === "SENT" || e.state === "CONFIRMED") && !signed) bad(`${e.state} without rawTx/nonce/txHash`);
    if (e.state === "PENDING" && signed) bad("PENDING must not carry rawTx");
    if (!(e.reason === null || (typeof e.reason === "string" && REASON.test(e.reason)))) bad("reason invalid");
    if (e.nonce !== null) { if (nonces.has(e.nonce)) bad("duplicate nonce"); nonces.add(e.nonce); }
  }
}

function acquireWriterLock(path, io) {
  const lockPath = `${path}.lock`;
  let fd;
  try {
    fd = io.openSync(lockPath, "wx", 0o600);
  } catch (e) {
    if (e && e.code === "EEXIST") throw new Error(`LEDGER_LOCKED: another writer holds ${lockPath} (not removed automatically)`);
    throw new Error(`LEDGER_LOCK_FAILED: ${lockPath}`);
  }
  try { io.writeSync(fd, `${process.pid}\n`); } finally { io.closeSync(fd); }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    try { io.unlinkSync(lockPath); } catch { /* already gone */ }
  };
}

function ensureDir(dir, noCreate) {
  if (!existsSync(dir)) {
    if (noCreate) throw new Error(`LEDGER_DIR_INVALID: ${dir}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const st = lstatSync(dir);
  if (!st.isDirectory()) throw new Error(`LEDGER_DIR_INVALID: ${dir}`);
  if ((st.mode & 0o077) !== 0) {
    if (!noCreate) { try { chmodSync(dir, 0o700); } catch { /* checked below */ } }
    if ((lstatSync(dir).mode & 0o077) !== 0) throw new Error(`LEDGER_DIR_PERMS: ${dir} must be 0700`);
  }
}

const bigOrNull = (v) => { try { return typeof v === "bigint" ? v : (typeof v === "number" || typeof v === "string") ? BigInt(v) : null; } catch { return null; } };

export function openGiftGasLedger(path, opts = {}) {
  const io = { ...defaultIo, ...(opts.io ?? {}) };
  ensureDir(dirname(path), opts.noCreate === true);
  if (opts.noCreate === true && !existsSync(path)) throw new Error(`LEDGER_MISSING: ${path}`);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`LEDGER_SYMLINK: ${path}`);
  const release = acquireWriterLock(path, io);
  let data;
  try {
    if (!existsSync(path)) {
      data = { version: 2, entries: {}, audit: [] };
    } else {
      let raw;
      try { raw = readFileSync(path, "utf8"); } catch { throw new Error(`LEDGER_UNREADABLE: ${path}`); }
      let parsed;
      try { parsed = JSON.parse(raw); } catch { throw new Error(`LEDGER_CORRUPT: ${path}`); }
      if (parsed?.version !== 2) throw new Error(`LEDGER_UNKNOWN_VERSION: ${path}`);
      validateData(parsed, path);
      data = parsed;
    }
  } catch (e) {
    release();
    throw e;
  }

  let failStop = false;
  const now = () => new Date().toISOString();

  const writeAll = (fd, text) => {
    const buf = Buffer.from(text, "utf8");
    let off = 0;
    while (off < buf.length) off += io.writeSync(fd, buf, off, buf.length - off);
  };

  const flush = () => {
    const tmp = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    let fd; let dfd; let stage = "pre-rename";
    try {
      fd = io.openSync(tmp, "wx", 0o600);
      writeAll(fd, `${JSON.stringify(data, null, 2)}\n`);
      io.fsyncSync(fd);
      io.closeSync(fd); fd = undefined;
      io.renameSync(tmp, path);
      stage = "post-rename";
      dfd = io.openSync(dirname(path), "r");
      io.fsyncSync(dfd);
      io.closeSync(dfd); dfd = undefined;
    } catch {
      if (fd !== undefined) { try { io.closeSync(fd); } catch { /* ignore */ } }
      if (dfd !== undefined) { try { io.closeSync(dfd); } catch { /* ignore */ } }
      if (stage === "pre-rename") {
        try { io.unlinkSync(tmp); } catch { /* ignore */ }
        const err = new Error("LEDGER_FLUSH_FAILED");
        err.rollbackSafe = true; // disk unchanged
        throw err;
      }
      failStop = true; // disk state ambiguous (renamed but not proven durable)
      throw new Error("LEDGER_FAILSTOP: directory fsync failed; restart and re-read the ledger");
    }
  };

  /** All mutations: snapshot -> change -> flush; rollback in memory only when disk is provably unchanged. */
  const mutate = (fn) => {
    if (failStop) throw new Error("LEDGER_FAILSTOP");
    const snap = JSON.stringify(data);
    let result;
    try {
      result = fn();
      flush();
    } catch (e) {
      if (e && (e.rollbackSafe || !String(e.message).startsWith("LEDGER_FAILSTOP"))) data = JSON.parse(snap);
      throw e;
    }
    return result;
  };

  const key = (giftId) => {
    if (typeof giftId !== "string" || !GIFT_ID.test(giftId)) throw new Error("LEDGER_BAD_GIFT_ID");
    return giftId;
  };
  const raw = (giftId) => data.entries[key(giftId)] ?? null;
  const copy = (e) => (e === null ? null : structuredClone(e));
  const must = (giftId) => { const e = raw(giftId); if (!e) throw new Error("LEDGER_ENTRY_MISSING"); return e; };
  const audit = (giftId, action, note) => data.audit.push({ at: now(), giftId, action, note });

  return {
    has: (giftId) => raw(giftId) !== null,
    get: (giftId) => copy(raw(giftId)),
    count: () => Object.keys(data.entries).length,
    list: () => Object.values(data.entries).map(copy),
    auditTrail: () => structuredClone(data.audit),
    isFailStopped: () => failStop,
    /** Next nonce this ledger knows is free (max recorded + 1), or 0n. The caller takes max(chain, this). */
    nextSafeNonce: () => Object.values(data.entries).reduce((m, e) => (e.nonce !== null && BigInt(e.nonce) + 1n > m ? BigInt(e.nonce) + 1n : m), 0n),
    bindsTo: (giftId, to) => { const e = raw(giftId); return e === null || e.to === String(to).toLowerCase(); },

    /** Reserve BEFORE any signing/sending. Exactly once per giftId; caps checked inside the critical section. */
    reserve: (giftId, to, valueWei, sender, limits) => mutate(() => {
      const k = key(giftId);
      if (typeof to !== "string" || !ADDR_ANY.test(to)) throw new Error("LEDGER_BAD_DESTINATION");
      if (typeof sender !== "string" || !ADDR_ANY.test(sender)) throw new Error("LEDGER_BAD_SENDER");
      if (typeof valueWei !== "bigint" || valueWei <= 0n) throw new Error("LEDGER_BAD_VALUE");
      const L = limits ?? {};
      const lim = ["perSenderMaxCount", "perSenderMaxWei", "globalMaxCount", "globalMaxWei"].map((n) => bigOrNull(L[n]));
      if (lim.some((x) => x === null || x <= 0n)) throw new Error("LEDGER_LIMITS_UNSET");
      if (Object.prototype.hasOwnProperty.call(data.entries, k)) throw new Error("LEDGER_GIFT_ALREADY_RESERVED");
      const s = sender.toLowerCase();
      let gCount = 0n; let gWei = 0n; let sCount = 0n; let sWei = 0n;
      for (const e of Object.values(data.entries)) {
        const w = BigInt(e.valueWei);
        gCount += 1n; gWei += w;
        if (e.sender === s) { sCount += 1n; sWei += w; }
      }
      if (sCount + 1n > lim[0]) throw new Error("LEDGER_LIMIT_SENDER_COUNT");
      if (sWei + valueWei > lim[1]) throw new Error("LEDGER_LIMIT_SENDER_WEI");
      if (gCount + 1n > lim[2]) throw new Error("LEDGER_LIMIT_GLOBAL_COUNT");
      if (gWei + valueWei > lim[3]) throw new Error("LEDGER_LIMIT_GLOBAL_WEI");
      data.entries[k] = { giftId: k, to: to.toLowerCase(), sender: s, valueWei: valueWei.toString(), state: "PENDING", nonce: null, rawTx: null, txHash: null, reason: null, at: now() };
    }),

    /** Durable BEFORE broadcast. Only from PENDING (never overwrites an existing rawTx); nonce unique ledger-wide. */
    recordSigned: (giftId, { nonce, rawTx, txHash }) => mutate(() => {
      const e = must(giftId);
      if (e.state !== "PENDING") throw new Error("LEDGER_ALREADY_SIGNED_OR_FINAL");
      const n = typeof nonce === "bigint" ? nonce.toString() : String(nonce);
      if (!NONCE.test(n)) throw new Error("LEDGER_BAD_NONCE");
      if (typeof rawTx !== "string" || !RAW_TX.test(rawTx)) throw new Error("LEDGER_BAD_RAWTX");
      if (typeof txHash !== "string" || !TX_HASH.test(txHash)) throw new Error("LEDGER_BAD_TX_HASH");
      if (Object.values(data.entries).some((x) => x.nonce === n)) throw new Error("LEDGER_NONCE_REUSED");
      e.nonce = n; e.rawTx = rawTx; e.txHash = txHash; e.state = "SENT"; e.at = now();
    }),

    /** SENT -> CONFIRMED only. Never revives UNKNOWN. */
    confirm: (giftId, txHash) => mutate(() => {
      const e = must(giftId);
      if (e.state !== "SENT") throw new Error("LEDGER_BAD_TRANSITION");
      if (e.txHash !== txHash) throw new Error("LEDGER_TX_HASH_CONFLICT");
      e.state = "CONFIRMED"; e.at = now();
    }),

    markUnknown: (giftId, reason = "unspecified") => mutate(() => {
      const e = must(giftId);
      if (!REASON.test(reason)) throw new Error("LEDGER_BAD_REASON");
      if (e.state === "CONFIRMED") throw new Error("LEDGER_BAD_TRANSITION");
      if (e.state === "UNKNOWN") return;
      e.state = "UNKNOWN"; e.reason = reason; e.at = now();
      audit(e.giftId, "AUTO_UNKNOWN", reason);
    }),

    /** Explicit UNKNOWN -> CONFIRMED (operator/verified-receipt path). Requires the recorded txHash. */
    resolveUnknownToConfirmed: (giftId, txHash) => mutate(() => {
      const e = must(giftId);
      if (e.state !== "UNKNOWN" || e.txHash === null) throw new Error("LEDGER_BAD_TRANSITION");
      if (e.txHash !== txHash) throw new Error("LEDGER_TX_HASH_CONFLICT");
      e.state = "CONFIRMED"; e.reason = null; e.at = now();
      audit(e.giftId, "RESOLVED_CONFIRMED", "unknown_to_confirmed");
    }),

    /** Append-only. No state field is touched. Notes are short and must not look like a raw transaction. */
    appendAudit: (giftId, action, note = "") => mutate(() => {
      if (!AUDIT_ACTIONS.has(action)) throw new Error("LEDGER_BAD_AUDIT_ACTION");
      if (typeof note !== "string" || note.length > 200 || /0x[0-9a-fA-F]{100,}/.test(note)) throw new Error("LEDGER_BAD_AUDIT_NOTE");
      if (giftId !== null) must(giftId);
      audit(giftId, action, note);
    }),
    close: release,
  };
}
