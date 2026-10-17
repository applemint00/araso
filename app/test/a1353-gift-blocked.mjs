// [A-1353 ③ · Owner 10-17 13:4x "기프트가 안 돼서 봤더니 뒤에 글을 써야 했어 알려줘야 해"] The Gift Send knows WHY it is dimmed:
// the reason rides on the Send button (data-blocked) — "to_required" when the card's back has no TO yet, or the evaluation's own
// blockedReason (front_required · short · fee_unknown …). The words that tell the person are the Owner's (asked in OUTBOX); until then
// no new words are on the screen (the button label stays "Send").
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e?.message || e).split("\n")[0]}`); } };
const screens = await import(path.join(REPO, "app/src/a911-screens.js"));
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const sendBtn = (html) => (html.match(/<button class="a911-act a911-act--send"[^>]*>/) || [""])[0];

await check("(a) the dimmed Gift Send carries its reason: no TO on the back → data-blocked=\"to_required\" · label stays Send", () => {
  const html = screens.a911GiftMarkup({ stage: "pick", picked: "01", canSend: false, blockedWhy: "to_required", presets: [], fees: {} });
  const b = sendBtn(html);
  assert.match(b, / disabled/, `button ${b}`);
  assert.match(b, /data-blocked="to_required"/, `button ${b}`);
  assert.match(html, /a911-act__label">Send</);
});
await check("(b) a ready Send has no reason on it", () => {
  const b = sendBtn(screens.a911GiftMarkup({ stage: "pick", picked: "01", canSend: true, blockedWhy: null, presets: [], fees: {} }));
  assert.equal(/data-blocked/.test(b), false, b);
});
await check("(c) main.js a911GiftView: blockedWhy = to_required when TO is empty, else the evaluation's blockedReason", () => {
  const body = MAIN.slice(MAIN.indexOf("function a911GiftView("), MAIN.indexOf("function a911GiftView(") + 4000);
  assert.match(body, /blockedWhy:/, "a911GiftView gives no blockedWhy");
  assert.match(body, /"to_required"/);
  assert.match(body, /gv\.blockedReason/);
});
console.log(`A-1353 ③ gift blocked: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
