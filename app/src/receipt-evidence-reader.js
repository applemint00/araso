// [A-866 / A-856 W1] Common receipt evidence READER for `araso_tx_evidence_v1`. Pure, read-only, no timers.
//   - imports nothing (no money-executor / permission-envelope / second-job-readiness)
//   - rpc is INJECTED: async (method, params) => result. No URL, signer, session or permission object here.
//   - own read-only whitelist (second-job-readiness.js whitelist is untouched). Sending and getLogs are not in it.
//   - never throws: every export returns a value; hostile input => read_failed / row_invalid style results.
//   - a null receipt is `not_found` (unconfirmed), NEVER `failed`/reverted. Unknown is never promoted.
//   - feeBasis is ALWAYS "unresolved" (gasUsed meaning on Monad is UNKNOWN; A-856).
//   - finality is an INFERRED recipe (not an official one): receipt -> safe/finalized block -> number+hash compare.
//     No confirmation depth is invented; without a requested tag the commitState is "proposed" (latest).
//   - historic-state reads (balance before/after) that fail map to null, never 0.

export const EVIDENCE_SCHEMA = "araso_tx_evidence_v1";
export const READ_WHITELIST = Object.freeze(["eth_chainId", "eth_blockNumber", "eth_getTransactionReceipt",
  "eth_getTransactionByHash", "eth_getTransactionCount", "eth_getBalance", "eth_getBlockByNumber", "eth_call"]);
export const FAILURE_CLASSES = Object.freeze(["reverted", "pending", "unconfirmed", "read_failed", "reorged"]);
const FINALITY_TAGS = Object.freeze({ safe: "voted", finalized: "finalized" });
const COMMIT_RANK = { proposed: 1, voted: 2, finalized: 3 };
const HASH32 = /^0x[0-9a-f]{64}$/i;
const HEX = /^0x[0-9a-f]+$/i;
const ADDR = /^0x[0-9a-f]{40}$/i;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const chainOk = (c) => (typeof c === "number" && Number.isSafeInteger(c) && c > 0) || (typeof c === "string" && /^[1-9][0-9]{0,15}$/.test(c));

export function evidenceKey({ chainId, txHash, logIndex } = {}) {
  if (!chainOk(chainId) || typeof txHash !== "string" || !HASH32.test(txHash)) return null;
  const li = logIndex === undefined || logIndex === null ? "tx" : Number.isSafeInteger(logIndex) && logIndex >= 0 ? String(logIndex) : null;
  if (li === null) return null;
  return `evidence|${String(chainId)}|${txHash.toLowerCase()}|${li}`;
}

const hexNum = (v) => {
  if (typeof v !== "string" || !HEX.test(v) || v.length > 18) return null;
  const n = Number(BigInt(v));
  return Number.isSafeInteger(n) ? n : null;
};
const hexStr = (v) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : null);

// Whitelisted wrapper. Any failure (non-whitelisted method, throw, non-function rpc) => { ok:false }.
function guard(rpc) {
  return async (method, params) => {
    if (!READ_WHITELIST.includes(method) || typeof rpc !== "function") return { ok: false };
    try { return { ok: true, value: await rpc(method, params) }; } catch { return { ok: false }; }
  };
}

function baseRow({ chainId, txHash, journey, source }) {
  return {
    schema: EVIDENCE_SCHEMA, chainId: String(chainId), txHash: txHash.toLowerCase(), journey: journey ?? null,
    status: "unknown", blockNumber: null, blockHash: null, txIndex: null,
    commitState: null, trust: null, tagUsed: "latest",
    from: null, to: null, nonce: null, nonceConsumed: null, gasLimit: null, gasUsedReported: null,
    feeByReceipt: null, feeByLimit: null, feeBasis: "unresolved",
    balanceBefore: null, balanceAfter: null, revert: null,
    source: source ?? "rpc", class: null, reason: null, supersededBy: null, canonical: null,
  };
}

export function classifyEvidence(row) {
  try {
    if (!isObj(row)) return { class: "read_failed", reason: "row_invalid" };
    if (row.class === "reorged") return { class: "reorged", reason: row.reason ?? "block_hash_changed" };
    if (row.status === "reverted") return { class: "reverted", reason: "receipt_status_0" };
    if (row.status === "success") return { class: null, reason: null };
    if (row.status === "not_found") return { class: "unconfirmed", reason: row.reason ?? "receipt_null" };
    if (row.class === "pending" || row.reason === "tx_known_no_receipt") return { class: "pending", reason: "tx_known_no_receipt" };
    if (row.class === "read_failed") return { class: "read_failed", reason: row.reason ?? "rpc_error" };
    return { class: "read_failed", reason: row.reason ?? "unknown_status" };
  } catch { return { class: "read_failed", reason: "row_invalid" }; }
}

// Compare a stored row with a fresh observation. Never deletes; never overwrites silently.
export function reconcileEvidence(stored, fresh) {
  try {
    if (!isObj(fresh)) return { outcome: "unknown", reason: "fresh_invalid" };
    if (!isObj(stored)) return { outcome: "new" };
    if (evidenceKey({ chainId: stored.chainId, txHash: stored.txHash, logIndex: stored.logIndex }) !==
        evidenceKey({ chainId: fresh.chainId, txHash: fresh.txHash, logIndex: fresh.logIndex })) return { outcome: "unknown", reason: "key_mismatch" };
    if (fresh.status === "not_found" && (stored.status === "success" || stored.status === "reverted"))
      return { outcome: "reorged", supersededBy: null, reason: "settled_then_not_found" };
    if (fresh.status === "unknown" || fresh.status === "not_found" || fresh.class === "read_failed") return { outcome: "unchanged", reason: "fresh_unsettled" };
    if (stored.blockHash && fresh.blockHash && stored.blockHash.toLowerCase() !== fresh.blockHash.toLowerCase())
      return { outcome: "reorged", supersededBy: fresh.blockHash.toLowerCase(), reason: "block_hash_changed" };
    if (stored.status && fresh.status && stored.status !== fresh.status && stored.status !== "unknown" && stored.status !== "not_found")
      return { outcome: "conflict", reason: "status_differs" };
    const up = (COMMIT_RANK[fresh.commitState] || 0) > (COMMIT_RANK[stored.commitState] || 0);
    return { outcome: up ? "upgrade" : "unchanged" };
  } catch { return { outcome: "unknown", reason: "reconcile_failed" }; }
}

// Inferred finality: for each tag, tag block number >= receipt block AND canonical hash at receipt height == receipt hash.
async function readFinality(call, tags, bn, bh) {
  let commit = "proposed", tagUsed = "latest", reorged = false, canonical = null;
  for (const tag of tags) {
    if (!FINALITY_TAGS[tag]) continue;
    const t = await call("eth_getBlockByNumber", [tag, false]);
    const tn = t.ok && isObj(t.value) ? hexNum(t.value.number) : null;
    if (tn === null || tn < bn) continue;
    const c = await call("eth_getBlockByNumber", ["0x" + bn.toString(16), false]);
    const ch = c.ok && isObj(c.value) ? hexStr(c.value.hash) : null;
    if (ch === null) continue;
    if (ch !== bh) { reorged = true; canonical = "mismatch"; break; }
    canonical = "verified";
    if (COMMIT_RANK[FINALITY_TAGS[tag]] > COMMIT_RANK[commit]) { commit = FINALITY_TAGS[tag]; tagUsed = tag; }
  }
  return { commit, tagUsed, reorged, canonical };
}

// [A-895 P-C / A-866 r2] Canonical-hash-at-height check that does not need a finality tag: the block at the receipt's height must carry
// the receipt's block hash. A failed/malformed read is `unverified_canonical` (stated, never promoted, never treated as a match).
async function readCanonical(call, bn, bh) {
  const c = await call("eth_getBlockByNumber", ["0x" + bn.toString(16), false]);
  const ch = c.ok && isObj(c.value) ? hexStr(c.value.hash) : null;
  if (ch === null || !HASH32.test(ch)) return "unverified_canonical";
  return ch === bh ? "verified" : "mismatch";
}

// nonceConsumed: true/false when from+nonce are known and the count read works; otherwise "unknown" (never guessed).
async function readNonceConsumed(call, from, nonce) {
  if (typeof from !== "string" || !ADDR.test(from) || nonce === null) return "unknown";
  const c = await call("eth_getTransactionCount", [from, "latest"]);
  const n = c.ok ? hexNum(c.value) : null;
  return n === null ? "unknown" : n > nonce;
}
const sameHash = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

export async function readTxEvidence({ rpc, chainId, hash, expect, stored, finality, journey, source } = {}) {
  try {
    if (!chainOk(chainId) || typeof hash !== "string" || !HASH32.test(hash)) return { ok: false, reason: "row_invalid", row: null };
    const call = guard(rpc);
    const row = baseRow({ chainId, txHash: hash, journey, source });
    row.evidenceKey = evidenceKey({ chainId, txHash: hash });
    const cid = await call("eth_chainId", []);
    if (!cid.ok) return done(row, stored, "read_failed", "rpc_error");
    const live = hexNum(cid.value);
    if (live === null || String(live) !== String(chainId)) return done(row, stored, "read_failed", "chain_mismatch");
    const rc = await call("eth_getTransactionReceipt", [hash]);
    if (!rc.ok) return done(row, stored, "read_failed", "rpc_error");
    if (rc.value === null || rc.value === undefined) {
      const tx = await call("eth_getTransactionByHash", [hash]);
      row.status = "not_found";
      if (tx.ok && isObj(tx.value)) {
        if (tx.value.hash !== undefined && !sameHash(tx.value.hash, hash)) return done(row, stored, "read_failed", "receipt_hash_mismatch");
        row.nonce = hexNum(tx.value.nonce); row.gasLimit = hexNum(tx.value.gas);
        row.from = hexStr(tx.value.from); row.to = hexStr(tx.value.to);
        row.nonceConsumed = await readNonceConsumed(call, tx.value.from, row.nonce);
        if (row.nonceConsumed === true) {
          // [A-895 P-C / A-866 r1] The nonce may have been consumed by THIS tx mining between the receipt read and the count read.
          // Re-read the receipt once: if it is there now, this is not a replacement - stay pending and let the next read settle it.
          // Otherwise the verdict is only "possibly" replaced/dropped (class unconfirmed, never failed/reverted, never terminal).
          const again = await call("eth_getTransactionReceipt", [hash]);
          if (again.ok && again.value !== null && again.value !== undefined) { row.class = "pending"; row.reason = "receipt_appeared_on_reread"; }
          else { row.class = "unconfirmed"; row.reason = "nonce_consumed_possibly_replaced_or_dropped"; }
        }
        else { row.class = "pending"; row.reason = "tx_known_no_receipt"; }
      }
      else if (tx.ok) { row.class = "unconfirmed"; row.reason = "receipt_null"; row.nonceConsumed = "unknown"; }
      else { row.status = "unknown"; row.class = "read_failed"; row.reason = "rpc_error"; }
      return done(row, stored);
    }
    const r = rc.value;
    const st = isObj(r) ? hexNum(r.status) : null;
    const bn = isObj(r) ? hexNum(r.blockNumber) : null;
    const bh = isObj(r) ? hexStr(r.blockHash) : null;
    if ((st !== 0 && st !== 1) || bn === null || !bh || !HASH32.test(bh)) return done(row, stored, "read_failed", "receipt_malformed");
    if (!sameHash(r.transactionHash, hash)) return done(row, stored, "read_failed", "receipt_hash_mismatch");
    row.status = st === 1 ? "success" : "reverted";
    row.blockNumber = bn; row.blockHash = bh; row.txIndex = hexNum(r.transactionIndex);
    row.gasUsedReported = hexNum(r.gasUsed); // meaning UNKNOWN on Monad
    row.commitState = "proposed";
    const tx = await call("eth_getTransactionByHash", [hash]);
    if (tx.ok && isObj(tx.value)) {
      if (tx.value.hash !== undefined && !sameHash(tx.value.hash, hash)) { row.status = "unknown"; return done(row, stored, "read_failed", "receipt_hash_mismatch"); }
      row.nonce = hexNum(tx.value.nonce); row.gasLimit = hexNum(tx.value.gas);
      row.from = hexStr(tx.value.from); row.to = hexStr(tx.value.to);
      row.nonceConsumed = await readNonceConsumed(call, tx.value.from, row.nonce);
    } else { row.from = hexStr(r.from); row.to = hexStr(r.to); row.nonceConsumed = "unknown"; }
    const ef = isObj(expect) && typeof expect.from === "string" ? expect.from.toLowerCase() : null;
    const et = isObj(expect) && typeof expect.to === "string" ? expect.to.toLowerCase() : null;
    if ((ef && row.from !== ef) || (et && row.to !== et)) {
      const why = ef && row.from !== ef ? (row.from ? "from_mismatch" : "from_unverifiable") : (row.to ? "to_mismatch" : "to_unverifiable");
      row.status = "unknown"; row.blockNumber = bn; row.blockHash = bh;
      return done(row, stored, "read_failed", why);
    }
    const tags = isObj(finality) && Array.isArray(finality.tags) ? finality.tags : [];
    row.canonical = "unverified_canonical";
    if (tags.length) {
      const f = await readFinality(call, tags, bn, bh);
      row.commitState = f.commit; row.tagUsed = f.tagUsed;
      if (f.canonical !== null) row.canonical = f.canonical === "mismatch" ? "mismatch" : "verified";
      if (f.reorged) { row.class = "reorged"; row.reason = "block_hash_changed"; }
    }
    // [A-866 r2] no tag verified the height (no tags given, or none usable): check the canonical hash at the height directly.
    if (row.canonical === "unverified_canonical") {
      row.canonical = await readCanonical(call, bn, bh);
      if (row.canonical === "mismatch") { row.class = "reorged"; row.reason = "block_hash_changed"; }
    }
    row.trust = row.commitState === "finalized" ? "T3" : row.commitState === "voted" ? "T2" : "T1";
    const addr = isObj(expect) && typeof expect.address === "string" && ADDR.test(expect.address) ? expect.address : null;
    if (addr) {
      const at = (n) => "0x" + n.toString(16);
      const b0 = bn > 0 ? await call("eth_getBalance", [addr, at(bn - 1)]) : { ok: false };
      const b1 = await call("eth_getBalance", [addr, at(bn)]);
      row.balanceBefore = b0.ok ? hexStr(b0.value) : null;
      row.balanceAfter = b1.ok ? hexStr(b1.value) : null;
    }
    if (row.status === "reverted") row.revert = { reason: "UNKNOWN" };
    return done(row, stored);
  } catch { return { ok: false, reason: "read_failed", row: null }; }
}

function done(row, stored, cls, reason) {
  if (cls) { row.class = cls; row.reason = reason; }
  const rec = reconcileEvidence(stored, row);
  if (rec.outcome === "reorged" && row.class !== "reorged") { row.class = "reorged"; row.reason = rec.reason; row.supersededBy = null; }
  if (!row.class) row.class = classifyEvidence(row).class;
  row.feeBasis = "unresolved";
  return { ok: true, row, reconcile: rec, class: row.class, reason: row.reason };
}

// Sequential (no timers, no concurrency).
export async function readTxEvidenceBatch(items, common = {}) {
  const out = [];
  try { for (const it of Array.isArray(items) ? items : []) out.push(await readTxEvidence({ ...common, ...(isObj(it) ? it : {}) })); } catch { /* never throws */ }
  return out;
}
