// [A-931] Receipt grade hardening (A-929 G3 + G5). Node only, no network.
// G3: reconcileConfirmedFunding records only evidence whose status is FUNDING_STATE.CONFIRMED; missing / other = refused, nothing recorded.
// G5: the add_money receipt keeps its status through encode / decode; an old row without status reads "unknown" (never confirmed).
// Regression (Cowork [답 A-931]): the REAL caller lines — main.js settleConfirmedFundingEvidence `evidence` / `typedReceipt` object literals, cut from the
// source and evaluated as written — fed by the real applyFundingResult, still reconcile a confirmed Add money (balance row updated).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeReceiptRow, encodeReceiptRow } from "../src/receipt-codec.js";
import { applyFundingResult, FUNDING_STATE } from "../src/funding-entry.js";
import { reconcileConfirmedFunding } from "../src/funding-reconcile.js";
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-931 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const TOK = "0x" + "a".repeat(40), TGT = "0x" + "b".repeat(40), TX = "0x" + "c".repeat(64);
const piggies = () => [{ id: "p1", name: "Honeybun", address: TGT, location: "home", assets: [] }];
const ev = (extra = {}) => ({ chainId: "monad-testnet", tokenAddress: TOK, targetAddress: TGT, targetPiggyId: "p1", txHash: TX, decimals: 6, assetSymbol: "USDC", ...extra });
const client = (raw = 5_000_000n) => ({ readContract: async () => raw, getBlockNumber: async () => 7n });
const run = (evidence) => reconcileConfirmedFunding({ evidence, piggies: piggies(), client: client(), runtimeChainId: "monad-testnet", now: "2026-10-10T00:00:00.000Z", seenEvidenceKeys: new Set() });
const usdcRow = (r) => (r.piggies[0].assets || []).find((a) => a.assetId === TOK);

await check("G3 status confirmed → recorded (measured 5 USDC row)", async () => { const r = await run(ev({ status: FUNDING_STATE.CONFIRMED })); assert.equal(r.ok, true); assert.ok(usdcRow(r)); });
for (const s of [undefined, null, "", "pending", "failed", "unknown", "accepted", "included", "CONFIRMED", "success"]) {
  await check(`G3 status ${JSON.stringify(s)} → refused, nothing recorded`, async () => {
    const r = await run(ev(s === undefined ? {} : { status: s }));
    assert.equal(r.ok, false); assert.equal(r.reason, "evidence_not_confirmed"); assert.equal(usdcRow(r), undefined); assert.equal(r.valuationKnown, null);
  });
}
await check("G3 non-confirmed evidence with an already-seen key is still refused (status check before the seen-key check)", async () => {
  const seen = new Set(); const first = await reconcileConfirmedFunding({ evidence: ev({ status: FUNDING_STATE.CONFIRMED }), piggies: piggies(), client: client(), runtimeChainId: "monad-testnet", now: "t", seenEvidenceKeys: seen });
  seen.add(first.dedupeKey);
  const r = await reconcileConfirmedFunding({ evidence: ev({ status: "pending" }), piggies: piggies(), client: client(), runtimeChainId: "monad-testnet", now: "t", seenEvidenceKeys: seen });
  assert.equal(r.ok, false); assert.equal(r.reason, "evidence_not_confirmed");
});
await check("G5 new add_money receipt: status round-trips (encode → decode → encode)", () => {
  const rec = { kind: "add_money", chainId: "monad-testnet", token: TOK, amount: "5", txHash: TX, at: 1, status: "confirmed", piggyId: "p1" };
  const row = encodeReceiptRow(rec); assert.equal(row.status, "confirmed");
  const back = decodeReceiptRow(row); assert.equal(back.status, "confirmed"); assert.equal(encodeReceiptRow(back).status, "confirmed");
});
await check("G5 old add_money row (no status) reads \"unknown\", never confirmed; nothing else changes", () => {
  const row = { kind: "add_money", chainId: "monad-testnet", token: TOK, amount: "5", txHash: TX, at: 1 };
  const d = decodeReceiptRow(row); assert.equal(d.status, "unknown");
  assert.deepEqual({ ...d, status: undefined }, { kind: "add_money", chainId: "monad-testnet", token: TOK, amount: "5", txHash: TX, at: 1, status: undefined });
});
await check("G5 encode without a status writes no status key (old callers unchanged)", () => {
  assert.equal("status" in encodeReceiptRow({ kind: "add_money", chainId: "c", token: TOK, amount: "1", txHash: TX, at: 1 }), false);
});

// ── regression through the real caller lines ──
const MAIN = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js"), "utf8");
const fnStart = MAIN.indexOf("async function settleConfirmedFundingEvidence(");
const literal = (name) => { const i = MAIN.indexOf(`  const ${name} = {`, fnStart); assert.ok(i > fnStart, `${name} literal`); const j = MAIN.indexOf("\n  };", i); return MAIN.slice(MAIN.indexOf("{", i), j + 4); };
await check("caller: main.js settleConfirmedFundingEvidence passes status on BOTH evidence and typedReceipt ([A-931] markers)", () => {
  for (const n of ["evidence", "typedReceipt"]) { const lit = literal(n); assert.match(lit, /status: receipt\.status, \/\/ \[A-931\]/); }
});
await check("regression: real applyFundingResult + the real main.js evidence literal → confirmed Add money still reconciles (balance row updated)", async () => {
  const intent = { targetChain: "monad-testnet", targetAsset: TOK, target: TGT, targetPiggyId: "p1", method: "crypto", railId: "r", requestedAmount: "5" };
  const applied = applyFundingResult(intent, { status: FUNDING_STATE.CONFIRMED, chain: "monad-testnet", asset: TOK, target: TGT, amount: "5", txHash: TX, at: "t" });
  assert.equal(applied.state, FUNDING_STATE.CONFIRMED); assert.equal(applied.receipt.status, "confirmed");
  const context = { chainId: "monad-testnet", assetId: TOK, targetAddress: TGT, targetPiggyId: "p1", decimals: 6, assetSymbol: "USDC" };
  const receipt = applied.receipt, nowValue = "t";
  const evidence = new Function("context", "receipt", `return (${literal("evidence")});`)(context, receipt);
  const typedReceipt = new Function("context", "receipt", "nowValue", `return (${literal("typedReceipt")});`)(context, receipt, nowValue);
  assert.equal(evidence.status, "confirmed"); assert.equal(typedReceipt.status, "confirmed");
  const r = await run(evidence); assert.equal(r.ok, true); assert.ok(usdcRow(r), "balance row recorded");
  assert.equal(decodeReceiptRow(encodeReceiptRow(typedReceipt)).status, "confirmed");
});
await check("network calls = 0", () => assert.equal(fetchCalls, 0));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
