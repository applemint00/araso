import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as R from "../src/receipt-evidence-reader.js";
import * as S from "../src/receipt-evidence-store.js";

const H = "0x" + "AB".repeat(32), BH = "0x" + "cd".repeat(32), BH2 = "0x" + "ef".repeat(32);
const ADDR = "0x" + "11".repeat(20);
const FROM = "0x" + "22".repeat(20), TO = "0x" + "33".repeat(20);
const mk = (o = {}) => async (m, p) => {
  if (m === "eth_getTransactionCount") { if (o.deny?.includes(m)) throw new Error("nope"); return o.count ?? "0x2"; }
  if (o.deny?.includes(m)) throw new Error("nope");
  if (m === "eth_chainId") return "0x8f";
  if (m === "eth_getTransactionReceipt") return "receipt" in o ? o.receipt : { transactionHash: H.toLowerCase(), status: "0x1", blockNumber: "0xa", blockHash: BH, transactionIndex: "0x0", gasUsed: "0x5" };
  if (m === "eth_getTransactionByHash") return "tx" in o ? o.tx : { hash: H, from: FROM, to: TO, nonce: "0x2", gas: "0x10" };
  if (m === "eth_getBlockByNumber") { if (p[0] === "safe") return { number: "0xc", hash: BH }; if (p[0] === "finalized") return o.finNum ? { number: o.finNum, hash: BH } : { number: "0x5", hash: BH }; return { number: "0xa", hash: o.canon || BH }; }
  if (m === "eth_getBalance") { if (o.histFail && p[1] === "0x9") throw new Error("missing trie node"); return "0x64"; }
  throw new Error("unexpected " + m);
};
const t = async (n, f) => { await f(); console.log("PASS", n); };

await t("key identical to store", () => {
  for (const a of [{ chainId: 143, txHash: H }, { chainId: "10143", txHash: H, logIndex: 3 }, { chainId: 1, txHash: "0x12" }, { chainId: 0, txHash: H }, { chainId: 1, txHash: H, logIndex: -1 }, {}, undefined])
    assert.equal(R.evidenceKey(a), S.evidenceKey(a));
  assert.equal(R.evidenceKey({ chainId: 143, txHash: H }), `evidence|143|${H.toLowerCase()}|tx`);
  assert.equal(R.evidenceKey({ chainId: 143, txHash: H, logIndex: 0 }), `evidence|143|${H.toLowerCase()}|0`);
  assert.equal(R.EVIDENCE_SCHEMA, S.EVIDENCE_SCHEMA);
});
await t("success + proposed, feeBasis unresolved", async () => {
  const r = await R.readTxEvidence({ rpc: mk(), chainId: 143, hash: H });
  assert.equal(r.ok, true); assert.equal(r.row.status, "success"); assert.equal(r.row.commitState, "proposed");
  assert.equal(r.row.feeBasis, "unresolved"); assert.equal(r.row.schema, "araso_tx_evidence_v1"); assert.equal(r.row.nonce, 2); assert.equal(r.class, null);
  assert.equal(r.row.evidenceKey, S.evidenceKey({ chainId: 143, txHash: H }));
});
await t("reverted", async () => {
  const r = await R.readTxEvidence({ rpc: mk({ receipt: { transactionHash: H, status: "0x0", blockNumber: "0xa", blockHash: BH } }), chainId: 143, hash: H });
  assert.equal(r.class, "reverted"); assert.equal(r.row.status, "reverted");
});
await t("null receipt = not_found, never failed/reverted", async () => {
  const r = await R.readTxEvidence({ rpc: mk({ receipt: null, tx: null }), chainId: 143, hash: H });
  assert.equal(r.row.status, "not_found"); assert.equal(r.class, "unconfirmed"); assert.notEqual(r.class, "reverted");
});
await t("null receipt + known tx = pending", async () => {
  const r = await R.readTxEvidence({ rpc: mk({ receipt: null }), chainId: 143, hash: H });
  assert.equal(r.class, "pending"); assert.equal(r.row.status, "not_found");
});
await t("rpc error = read_failed, status unknown", async () => {
  const r = await R.readTxEvidence({ rpc: mk({ deny: ["eth_getTransactionReceipt"] }), chainId: 143, hash: H });
  assert.equal(r.class, "read_failed"); assert.equal(r.row.status, "unknown");
  const r2 = await R.readTxEvidence({ rpc: mk({ receipt: null, deny: ["eth_getTransactionByHash"] }), chainId: 143, hash: H });
  assert.equal(r2.class, "read_failed"); assert.equal(r2.row.status, "unknown");
});
await t("chain mismatch / bad input / bad rpc never throw", async () => {
  assert.equal((await R.readTxEvidence({ rpc: mk(), chainId: 1, hash: H })).class, "read_failed");
  assert.equal((await R.readTxEvidence({})).ok, false);
  assert.equal((await R.readTxEvidence({ rpc: 5, chainId: 143, hash: H })).class, "read_failed");
  assert.equal((await R.readTxEvidence({ rpc: mk({ receipt: { status: "0x7" } }), chainId: 143, hash: H })).class, "read_failed");
  assert.deepEqual((await R.readTxEvidenceBatch(null)), []);
  assert.equal(R.classifyEvidence(null).class, "read_failed");
});
await t("finality inferred: safe->voted, finalized->finalized, no invented depth", async () => {
  const f = await R.readTxEvidence({ rpc: mk(), chainId: 143, hash: H, finality: { tags: ["safe", "finalized"] } });
  assert.equal(f.row.commitState, "voted"); assert.equal(f.row.trust, "T2");
  const g = await R.readTxEvidence({ rpc: mk({ finNum: "0xb" }), chainId: 143, hash: H, finality: { tags: ["safe", "finalized"] } });
  assert.equal(g.row.commitState, "finalized"); assert.equal(g.row.tagUsed, "finalized");
  const n = await R.readTxEvidence({ rpc: mk(), chainId: 143, hash: H });
  assert.equal(n.row.commitState, "proposed");
});
await t("reorg: canonical hash differs at finalized/safe height -> reorged", async () => {
  const r = await R.readTxEvidence({ rpc: mk({ canon: BH2 }), chainId: 143, hash: H, finality: { tags: ["safe"] } });
  assert.equal(r.class, "reorged");
});
await t("reorg: stored blockHash differs -> reorged, row not deleted", async () => {
  const stored = { chainId: "143", txHash: H.toLowerCase(), status: "success", blockHash: BH2, commitState: "proposed" };
  const r = await R.readTxEvidence({ rpc: mk(), chainId: 143, hash: H, stored });
  assert.equal(r.class, "reorged"); assert.equal(r.reconcile.outcome, "reorged"); assert.equal(r.reconcile.supersededBy, BH);
});
await t("reconcile: unsettled fresh never overwrites; upgrade; conflict", () => {
  const s = { chainId: "143", txHash: H, status: "success", blockHash: BH, commitState: "proposed" };
  assert.equal(R.reconcileEvidence({ ...s, status: "unknown" }, { chainId: "143", txHash: H, status: "not_found" }).outcome, "unchanged");
  assert.equal(R.reconcileEvidence(s, { ...s, commitState: "finalized" }).outcome, "upgrade");
  assert.equal(R.reconcileEvidence(s, { ...s, status: "reverted" }).outcome, "conflict");
  assert.equal(R.reconcileEvidence(null, s).outcome, "new");
});
await t("historic-state failure -> null, never 0", async () => {
  const r = await R.readTxEvidence({ rpc: mk({ histFail: true }), chainId: 143, hash: H, expect: { address: ADDR } });
  assert.equal(r.row.balanceBefore, null); assert.notEqual(r.row.balanceBefore, 0); assert.equal(r.row.balanceAfter, "0x64");
  const r2 = await R.readTxEvidence({ rpc: mk({ deny: ["eth_getBalance"] }), chainId: 143, hash: H, expect: { address: ADDR } });
  assert.equal(r2.row.balanceBefore, null); assert.equal(r2.row.balanceAfter, null);
});
await t("whitelist excludes send/getLogs and is enforced", async () => {
  for (const m of ["eth_sendRawTransaction", "eth_sendTransaction", "eth_getLogs", "eth_sign", "personal_sign"]) assert.ok(!R.READ_WHITELIST.includes(m), m);
  const seen = [];
  await R.readTxEvidence({ rpc: async (m) => { seen.push(m); return null; }, chainId: 143, hash: H, finality: { tags: ["safe"] } });
  assert.ok(seen.every((m) => R.READ_WHITELIST.includes(m)));
});
await t("isolation: no imports, no signer/session/permission params", () => {
  const src = readFileSync(new URL("../src/receipt-evidence-reader.js", import.meta.url), "utf8");
  assert.ok(!/^\s*import\s/m.test(src) && !/\bimport\s*\(/.test(src) && !/require\(/.test(src));
  for (const n of ["money-executor", "permission-envelope", "second-job-readiness"]) assert.ok(!src.includes(`from "`) && !new RegExp(`['"][^'"]*${n}`).test(src), n);
  assert.ok(!/setTimeout|setInterval|fetch\(|localStorage/.test(src));
  const sig = src.match(/export async function readTxEvidence\(\{([^}]*)\}/)[1];
  for (const w of ["signer", "session", "permission", "privateKey", "account", "wallet"]) assert.ok(!sig.toLowerCase().includes(w), w);
});
await t("(a) receipt/tx hash mismatch -> read_failed", async () => {
  const other = "0x" + "cd".repeat(32);
  const r = await R.readTxEvidence({ rpc: mk({ receipt: { transactionHash: other, status: "0x1", blockNumber: "0xa", blockHash: BH } }), chainId: 143, hash: H });
  assert.equal(r.class, "read_failed"); assert.equal(r.reason, "receipt_hash_mismatch"); assert.notEqual(r.row.status, "success");
  const r2 = await R.readTxEvidence({ rpc: mk({ tx: { hash: other, from: FROM, nonce: "0x2" } }), chainId: 143, hash: H });
  assert.equal(r2.reason, "receipt_hash_mismatch"); assert.notEqual(r2.row.status, "success");
  const r3 = await R.readTxEvidence({ rpc: mk({ receipt: { status: "0x1", blockNumber: "0xa", blockHash: BH } }), chainId: 143, hash: H });
  assert.equal(r3.reason, "receipt_hash_mismatch");
  assert.equal((await R.readTxEvidence({ rpc: mk(), chainId: 143, hash: H.toUpperCase().replace("0X", "0x") })).row.status, "success");
});
await t("(b) from/to compare", async () => {
  const ok = await R.readTxEvidence({ rpc: mk(), chainId: 143, hash: H, expect: { from: FROM.toUpperCase().replace("0X", "0x"), to: TO } });
  assert.equal(ok.row.status, "success"); assert.equal(ok.row.from, FROM); assert.equal(ok.row.to, TO);
  const bf = await R.readTxEvidence({ rpc: mk(), chainId: 143, hash: H, expect: { from: "0x" + "99".repeat(20) } });
  assert.equal(bf.row.status, "unknown"); assert.equal(bf.reason, "from_mismatch");
  const bt = await R.readTxEvidence({ rpc: mk(), chainId: 143, hash: H, expect: { to: "0x" + "99".repeat(20) } });
  assert.equal(bt.row.status, "unknown"); assert.equal(bt.reason, "to_mismatch");
});
await t("(c) settled then not_found -> reorged, not unchanged", async () => {
  for (const status of ["success", "reverted"]) {
    const s = { chainId: "143", txHash: H.toLowerCase(), status, blockHash: BH, commitState: "proposed" };
    assert.equal(R.reconcileEvidence(s, { ...s, status: "not_found", blockHash: null }).outcome, "reorged");
  }
  const r = await R.readTxEvidence({ rpc: mk({ receipt: null, tx: null }), chainId: 143, hash: H, stored: { chainId: "143", txHash: H.toLowerCase(), status: "success", blockHash: BH } });
  assert.equal(r.class, "reorged");
});
await t("(d) nonceConsumed", async () => {
  const a = await R.readTxEvidence({ rpc: mk({ receipt: null, count: "0x3" }), chainId: 143, hash: H });
  assert.equal(a.row.nonceConsumed, true); assert.equal(a.class, "unconfirmed"); assert.equal(a.reason, "nonce_consumed_possibly_replaced_or_dropped"); // [A-895 P-C r1] "possibly", not a terminal verdict
  const b = await R.readTxEvidence({ rpc: mk({ receipt: null, count: "0x2" }), chainId: 143, hash: H });
  assert.equal(b.row.nonceConsumed, false); assert.equal(b.class, "pending");
  const c = await R.readTxEvidence({ rpc: mk({ receipt: null, tx: null }), chainId: 143, hash: H });
  assert.equal(c.row.nonceConsumed, "unknown");
  const d = await R.readTxEvidence({ rpc: mk({ receipt: null, deny: ["eth_getTransactionCount"] }), chainId: 143, hash: H });
  assert.equal(d.row.nonceConsumed, "unknown"); assert.equal(d.class, "pending");
  const e = await R.readTxEvidence({ rpc: mk({ count: "0x3" }), chainId: 143, hash: H });
  assert.equal(e.row.nonceConsumed, true);
});
// ---- [A-895 P-C] A-866 r1 / r2 / r3 ------------------------------------------------------------------
await t("r1: nonce consumed because THIS tx mined between the two reads -> receipt re-read once -> pending, never replaced/dropped", async () => {
  let receiptReads = 0;
  const base = mk({ count: "0x3" });
  const rpc = async (m, p) => {
    if (m === "eth_getTransactionReceipt") { receiptReads += 1; return receiptReads === 1 ? null : { transactionHash: H.toLowerCase(), status: "0x1", blockNumber: "0xa", blockHash: BH }; }
    return base(m, p);
  };
  const r = await R.readTxEvidence({ rpc, chainId: 143, hash: H });
  assert.equal(receiptReads, 2);
  assert.equal(r.class, "pending"); assert.equal(r.reason, "receipt_appeared_on_reread"); assert.equal(r.row.status, "not_found");
  assert.notEqual(r.row.status, "success"); // a re-read hint, never a promotion
  // still null on the re-read -> the weaker "possibly" verdict, class unconfirmed (never failed/reverted)
  receiptReads = 0;
  const r2 = await R.readTxEvidence({ rpc: mk({ receipt: null, count: "0x3" }), chainId: 143, hash: H });
  assert.equal(r2.class, "unconfirmed"); assert.match(r2.reason, /possibly/);
  // re-read that throws is the same as still-null (no throw)
  let n = 0;
  const flaky = async (m, p) => { if (m === "eth_getTransactionReceipt") { n += 1; if (n > 1) throw new Error("x"); return null; } return mk({ receipt: null, count: "0x3" })(m, p); };
  const r3 = await R.readTxEvidence({ rpc: flaky, chainId: 143, hash: H });
  assert.equal(r3.ok, true); assert.equal(r3.class, "unconfirmed");
});
await t("r2: no finality tag -> canonical hash at the receipt height is still checked (verified / mismatch / unverified_canonical)", async () => {
  const ok = await R.readTxEvidence({ rpc: mk(), chainId: 143, hash: H });
  assert.equal(ok.row.canonical, "verified"); assert.equal(ok.row.commitState, "proposed"); assert.equal(ok.class, null);
  const bad = await R.readTxEvidence({ rpc: mk({ canon: BH2 }), chainId: 143, hash: H });
  assert.equal(bad.class, "reorged"); assert.equal(bad.row.canonical, "mismatch"); assert.equal(bad.reason, "block_hash_changed");
  const un = await R.readTxEvidence({ rpc: mk({ deny: ["eth_getBlockByNumber"] }), chainId: 143, hash: H });
  assert.equal(un.row.canonical, "unverified_canonical"); assert.equal(un.row.status, "success"); assert.equal(un.row.commitState, "proposed"); assert.equal(un.class, null);
  const junk = await R.readTxEvidence({ rpc: async (m, p) => (m === "eth_getBlockByNumber" ? { hash: "0xzz" } : mk()(m, p)), chainId: 143, hash: H });
  assert.equal(junk.row.canonical, "unverified_canonical");
  // with tags the tag path decides, and the row says so
  const tagged = await R.readTxEvidence({ rpc: mk(), chainId: 143, hash: H, finality: { tags: ["safe"] } });
  assert.equal(tagged.row.canonical, "verified"); assert.equal(tagged.row.commitState, "voted");
  // tags unusable (tag block behind the receipt) -> falls back to the direct canonical check
  const behind = await R.readTxEvidence({ rpc: mk({ canon: BH2, finNum: "0x5" }), chainId: 143, hash: H, finality: { tags: ["finalized"] } });
  assert.equal(behind.class, "reorged"); assert.equal(behind.row.canonical, "mismatch");
});
await t("r3: reader and store share ONE evidenceKey contract (cross-equality over a hostile grid; module independence kept)", () => {
  const chains = [143, 10143, "143", "10143", 0, -1, 1.5, "0143", "", null, undefined, 2 ** 60, "9".repeat(17), {}];
  const hashes = [H, H.toLowerCase(), "0x" + "0".repeat(64), "0x" + "g".repeat(64), "0x12", "", null, undefined, 5, "0X" + "ab".repeat(32)];
  const logs = [undefined, null, 0, 1, 2 ** 53, -1, 1.5, NaN, "0", "x", 1n, {}];
  let cmp = 0;
  for (const chainId of chains) for (const txHash of hashes) for (const logIndex of logs) {
    const a = (() => { try { return R.evidenceKey({ chainId, txHash, logIndex }); } catch (e) { return "THROW"; } })();
    const b = (() => { try { return S.evidenceKey({ chainId, txHash, logIndex }); } catch (e) { return "THROW"; } })();
    assert.equal(a, b, JSON.stringify({ chainId, txHash, logIndex }, (k, v) => (typeof v === "bigint" ? `${v}n` : Number.isNaN(v) ? "NaN" : v)));
    cmp += 1;
  }
  assert.ok(cmp > 1000);
  // sources: both modules keep zero imports (purity), so parity is enforced HERE, not by an import that would couple them
  for (const f of ["../src/receipt-evidence-reader.js", "../src/receipt-evidence-store.js"])
    assert.equal(/^\s*import\s/m.test(readFileSync(new URL(f, import.meta.url), "utf8")), false, f);
});
console.log("a866 ALL PASS");
