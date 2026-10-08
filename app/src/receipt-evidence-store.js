// [A-868 / A-856 W2] Local evidence store for `araso_tx_evidence_v1` rows. LOCAL ONLY, no network, no indexer, no timers.
//
//   key       araso.txEvidence.v1.<chainId>   (separate from araso.receipts; that store is never read or written here)
//   envelope  { schema: "araso_tx_evidence_v1", v: 1, chainId, rows: [...] }
//   rows      append-only. A row is never deleted. A reorg marks the old row (class "reorged", supersededBy) and
//             appends the new observation. A broken row is kept VERBATIM across rewrites.
//   dedup     evidenceKey = "evidence|<chainId>|<txhash lower>|<logIndex|tx>"; one ACTIVE row per key.
//   fail      unreadable / unparseable / wrong-shape / wrong-chain / newer-version storage => { ok:false,
//   closed    reason:"store_unsound" } and NOTHING is written. Writes are verified by a re-read.
//   no throw  every method returns { ok, ... } (try/catch around each; hostile input => row_invalid).
//   limits    Row cap MAX_EVIDENCE_ROWS and byte cap MAX_EVIDENCE_BYTES => store_full (nothing written).
//   cross-tab [A-895 P-C / A-868] compare-and-set: immediately before setItem the stored text is re-read and must still equal the
//             text this call loaded; a write by another tab in between => store_unsound, nothing written (fail closed).
//             localStorage has no atomic CAS, so the only window left is the few synchronous instructions between that re-read
//             and setItem (RES-2 in <private>: ACCEPTED); the after-write re-read still catches later writers.
// Storage is injected (getItem/setItem). This module imports nothing.

export const EVIDENCE_SCHEMA = "araso_tx_evidence_v1";
export const EVIDENCE_STORE_VERSION = 1;
export const EVIDENCE_STORE_PREFIX = "araso.txEvidence.v1.";
const COMMIT_RANK = { proposed: 1, voted: 2, finalized: 3 };
const UNSETTLED = new Set(["unknown", "not_found", null, undefined]);
// Caller-writable fields (whitelist). Store-owned: class, reason, conflict, supersededBy, rowId, evidenceKey, identity.
const WRITABLE = ["journey", "status", "blockNumber", "blockHash", "txIndex", "commitState", "trust", "tagUsed", "nonce", "nonceConsumed",
  "gasLimit", "gasUsedReported", "feeByReceipt", "feeByLimit", "feeBasis", "balanceBefore", "balanceAfter", "revert", "source", "observedAt", "canonical"];
// Row-count cap (includes superseded and broken rows). Each call parses the whole envelope, so it is bounded.
// Past the cap, writes that would add a row return { ok:false, reason:"store_full" } and nothing is written.
export const MAX_EVIDENCE_ROWS = 2000;
// [A-895 P-C / A-887 I3] Byte bound on the serialized envelope (UTF-16 units of the JSON text, which is what localStorage quota
// counts). The store shares the origin quota with SEND_PENDING, so it must stay small: 512 KiB of ~5 MiB. A write that would
// exceed it returns store_full and writes nothing. (A quota error from setItem itself is store_unsound, also nothing written.)
export const MAX_EVIDENCE_BYTES = 512 * 1024;
const HASH32 = /^0x[0-9a-f]{64}$/i;

const bad = (reason) => ({ ok: false, reason });
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const chainOk = (c) => (typeof c === "number" && Number.isSafeInteger(c) && c > 0) || (typeof c === "string" && /^[1-9][0-9]{0,15}$/.test(c));

export function evidenceStoreKey(chainId) {
  return chainOk(chainId) ? `${EVIDENCE_STORE_PREFIX}${String(chainId)}` : null;
}

export function evidenceKey({ chainId, txHash, logIndex } = {}) {
  if (!chainOk(chainId) || typeof txHash !== "string" || !HASH32.test(txHash)) return null;
  const li = logIndex === undefined || logIndex === null ? "tx" : Number.isSafeInteger(logIndex) && logIndex >= 0 ? String(logIndex) : null;
  if (li === null) return null;
  return `evidence|${String(chainId)}|${txHash.toLowerCase()}|${li}`;
}

const rowKey = (r) => (isObj(r) ? evidenceKey({ chainId: r.chainId, txHash: r.txHash, logIndex: r.logIndex }) : null);
const isActive = (r) => isObj(r) && !r.supersededBy;
const clone = (v) => JSON.parse(JSON.stringify(v));

export function createEvidenceStore({ storage, chainId } = {}) {
  const storeKey = evidenceStoreKey(chainId);
  const cid = storeKey ? String(chainId) : null;

  // Load the envelope. Returns { ok:true, env, rawRows } or a fail-closed result.
  function load() {
    if (!storeKey || !storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") return bad("store_unavailable");
    let raw;
    try { raw = storage.getItem(storeKey); } catch { return bad("store_unsound"); }
    if (raw === null || raw === undefined || raw === "") return { ok: true, env: { schema: EVIDENCE_SCHEMA, v: EVIDENCE_STORE_VERSION, chainId: cid, rows: [] }, raw: null };
    let env;
    try { env = JSON.parse(raw); } catch { return bad("store_unsound"); }
    if (!isObj(env) || env.schema !== EVIDENCE_SCHEMA || !Array.isArray(env.rows)) return bad("store_unsound");
    if (env.v !== EVIDENCE_STORE_VERSION) return bad("store_unsound");
    if (String(env.chainId) !== cid) return bad("store_unsound");
    return { ok: true, env, raw };
  }

  // `loadedRaw` = the text load() saw (null when the key was absent). Compare-and-set against it right before setItem.
  function persist(env, loadedRaw) {
    const json = JSON.stringify(env);
    if (json.length > MAX_EVIDENCE_BYTES) return bad("store_full");
    let now;
    try { now = storage.getItem(storeKey); } catch { return bad("store_unsound"); }
    const norm = (v) => (v === null || v === undefined || v === "" ? null : v);
    if (norm(now) !== norm(loadedRaw)) return bad("store_unsound"); // another tab wrote since load(): our change would clobber it
    try { storage.setItem(storeKey, json); } catch { return bad("store_unsound"); }
    let back;
    try { back = storage.getItem(storeKey); } catch { return bad("store_unsound"); }
    if (back === json) return { ok: true };
    // Another tab wrote in between: the caller's change is not provably durable.
    return bad("store_unsound");
  }

  // Caller-writable fields. Everything else (store-owned class/reason/conflict/supersededBy/rowId/evidenceKey,
  // identity, unknown or prototype-polluting keys) is dropped. Values must survive JSON (BigInt/cycles => row_invalid).
  function sanitize(input) {
    const out = {};
    for (const k of WRITABLE) {
      const v = input[k];
      if (v === undefined) continue;
      out[k] = v === null ? null : JSON.parse(JSON.stringify(v));
    }
    return out;
  }

  function validateRow(input) {
    if (!storeKey) return bad("store_unavailable");
    if (!isObj(input)) return bad("row_invalid");
    if (input.schema !== undefined && input.schema !== EVIDENCE_SCHEMA) return bad("row_invalid");
    if (input.chainId !== undefined && String(input.chainId) !== cid) return bad("chain_mismatch");
    const key = evidenceKey({ chainId: cid, txHash: input.txHash, logIndex: input.logIndex });
    if (!key) return bad("row_invalid");
    if (input.commitState != null && !COMMIT_RANK[input.commitState]) return bad("row_invalid");
    if (input.blockHash != null && !(typeof input.blockHash === "string" && HASH32.test(input.blockHash))) return bad("row_invalid");
    return { ok: true, key };
  }

  function rowsWithKey(rows, key) {
    const out = [];
    rows.forEach((r, i) => { if (rowKey(r) === key) out.push(i); });
    return out;
  }

  // Merge `inc` (sanitized) into `cur` (same key, same block). Never downgrades, never turns an unknown into a
  // failure, never silently overwrites a settled non-null fact: a differing one is recorded under `conflict`.
  function merge(cur, inc) {
    const next = { ...cur };
    const conflict = isObj(cur.conflict) ? { ...cur.conflict } : {};
    let conflicted = false;
    for (const [k, v] of Object.entries(inc)) {
      if (k === "status" && UNSETTLED.has(v) && !UNSETTLED.has(cur.status)) continue;
      if (k === "commitState") {
        if (v === null) continue;
        if ((COMMIT_RANK[v] || 0) < (COMMIT_RANK[cur.commitState] || 0)) continue;
        next[k] = v;
        continue;
      }
      if (v === null) { if (cur[k] == null) next[k] = null; continue; } // an empty/failed read never erases a fact
      const settledCur = k === "status" ? !UNSETTLED.has(cur.status) : cur[k] != null;
      if (settledCur && JSON.stringify(cur[k]) !== JSON.stringify(v)) {
        if (k === "status" && UNSETTLED.has(v)) continue;
        conflict[k] = { stored: cur[k], observed: v };
        conflicted = true;
        continue;
      }
      next[k] = v;
    }
    if (conflicted) next.conflict = conflict;
    return next;
  }

  // Apply an observation (sanitized fields + identity) to the rows: append, merge, or reorg-preserve.
  function observe(rows, key, ident, fields) {
    const idxs = rowsWithKey(rows, key);
    const activeIdx = idxs.find((i) => isActive(rows[i]));
    const incoming = { ...fields, schema: EVIDENCE_SCHEMA, chainId: cid, txHash: ident.txHash.toLowerCase(), evidenceKey: key };
    if (ident.logIndex !== undefined && ident.logIndex !== null) incoming.logIndex = ident.logIndex;
    if (activeIdx !== undefined) {
      const cur = rows[activeIdx];
      const sameBlock = !cur.blockHash || !incoming.blockHash || cur.blockHash.toLowerCase() === incoming.blockHash.toLowerCase();
      if (sameBlock) {
        rows[activeIdx] = merge(cur, fields);
        return "merged";
      }
    }
    if (rows.length >= MAX_EVIDENCE_ROWS) return null; // store_full
    incoming.rowId = `${key}#${idxs.length}`;
    incoming.supersededBy = null;
    if (activeIdx === undefined) {
      rows.push(incoming);
      return idxs.length ? "appended_after_superseded" : "appended";
    }
    // Reorg: the same tx now sits in a different block. Preserve the old row, link it forward.
    rows[activeIdx] = { ...rows[activeIdx], class: "reorged", reason: "block_hash_changed", supersededBy: incoming.rowId };
    rows.push(incoming);
    return "reorged";
  }

  function guard(fn) {
    try { return fn(); } catch { return bad("row_invalid"); }
  }

  // Record an observation. One ACTIVE row per evidenceKey.
  function append(input) {
    return guard(() => {
      const v = validateRow(input);
      if (!v.ok) return v;
      const fields = sanitize(input);
      const L = load();
      if (!L.ok) return L;
      const rows = L.env.rows.slice();
      const outcome = observe(rows, v.key, { txHash: input.txHash, logIndex: input.logIndex }, fields);
      if (outcome === null) return bad("store_full");
      const w = persist({ ...L.env, rows }, L.raw);
      if (!w.ok) return w;
      return { ok: true, outcome, evidenceKey: v.key };
    });
  }

  // Patch the ACTIVE row for a key. Only whitelisted fields; identity and store-owned fields are ignored.
  // A changed blockHash goes through the reorg path (old row preserved, new row appended).
  function update(key, patch) {
    return guard(() => {
      if (typeof key !== "string" || !isObj(patch)) return bad("row_invalid");
      if (!storeKey) return bad("store_unavailable");
      if (patch.chainId !== undefined && String(patch.chainId) !== cid) return bad("chain_mismatch");
      if (patch.commitState != null && !COMMIT_RANK[patch.commitState]) return bad("row_invalid");
      if (patch.blockHash != null && !(typeof patch.blockHash === "string" && HASH32.test(patch.blockHash))) return bad("row_invalid");
      const fields = sanitize(patch);
      const L = load();
      if (!L.ok) return L;
      const rows = L.env.rows.slice();
      const idx = rowsWithKey(rows, key).find((i) => isActive(rows[i]));
      if (idx === undefined) return bad("not_found");
      const outcome = observe(rows, key, { txHash: rows[idx].txHash, logIndex: rows[idx].logIndex }, fields);
      if (outcome === null) return bad("store_full");
      const w = persist({ ...L.env, rows }, L.raw);
      return w.ok ? { ok: true, outcome, evidenceKey: key } : w;
    });
  }

  // Mark the active row of `key` as superseded by another rowId (never deletes).
  function supersede(key, byRowId, reason) {
    return guard(() => {
      if (typeof key !== "string" || typeof byRowId !== "string" || !byRowId) return bad("row_invalid");
      const L = load();
      if (!L.ok) return L;
      const rows = L.env.rows.slice();
      const idx = rowsWithKey(rows, key).find((i) => isActive(rows[i]));
      if (idx === undefined) return bad("not_found");
      rows[idx] = { ...rows[idx], class: "reorged", reason: typeof reason === "string" ? reason.slice(0, 80) : "superseded", supersededBy: byRowId };
      const w = persist({ ...L.env, rows }, L.raw);
      return w.ok ? { ok: true, evidenceKey: key } : w;
    });
  }

  // Readers. `rows` = every well-formed row incl. superseded (history). Broken rows are counted, never dropped from storage.
  function readAll() { return guard(readAllInner); }
  function readAllInner() {
    const L = load();
    if (!L.ok) return L;
    const rows = L.env.rows.filter((r) => rowKey(r) !== null).map(clone);
    return { ok: true, rows, active: rows.filter(isActive), brokenRows: L.env.rows.length - rows.length };
  }
  function get(key) { return guard(() => getInner(key)); }
  function getInner(key) {
    const a = readAll();
    if (!a.ok) return a;
    return { ok: true, row: a.active.find((r) => rowKey(r) === key) || null, history: a.rows.filter((r) => rowKey(r) === key) };
  }

  return { storeKey, append, update, supersede, readAll, get };
}
