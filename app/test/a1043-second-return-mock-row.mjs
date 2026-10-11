// [A-1043 · Owner 10-11 20:5x] Second Return Receipt: the mock path drops its "> mock · <status>" row (the fork/mock marker already shows at every
// send). The real-receipt path keeps its status row; every other row of the mock paper stays. renderSecondReturn is taken from main.js as text and run
// with the REAL receipt-paper.js / second-journey-view.js formatters (no browser, no network).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { receiptPaperMarkup, receiptPaperFields } from "../src/receipt-paper.js";
import { secondJourneyReceiptFields } from "../src/second-journey-view.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(path.join(HERE, "..", "src", "main.js"), "utf8");
let pass = 0;
const check = (name, fn) => { fn(); pass += 1; console.log(`ok  ${name}`); };

function fnBody(name) {
  const m = new RegExp(`function ${name}\\s*\\(`).exec(MAIN);
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = MAIN.indexOf("{", MAIN.indexOf(")", m.index)); i < MAIN.length; i += 1) {
    if (MAIN[i] === "{") depth += 1;
    else if (MAIN[i] === "}") { depth -= 1; if (depth === 0) return MAIN.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}
const render = (stateObj) => new Function(
  "state", "returnSceneMarkup", "receiptPaperMarkup", "receiptPaperFields", "secondJourneyReceiptFields",
  "chogHomeMarkupForReturn", "displayPiggyName", "isDevDebugOptIn", "isDevMockReceipt",
  `${fnBody("renderSecondReturn")}\nreturn renderSecondReturn;`,
)(stateObj, (args) => args, receiptPaperMarkup, receiptPaperFields, secondJourneyReceiptFields, () => "<chog/>", () => "Honeybun", () => false,
  (c) => !!c?.devPreview || c?.evidenceClass === "dev_preview" || c?.evidenceClass === "mock")();

const MOCK = { attempted: true, decidedStatus: "JOB_READY", cost: { amount: "0", source: "mock_placeholder" } };

check("mock path: no receiptPaper__status row and no 'mock ·' text on the paper", () => {
  const rows = render({ secondJourney: { executionReceipt: null, mockReceipt: MOCK } }).receiptRowsMarkup;
  assert.equal(typeof rows, "string");
  assert.equal(/receiptPaper__status/.test(rows), false);
  assert.equal(/mock ·/.test(rows), false);
});
check("mock path: every other row stays (name · went out · came back · kept amount · both rules · teeth)", () => {
  const rows = render({ secondJourney: { executionReceipt: null, mockReceipt: MOCK } }).receiptRowsMarkup;
  const full = receiptPaperMarkup(secondJourneyReceiptFields(MOCK, "Honeybun"));
  assert.equal((rows.match(/receiptPaper__row/g) || []).length, 3);
  assert.equal((rows.match(/receiptPaper__rule/g) || []).length, 2);
  // [A-1047 RE-PIN · Owner 10-11 21:3x] the kept cell shows the amount only (no "(source)"); pre-A-1047: assert.match(rows, /mock_placeholder/);
  assert.equal(/mock_placeholder/.test(rows), false);
  assert.match(rows, /<span>kept<\/span><span>0<\/span>/);
  assert.match(rows, /receiptPaper__teeth/);
  for (const label of ["went out", "came back", "kept"]) assert.match(rows, new RegExp(`<span>${label}</span>`), `row "${label}" stays`);
  // independent of the implementation's regex: the exact row receipt-paper.js prints for this status, removed as a literal string
  const exactRow = '\n        <div class="receiptPaper__status">&gt; mock · job_ready</div>';
  assert.equal(full.split(exactRow).length, 2, "the full paper prints the mock row exactly once");
  assert.equal(rows, full.replace(exactRow, ""), "only that row differs");
});
check("real path: the real receipt keeps its status row (unchanged)", () => {
  const actual = { eventId: "e1", outcome: "done", evidenceClass: "PASS_TESTNET_ACTUAL_TX", executionMode: "testnet_actual", txHash: `0x${"a".repeat(64)}`, at: Date.now() };
  const rows = render({ secondJourney: { executionReceipt: actual, mockReceipt: MOCK } }).receiptRowsMarkup;
  assert.equal(rows, receiptPaperMarkup(receiptPaperFields({ receipt: actual, name: "Honeybun" })));
  assert.match(rows, /receiptPaper__status/);
});
console.log(`a1043 second return mock row: ${pass} PASS`);
