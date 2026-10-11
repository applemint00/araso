// [A-1047 · Owner 10-11 21:3x] Second Return mock Receipt: the internal cost source ("mock_placeholder") is not printed — the kept cell is the amount
// only. The data keeps it (cost.source is still read by the evidence checks), the mock is never shown as a success, and the real-receipt formatter
// is untouched. No browser, no network.
import assert from "node:assert/strict";
import { receiptPaperMarkup, receiptPaperFields } from "../src/receipt-paper.js";
import { secondJourneyReceiptFields } from "../src/second-journey-view.js";

let pass = 0;
const check = (name, fn) => { fn(); pass += 1; console.log(`ok  ${name}`); };
const MOCK = Object.freeze({ attempted: true, decidedStatus: "JOB_READY", cost: Object.freeze({ amount: "0", source: "mock_placeholder" }) });

check("kept = amount only; no '(mock_placeholder)' anywhere in the printed paper", () => {
  const f = secondJourneyReceiptFields(MOCK, "Honeybun");
  assert.equal(f.kept, "0");
  const html = receiptPaperMarkup(f);
  assert.equal(/mock_placeholder/.test(html), false);
  assert.match(html, /<span>kept<\/span><span>0<\/span>/);
});
check("the internal source stays in the data the evidence checks read (input untouched)", () => {
  secondJourneyReceiptFields(MOCK, "Honeybun");
  assert.equal(MOCK.cost.source, "mock_placeholder");
});
check("the mock is still not a success: status word comes from decidedStatus, never 'done'", () => {
  const f = secondJourneyReceiptFields(MOCK, "Honeybun");
  assert.notEqual(f.statusLabel, "done");
  assert.match(f.statusLabel, /job_ready/);
});
check("no cost → kept stays an em dash (unchanged)", () => {
  assert.equal(secondJourneyReceiptFields({ attempted: true, decidedStatus: "UNKNOWN" }, "Honeybun").kept, "—");
});
check("real-receipt formatter path unchanged (receiptPaperFields does not use secondJourneyReceiptFields)", () => {
  const actual = { eventId: "e1", outcome: "done", evidenceClass: "PASS_TESTNET_ACTUAL_TX", executionMode: "testnet_actual", txHash: `0x${"b".repeat(64)}`, at: Date.now() };
  const f = receiptPaperFields({ receipt: actual, name: "Honeybun" });
  assert.equal(/mock/.test(JSON.stringify(f)), false);
});
console.log(`a1047 receipt placeholder hidden: ${pass} PASS`);
