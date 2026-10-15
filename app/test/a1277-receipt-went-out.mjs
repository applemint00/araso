// The first Receipt's "went out" row shows when the deposit actually left (same h:mm form as "came back");
// older receipts without that moment keep "—", and "kept" stays "—".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { receiptPaperFields } from "../src/receipt-paper.js";
import { decodeReceiptRow, encodeReceiptRow } from "../src/receipt-codec.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (label, fn) => { try { fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${String(e.message).split("\n")[0]}`); fail += 1; } };
const hm = (t) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const out = Date.UTC(2026, 9, 15, 0, 12, 18), back = out + 40_000;
const base = { before: 100n, after: 99n, gas: 1n, sent: 1n, txHash: `0x${"ab".repeat(32)}`, depositTxHash: `0x${"cd".repeat(32)}`, redeemTxHash: `0x${"ab".repeat(32)}`, status: "success", at: back };

check("new receipt: went out = the deposit's departure time, h:mm like came back; kept stays —", () => {
  const f = receiptPaperFields({ receipt: { ...base, wentOutAt: out }, name: "Pa" });
  assert.equal(f.wentOut, hm(out));
  assert.equal(f.cameBack, hm(back));
  assert.equal(f.kept, "—");
});
check("old receipt without a departure time: went out stays —", () => {
  assert.equal(receiptPaperFields({ receipt: base }).wentOut, "—");
});
check("receipt store keeps the departure time; old rows decode without it", () => {
  const row = encodeReceiptRow({ ...base, wentOutAt: out });
  assert.equal(decodeReceiptRow(JSON.parse(JSON.stringify(row))).wentOutAt, out);
  const old = encodeReceiptRow(base);
  assert.equal(Object.hasOwn(old, "wentOutAt"), false);
  assert.equal(Object.hasOwn(decodeReceiptRow(JSON.parse(JSON.stringify(old))), "wentOutAt"), false);
});
check("main.js: the departure moment is taken right after the deposit is marked sent and carried into the receipt", () => {
  assert.match(MAIN, /markSendPhaseSent\(reservation, \{ stage: "deposit-broadcast"[^\n]*\);\s*const wentOutAt = Date\.now\(\);/);
  assert.match(MAIN, /wentOutAt,\s*\n\s*\}\)\s*\n\s*\.then\(\(trip\) =>/);
  assert.match(MAIN, /async function settleSend\(\{[^}]*wentOutAt/);
  assert.match(MAIN, /\.\.\.\(Number\.isSafeInteger\(wentOutAt\) && wentOutAt > 0 \? \{ wentOutAt \} : \{\}\)/);
});
console.log(`\nA1277 went out: ${pass} PASS / ${fail} FAIL`);
if (fail) process.exitCode = 1;
