// [A-1354 · Design canvas A.dc.html] Gift pick markup: amount · from · hint order; the hint words; the exact "for this Gift" line and the gas /
// Araso fee line sit by Send (two lines, as in the canvas) and are no longer in the middle; a line with buttons (MON path) stays in the middle.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { a911GiftMarkup } = await import(path.join(REPO, "app/src/a911-screens.js"));
let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e?.message || e).split("\n")[0]}`); } };
const base = { stage: "pick", picked: "01", canSend: false, blockedWhy: "to_required", presets: [{ id: "50", label: "$50", selected: true }], payerName: "오이시", balanceUsd: "99.89",
  fees: { giftGasCost: { known: true, usd: "0.01" }, arasoFee: { usd: "0" } }, faceIdLine: { exact: true, text: "$50 for this Gift · fee $0.01", assetChange: false }, payWith: "usdc" };

await check("order: amount chips → from → hint; hint = \"tap to turn it over to write then send\"", () => {
  const h = a911GiftMarkup(base);
  const i = (s) => h.indexOf(s);
  assert.ok(i('class="a911-chips"') < i('class="a911-pay"') && i('class="a911-pay"') < i('class="a911-hint"'), "order");
  assert.match(h, /<div class="a911-hint">tap to turn it over to write then send<\/div>/);
});
await check("Send row: two lines — the exact line and the gas / Araso fee line — before Send; none of them left in the middle", () => {
  const h = a911GiftMarkup(base);
  const info = (h.match(/<div class="a911-sendInfo"[\s\S]*?<\/div><\/div>/) || [""])[0];
  assert.match(info, /\$50 for this Gift · fee \$0\.01/);
  assert.match(info, /<span>Gift gas cost<\/span> \$0\.01 · <span>Araso fee<\/span> \$0/);
  assert.ok(h.indexOf('class="a911-sendInfo"') < h.indexOf('class="a911-act a911-act--send"'), "info before Send");
  const ctrl = (h.match(/<div class="a911-ctrl"[\s\S]*?\n  <\/div>/) || [""])[0];
  assert.equal(/for this Gift|Gift gas cost/.test(ctrl), false, "fee lines still in the middle");
});
await check("MON path (line with What's this? / USDC buttons): that line stays in the middle; the Send row keeps the gas line only", () => {
  const h = a911GiftMarkup({ ...base, faceIdLine: { exact: true, text: "About 1.2 MON → $10 for this Gift · fee $0.01", assetChange: true }, payWith: "mon" });
  const ctrl = (h.match(/<div class="a911-ctrl"[\s\S]*?\n  <\/div>/) || [""])[0];
  assert.match(ctrl, /About 1\.2 MON/);
  const info = (h.match(/<div class="a911-sendInfo"[\s\S]*?<\/div><\/div>/) || [""])[0];
  assert.equal(/About 1\.2 MON/.test(info), false);
  assert.match(info, /Gift gas cost/);
});
console.log(`A-1354 Gift markup: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
