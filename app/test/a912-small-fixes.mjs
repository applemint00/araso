// [A-912] Small fixes (Owner 2026-10-08 "자잘한 것"): Chog one line · readiness underline + "—" · filebox Receipt/Home/ARASO · Invite line · Receipt label.
//   node app/test/a912-small-fixes.mjs   (source + fake-DOM contracts; no browser. Frames: _private/ops/receipts/A912_small_fixes/frames/a912-frames.mjs)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { settleChogOneLine } from "../src/chog-home.js";
import { secondJourneyCardMarkup } from "../src/second-journey-view.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rd = (p) => readFileSync(path.join(REPO, p), "utf8");
const MAIN = rd("app/src/main.js"), CSS = rd("app/src/style.css"), CHOG = rd("app/src/chog-home.js");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const BLOCK = (() => { const a = CSS.indexOf("/* ── [A-912 · SMALL FIXES]"); const b = CSS.indexOf("/* ── [/A-912]"); return a >= 0 && b > a ? CSS.slice(a, b) : ""; })();
let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); console.log(`PASS  ${name}`); pass += 1; } catch (e) { console.log(`FAIL  ${name}\n      ${String(e && e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)}`); fail += 1; } };

// minimal fake root: speech elements with dataset / hidden / contains-selectors the function uses
const el = (cls, hidden = false) => ({ cls, hidden, dataset: {}, closest: () => null, parentElement: null });
const fakeRoot = (list) => ({ querySelectorAll: () => list.filter((e) => !e.hidden) });

check("1 Chog: with two visible speech lines only the newest stays; the older leaves", () => {
  const a = el("chogCheckLine"), b = el("chogCheckLine");
  const root = fakeRoot([a, b]);
  settleChogOneLine(root);
  assert.equal(a.dataset.chogLeft, "1"); assert.equal(b.dataset.chogLeft, undefined);
});
check("1 Chog: a later line (incl. 'tap me!') displaces the earlier one; a left line never returns", () => {
  const a = el("chogCheckLine"), cue = el("chogHome__tapCue");
  const list = [a]; const root = { querySelectorAll: () => list.filter((e) => !e.hidden && e.dataset.chogLeft !== "x") };
  settleChogOneLine(root);
  list.push(cue); settleChogOneLine(root);
  assert.equal(a.dataset.chogLeft, "1"); assert.equal(cue.dataset.chogLeft, undefined);
  a.hidden = false; settleChogOneLine(root);
  assert.equal(a.dataset.chogLeft, "1", "once left, always left");
  const c = el("chogCheckLine"); list.push(c); settleChogOneLine(root);
  assert.equal(cue.dataset.chogLeft, "1"); assert.equal(c.dataset.chogLeft, undefined);
});
check("1 Chog: a hidden (not yet revealed) line does not displace the visible one; revealing it does", () => {
  const a = el("chogCheckLine"), alarm = el("chogCheckLine", true);
  const root = fakeRoot([a, alarm]);
  settleChogOneLine(root); assert.equal(a.dataset.chogLeft, undefined);
  alarm.hidden = false; settleChogOneLine(root);
  assert.equal(a.dataset.chogLeft, "1"); assert.equal(alarm.dataset.chogLeft, undefined);
});
check("1 Chog: observer wired in mountChogHome, CSS hides data-chog-left, no animation/transition none text added", () => {
  assert.match(CHOG, /new MutationObserver\(\(\) => settleChogOneLine\(root\)\)/);
  assert.match(BLOCK, /\.chogHome \[data-chog-left\] \{ display: none !important; \}/);
  assert.equal(/animation:\s*none|transition:\s*none/.test(BLOCK), false);
  assert.equal(/prefers-reduced-motion/.test(BLOCK), false);
});
check("2 Readiness: amount = underline only (no yellow box); '(shows here)' gone, unknown = '—'", () => {
  assert.match(BLOCK, /html \.secondJourneyCard \.field input:focus-visible \{ outline: 0; border: 0; box-shadow: none; background: transparent; \}/);
  assert.equal(/shows here/.test(rd("app/src/second-journey-view.js")), false);
  const html = secondJourneyCardMarkup({ step: "readiness", chosen: { id: "x", title: "t" }, devPreview: true, step2: true });
  assert.equal(/shows here/.test(html), false);
  assert.match(html, /USDC —/);
  assert.match(BLOCK, /overflow-wrap: anywhere;/);
  assert.match(BLOCK, /max-width: calc\(100% - 10px\);/);
});
check("3 Filebox: Receipt larger + centred, 'Home' Label 13 underline right under it, ARASO top-left; tap -> Home unchanged", () => {
  assert.match(BLOCK, /--a912-recS: 1\.32;/);
  assert.match(BLOCK, /\.filebox__paper \{ transform: scale\(var\(--a912-recS\)\); \}/);
  assert.match(BLOCK, /\.stage\[data-scene="filebox"\]::before \{[^}]*left: var\(--hlM, 20px\);[^}]*top: calc\(var\(--hlAsTop, 32px\) \+ var\(--hk-safe-top, 0px\)\);/);
  assert.match(BLOCK, /\.tiny\.home \{[^}]*left: 50%;[^}]*font-size: var\(--ts-label\);[^}]*text-decoration: underline;/);
  assert.match(BLOCK, /top: calc\(50% \+ var\(--a912-recH\) \* var\(--a912-recS\) \/ 2 \+ 22px\);/);
  assert.match(CSS, /--ts-label: 13px;/);
  assert.match(MAIN, /function a891FileboxPaperClose\(e\) \{[\s\S]*?goHomeFromFilebox\(\);\s*\}/);
  assert.match(MAIN, /id="fileboxHomeButton" type="button">home<\/button>/, "markup untouched; 'Home' casing is CSS capitalize");
});
check("4 Invite: 'it's safe. only you can open it.' removed from the product markup; binder holes stay", () => {
  assert.equal(strip(MAIN).includes("it's safe. only you can open it."), false);
  assert.match(MAIN, /\$\{inviteHoles\(13\)\}/);
  assert.match(CSS, /\.invite__holes \{/);
});
check("5 'Receipt' label under the Return Receipt = A-843 Label; main.js only gets comments (+ the Invite line removal)", () => {
  assert.match(BLOCK, /html \.returnTap__hint \{ font-size: var\(--ts-label\); \}/);
  assert.match(rd("app/src/return-view.js"), /st\.phase === "await-first-tap" \? "Receipt"/);
});
check("hygiene: [A-912] CSS block sits before the final 640 block, which stays last; main.js A-912 block is // comments only", () => {
  assert.ok(CSS.endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}\n"));
  assert.ok(CSS.indexOf("[/A-912]") < CSS.lastIndexOf("@media (max-width: 640px) {\n  .homeLiving__name"));
  const a = MAIN.indexOf("// ── [A-912] small fixes"), b = MAIN.indexOf("// ── [/A-912]");
  assert.ok(a > 0 && b > a);
  for (const line of MAIN.slice(a, b).split("\n")) assert.ok(line.trim() === "" || line.trim().startsWith("//"), `comment-only: ${line.slice(0, 60)}`);
  assert.equal(/content:\s*["'][^"']+["']/.test(CSS.slice(CSS.indexOf(":root { --homePaperK"))), false, "no literal content: strings (a786 A2)");
});
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
