// A-868 · receipt evidence store (W2): chain scope, dedup, reorg preserve, corrupt fail-closed, isolation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEvidenceStore, evidenceKey, evidenceStoreKey, MAX_EVIDENCE_ROWS, MAX_EVIDENCE_BYTES } from "../src/receipt-evidence-store.js";

const SRC = readFileSync(new URL("../src/receipt-evidence-store.js", import.meta.url), "utf8");
const H = (n) => "0x" + n.toString(16).padStart(64, "0");
const mem = (init = {}) => { const m = { ...init }; return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };

// chain scope
assert.equal(evidenceStoreKey(10143), "araso.txEvidence.v1.10143");
assert.equal(evidenceStoreKey(0), null);
assert.equal(evidenceStoreKey("abc"), null);
{
  const s = mem(); const a = createEvidenceStore({ storage: s, chainId: 10143 }); const b = createEvidenceStore({ storage: s, chainId: 143 });
  assert.equal(a.append({ txHash: H(1), status: "success" }).ok, true);
  assert.equal(b.readAll().rows.length, 0);
  assert.deepEqual(Object.keys(s.m), ["araso.txEvidence.v1.10143"]);
  assert.equal(a.append({ chainId: 143, txHash: H(2) }).reason, "chain_mismatch");
  assert.equal(createEvidenceStore({ storage: s, chainId: 0 }).append({ txHash: H(1) }).reason, "store_unavailable");
}
// no existing receipt storage touched
{
  const s = mem({ "araso.receipts": "[1]" }); const a = createEvidenceStore({ storage: s, chainId: 143 });
  a.append({ txHash: H(1), status: "success" });
  assert.equal(s.m["araso.receipts"], "[1]");
}
// dedup + merge rules
{
  const s = mem(); const a = createEvidenceStore({ storage: s, chainId: 143 });
  assert.equal(a.append({ txHash: H(1).toUpperCase().replace("0X", "0x"), status: "unknown", commitState: "proposed", blockHash: H(9) }).outcome, "appended");
  assert.equal(a.append({ txHash: H(1), status: "success", commitState: "voted", blockHash: H(9), balanceAfter: "5" }).outcome, "merged");
  assert.equal(a.append({ txHash: H(1), status: "unknown", commitState: "proposed", blockHash: H(9), balanceAfter: null }).outcome, "merged");
  const r = a.get(evidenceKey({ chainId: 143, txHash: H(1) })).row;
  assert.equal(a.readAll().rows.length, 1);
  assert.equal(r.status, "success"); assert.equal(r.commitState, "voted"); assert.equal(r.balanceAfter, "5");
  a.append({ txHash: H(1), status: "reverted", blockHash: H(9) });
  const c = a.get(r.evidenceKey).row;
  assert.equal(c.status, "success"); assert.equal(c.conflict.status.observed, "reverted");
  // logIndex distinguishes rows
  a.append({ txHash: H(1), logIndex: 0 }); a.append({ txHash: H(1), logIndex: 1 });
  assert.equal(a.readAll().active.length, 3);
  assert.equal(a.update(r.evidenceKey, { txHash: H(7), commitState: "finalized" }).ok, true);
  const u = a.get(r.evidenceKey).row; assert.equal(u.txHash, H(1)); assert.equal(u.commitState, "finalized");
  assert.equal(a.update("evidence|143|nope|tx", {}).reason, "not_found");
}
// reorg preserves
{
  const s = mem(); const a = createEvidenceStore({ storage: s, chainId: 143 });
  a.append({ txHash: H(1), status: "success", blockHash: H(8), blockNumber: 5, commitState: "voted" });
  const res = a.append({ txHash: H(1), status: "success", blockHash: H(9), blockNumber: 6, commitState: "proposed" });
  assert.equal(res.outcome, "reorged");
  const all = a.readAll();
  assert.equal(all.rows.length, 2); assert.equal(all.active.length, 1);
  const old = all.rows.find((r) => r.blockHash === H(8)); const cur = all.active[0];
  assert.equal(old.class, "reorged"); assert.equal(old.supersededBy, cur.rowId); assert.equal(old.blockNumber, 5);
  assert.equal(cur.blockHash, H(9)); assert.equal(cur.commitState, "proposed");
  assert.equal(a.get(res.evidenceKey).history.length, 2);
  // back to first block again -> another preserved row
  a.append({ txHash: H(1), blockHash: H(8) });
  assert.equal(a.readAll().rows.length, 3);
  assert.equal(new Set(a.readAll().rows.map((r) => r.rowId)).size, 3);
  // manual supersede keeps the row
  assert.equal(a.supersede(res.evidenceKey, "x#1", "manual").ok, true);
  assert.equal(a.readAll().rows.length, 3); assert.equal(a.readAll().active.length, 0);
}
// corrupt fail-closed: never writes
{
  const key = "araso.txEvidence.v1.143";
  const cases = {
    unparseable: "{nope", array: "[]", wrongSchema: JSON.stringify({ schema: "x", v: 1, chainId: "143", rows: [] }),
    rowsNotArray: JSON.stringify({ schema: "araso_tx_evidence_v1", v: 1, chainId: "143", rows: {} }),
    newerVersion: JSON.stringify({ schema: "araso_tx_evidence_v1", v: 2, chainId: "143", rows: [] }),
    wrongChain: JSON.stringify({ schema: "araso_tx_evidence_v1", v: 1, chainId: "10143", rows: [] }),
  };
  for (const [name, raw] of Object.entries(cases)) {
    const s = mem({ [key]: raw }); const a = createEvidenceStore({ storage: s, chainId: 143 });
    for (const r of [a.append({ txHash: H(1) }), a.readAll(), a.get("k"), a.update("k", {}), a.supersede("k", "y")]) { assert.equal(r.ok, false, name); assert.equal(r.reason, "store_unsound", name); }
    assert.equal(s.m[key], raw, `${name}: storage untouched`);
  }
  // getItem throws / setItem throws / setItem silently dropped
  const t = { getItem() { throw new Error("x"); }, setItem() {} };
  assert.equal(createEvidenceStore({ storage: t, chainId: 143 }).append({ txHash: H(1) }).reason, "store_unsound");
  const t2 = { getItem: () => null, setItem() { throw new Error("quota"); } };
  assert.equal(createEvidenceStore({ storage: t2, chainId: 143 }).append({ txHash: H(1) }).reason, "store_unsound");
  const t3 = { getItem: () => null, setItem() {} };
  assert.equal(createEvidenceStore({ storage: t3, chainId: 143 }).append({ txHash: H(1) }).reason, "store_unsound");
  assert.equal(createEvidenceStore({ chainId: 143 }).append({ txHash: H(1) }).reason, "store_unavailable");
}
// a broken row is kept verbatim and does not block healthy rows
{
  const key = "araso.txEvidence.v1.143";
  const env = { schema: "araso_tx_evidence_v1", v: 1, chainId: "143", rows: ["junk", { weird: true }] };
  const s = mem({ [key]: JSON.stringify(env) }); const a = createEvidenceStore({ storage: s, chainId: 143 });
  assert.equal(a.append({ txHash: H(1), status: "success" }).ok, true);
  const rows = JSON.parse(s.m[key]).rows;
  assert.equal(rows[0], "junk"); assert.deepEqual(rows[1], { weird: true }); assert.equal(rows.length, 3);
  assert.equal(a.readAll().brokenRows, 2);
}
// invalid input
{
  const a = createEvidenceStore({ storage: mem(), chainId: 143 });
  for (const x of [null, [], {}, { txHash: "0x12" }, { txHash: H(1), commitState: "bogus" }, { txHash: H(1), blockHash: "0xabc" }, { txHash: H(1), logIndex: -1 }, { txHash: H(1), schema: "other" }]) assert.equal(a.append(x).ok, false);
  assert.equal(a.readAll().rows.length, 0);
}

// never throws: BigInt, cycle, throwing getter, Proxy
{
  const s = mem(); const a = createEvidenceStore({ storage: s, chainId: 143 });
  const cyc = { txHash: H(1) }; cyc.nonce = { self: null }; cyc.nonce.self = cyc.nonce;
  const getter = { txHash: H(1) }; Object.defineProperty(getter, "status", { enumerable: true, get() { throw new Error("boom"); } });
  const prox = new Proxy({}, { get() { throw new Error("proxy"); }, ownKeys() { throw new Error("proxy"); } });
  for (const x of [{ txHash: H(1), gasLimit: 10n }, cyc, getter, prox]) {
    let r; assert.doesNotThrow(() => { r = a.append(x); }); assert.equal(r.ok, false); assert.equal(r.reason, "row_invalid");
    assert.doesNotThrow(() => { r = a.update("evidence|143|" + H(1) + "|tx", x); }); assert.equal(r.ok, false);
  }
  assert.equal(a.readAll().rows.length, 0); assert.equal(s.m["araso.txEvidence.v1.143"], undefined);
  assert.doesNotThrow(() => a.get(Symbol("x"))); assert.doesNotThrow(() => a.supersede(null, 1));
}
// non-status conflicts are recorded, stored value kept
{
  const a = createEvidenceStore({ storage: mem(), chainId: 143 });
  const k = a.append({ txHash: H(1), blockNumber: 5, nonce: 3, balanceAfter: "1" }).evidenceKey;
  a.append({ txHash: H(1), blockNumber: 7, nonce: 3, balanceAfter: null });
  const r = a.get(k).row;
  assert.equal(r.blockNumber, 5); assert.deepEqual(r.conflict.blockNumber, { stored: 5, observed: 7 });
  assert.equal(r.nonce, 3); assert.equal(r.conflict.nonce, undefined); assert.equal(r.balanceAfter, "1");
}
// update() with changed blockHash -> reorg path
{
  const a = createEvidenceStore({ storage: mem(), chainId: 143 });
  const k = a.append({ txHash: H(1), status: "success", blockHash: H(8), blockNumber: 5 }).evidenceKey;
  const u = a.update(k, { blockHash: H(9), blockNumber: 6 });
  assert.equal(u.outcome, "reorged");
  const all = a.readAll();
  assert.equal(all.rows.length, 2); assert.equal(all.active.length, 1);
  assert.equal(all.rows.find((r) => r.blockHash === H(8)).class, "reorged");
  assert.equal(all.active[0].blockHash, H(9)); assert.equal(all.active[0].txHash, H(1));
}
// whitelist: store-owned / unknown / prototype keys dropped
{
  const s = mem(); const a = createEvidenceStore({ storage: s, chainId: 143 });
  const evil = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"x":1},"prototype":{"y":1},"class":"x","reason":"x","conflict":{"a":1},"supersededBy":"z","rowId":"r","authorize":true,"status":"success"}');
  const k = a.append({ txHash: H(1), ...evil }).evidenceKey;
  assert.equal(a.update(k, evil).ok, true);
  const r = a.get(k).row;
  for (const f of ["class", "reason", "conflict", "authorize", "constructor", "prototype"]) assert.equal(Object.prototype.hasOwnProperty.call(r, f), false, f);
  assert.equal(r.supersededBy, null); assert.equal(r.rowId, k + "#0"); assert.equal(r.status, "success");
  assert.equal(({}).polluted, undefined); assert.equal(Object.getPrototypeOf(r), Object.prototype);
  assert.equal(JSON.stringify(JSON.parse(s.m["araso.txEvidence.v1.143"]).rows[0]).includes("polluted"), false);
}
// row cap fails closed
{
  const key = "araso.txEvidence.v1.143";
  const rows = Array.from({ length: MAX_EVIDENCE_ROWS }, (_, i) => ({ schema: "araso_tx_evidence_v1", chainId: "143", txHash: H(i + 100), supersededBy: null }));
  const raw = JSON.stringify({ schema: "araso_tx_evidence_v1", v: 1, chainId: "143", rows });
  const s = mem({ [key]: raw }); const a = createEvidenceStore({ storage: s, chainId: 143 });
  const r = a.append({ txHash: H(1) }); assert.equal(r.ok, false); assert.equal(r.reason, "store_full"); assert.equal(s.m[key], raw);
  assert.equal(a.append({ txHash: H(100), status: "success" }).outcome, "merged"); // merge adds no row
}
// ---- [A-895 P-C] cross-tab compare-and-set (A-868 residual) ----------------------------------------
{
  const key = "araso.txEvidence.v1.143";
  // another tab writes between this call's load() and its setItem(): the change is refused, the other tab's text survives
  const m = {}; let reads = 0; let intruder = null;
  const storage = { getItem: (k) => { reads += 1; if (reads === 2 && intruder) { m[key] = intruder; } return k in m ? m[k] : null; }, setItem: (k, v) => { m[k] = v; } };
  const a = createEvidenceStore({ storage, chainId: 143 });
  assert.equal(a.append({ txHash: H(1), status: "success" }).ok, true);
  const before = m[key];
  const other = JSON.stringify({ ...JSON.parse(before), rows: [...JSON.parse(before).rows, { schema: "araso_tx_evidence_v1", chainId: "143", txHash: H(9), supersededBy: null }] });
  reads = 0; intruder = other;
  const r = a.append({ txHash: H(2), status: "success" });
  assert.equal(r.ok, false); assert.equal(r.reason, "store_unsound");
  assert.equal(m[key], other); // the intruder's write is intact, ours was not applied
  intruder = null; reads = 0;
  assert.equal(a.append({ txHash: H(2), status: "success" }).ok, true); // next call re-loads and succeeds
  assert.equal(JSON.parse(m[key]).rows.length, 3);
  // update / supersede go through the same guard
  const k1 = evidenceKey({ chainId: 143, txHash: H(1) });
  reads = 0; intruder = m[key] + " ";
  assert.equal(a.update(k1, { nonce: 7 }).reason, "store_unsound");
  reads = 0; intruder = m[key] + "  ";
  assert.equal(a.supersede(k1, "x#1", "r").reason, "store_unsound");
  // an empty-string / absent key are the same "nothing stored" for the guard
  const e = { v: "", getItem: () => e.v, setItem: (k, v) => { e.v = v; } };
  assert.equal(createEvidenceStore({ storage: e, chainId: 143 }).append({ txHash: H(1) }).ok, true);
}
// ---- [A-895 P-C / A-887 I3] byte bound + quota failure stays fail-closed ------------------------------
{
  const key = "araso.txEvidence.v1.143";
  assert.ok(MAX_EVIDENCE_BYTES > 0 && MAX_EVIDENCE_BYTES <= 1024 * 1024);
  const s = mem(); const a = createEvidenceStore({ storage: s, chainId: 143 });
  assert.equal(a.append({ txHash: H(1), status: "success" }).ok, true);
  const good = s.m[key];
  // a single oversized value (revert blob) is refused with store_full and writes nothing
  const big = a.append({ txHash: H(2), revert: { reason: "x".repeat(MAX_EVIDENCE_BYTES) } });
  assert.deepEqual([big.ok, big.reason], [false, "store_full"]); assert.equal(s.m[key], good);
  // many medium rows hit the byte bound before the row cap, and every refused call leaves storage unchanged
  let full = null;
  for (let i = 10; i < 400 && !full; i += 1) {
    const r = a.append({ txHash: H(i), revert: { reason: "y".repeat(8000) } });
    if (!r.ok) full = r;
  }
  assert.ok(full, "byte bound reached"); assert.equal(full.reason, "store_full");
  assert.ok(s.m[key].length <= MAX_EVIDENCE_BYTES);
  const snap = s.m[key];
  assert.equal(a.append({ txHash: H(399), revert: { reason: "z".repeat(8000) } }).reason, "store_full"); assert.equal(s.m[key], snap);
  assert.equal(a.readAll().ok, true); // reads still work at the bound
}
{
  // Quota: shared origin storage. SEND_PENDING (araso.sendPending) and the evidence store use the same quota. A quota error on the
  // evidence write is { ok:false, store_unsound }, never a throw, never a partial write, and it leaves SEND_PENDING byte-identical.
  const key = "araso.txEvidence.v1.143";
  const quota = (limit) => { const m = {}; return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => {
    const used = Object.entries(m).reduce((n, [kk, vv]) => n + (kk === k ? 0 : kk.length + vv.length), 0);
    if (used + k.length + String(v).length > limit) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
    m[k] = String(v);
  } }; };
  const st = quota(2000);
  st.m["araso.sendPending"] = JSON.stringify({ stage: "deposit-broadcast", at: 1 });
  const pendingBefore = st.m["araso.sendPending"];
  const ev = createEvidenceStore({ storage: st, chainId: 143 });
  let r; assert.doesNotThrow(() => { r = ev.append({ txHash: H(1), revert: { reason: "q".repeat(5000) } }); });
  assert.deepEqual([r.ok, r.reason], [false, "store_unsound"]);
  assert.equal(key in st.m, false); assert.equal(st.m["araso.sendPending"], pendingBefore);

  // SEND_PENDING side (real main.js functions, extracted verbatim): once the quota is gone, writeSendPending THROWS (the existing
  // "stop" contract: before the deposit nothing is sent) and readSendPending reports an unreadable store as { stage:"unknown" }
  // (busy), never as "nothing in flight".
  const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const grab = (name) => { const i = MAIN.indexOf(`function ${name}(`); assert.ok(i >= 0, name); const j = MAIN.indexOf("\n}\n", i); return MAIN.slice(i, j + 3); };
  const build = (ls) => new Function("localStorage", "SEND_PENDING_KEY", "SEND_PENDING_STAGES", `${grab("readSendPending")}\n${grab("writeSendPending")}\nreturn { readSendPending, writeSendPending };`)(
    ls, "araso.sendPending", ["reserved", "deposit-sending", "deposit-broadcast", "redeem-sending", "redeem-broadcast"]);
  const full = quota(60);
  full.m["filler"] = "f".repeat(50);
  const { readSendPending, writeSendPending } = build(full);
  assert.throws(() => writeSendPending({ stage: "reserved", reservationId: "r1" }), /Quota/);
  assert.equal("araso.sendPending" in full.m, false);
  // after a failed write nothing is "not in flight" if the record is unreadable
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  const b = build(broken);
  assert.deepEqual(b.readSendPending(), { stage: "unknown" });
  assert.throws(() => b.writeSendPending({ stage: "reserved" }));
  // a setItem that silently drops (no throw, no persistence) is caught by the verified read-back
  const drop = { getItem: () => null, setItem: () => {} };
  assert.throws(() => build(drop).writeSendPending({ stage: "reserved" }), /send_pending_unverified/);
  // and an evidence-store byte/quota failure never writes to the pending key
  assert.equal(ev.readAll().ok, true);
}
{ // [A-895 P-C / L-3] the reader's `canonical` marker is a writable field and survives persist
  const s2 = mem(); const a = createEvidenceStore({ storage: s2, chainId: 143 });
  const k = a.append({ txHash: H(1), status: "success", canonical: "unverified_canonical" }).evidenceKey;
  assert.equal(a.get(k).row.canonical, "unverified_canonical");
}
// isolation: no imports, no network/timers/DOM globals
assert.equal(/^\s*import\s/m.test(SRC), false);
assert.equal(/\b(fetch|XMLHttpRequest|setTimeout|setInterval|document|window|navigator|localStorage)\b/.test(SRC.replace(/\/\/.*$/gm, "")), false);
console.log("A-868 receipt evidence store: PASS");
