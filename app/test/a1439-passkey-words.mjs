// [A-1439 · Owner 20:3x "웹 UI의 Face ID 관련 문구를 Passkey 기준으로 일관되게 정리 · 버튼·설명·상태 안내·접근성 문구 포함"]
// A web page cannot tell Touch ID from Face ID (A-1438 ⑤: SE and 17e show the same UA and capabilities), so no on-screen or aria
// word says "Face ID" / "Touch ID". Comments and identifiers (canFaceId, faceLabel, data-*-faceid) are not read by anyone and stay.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const FILES = ["main.js", "money-tab.js", "a911-screens.js", "gift-send-paper.js", "send-allow.js", "send-card.js"];
let pass = 0;
const check = (label, f) => { f(); pass++; console.log(`PASS ${label}`); };

// code lines only: whole-line comments and trailing " // " comments dropped
const shown = (src) => src.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map(([n, l]) => [n, l.split(" // ")[0]]);

check("no \"Face ID\" / \"Touch ID\" word in any string the screen or a screen reader gets", () => {
  const hits = FILES.flatMap((f) => shown(read(f)).filter(([, l]) => /Face ?ID|Touch ?ID/.test(l)).map(([n, l]) => `${f}:${n} ${l.trim().slice(0, 90)}`));
  assert.deepEqual(hits, []);
});

const MAIN = read("main.js");
check("entry button · its explain line · the auth card and the lock say passkey (sentence frames unchanged)", () => {
  assert.match(MAIN, /phase === "checking" \? "checking\.\.\." : "Passkey"/);
  assert.match(MAIN, /\$\{gift \? "Open" : "Passkey"\}/);
  assert.match(MAIN, /Your Piggy keeps your money\.<br>Tap passkey\. It hatches!/);
  assert.equal(MAIN.split("This device can't use a passkey here.").length - 1, 2);
  assert.equal(MAIN.split("Passkey may appear once.").length - 1, 6);
  assert.equal(MAIN.split("Passkey was cancelled.").length - 1, 1);
  assert.equal(MAIN.split('aria-label="Passkey"').length - 1, 3);
  assert.match(MAIN, /&gt; Confirm with passkey<\/button>/);
});
check("Money out confirm · Gift receive · Gift send buttons say passkey", () => {
  assert.match(read("money-tab.js"), /FACE_ID_LINE = "Confirm with passkey"/);
  assert.match(read("a911-screens.js"), /actButton\(\{ label: "Passkey", attrs: 'id="giftOpenButton"/);
  assert.match(read("gift-send-paper.js"), /<span class="invite__faceLabel">Passkey<\/span><\/button>/);
});
console.log(`a1439 passkey words: ${pass} PASS`);
