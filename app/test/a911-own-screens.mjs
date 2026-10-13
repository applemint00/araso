// [A-911] Own screens: Money tab · Gift a Piggy · Move money (Owner 2026-10-08, frames approved "ㅇㅇ 고"). Node-only contracts: builders, CSS block, main.js wiring blocks.
//   node app/test/a911-own-screens.mjs   (browser frames: a911-own-screens-browser.mjs, ARASO_TEST_BROWSER=1)
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { A911_COPY, a911GiftMarkup, a911MoneyMarkup, a911MoveMarkup, a911Share } from "../src/a911-screens.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rd = (p) => readFileSync(path.join(REPO, p), "utf8");
const MAIN = rd("app/src/main.js"), CSS = rd("app/src/style.css"), SCREENS = rd("app/src/a911-screens.js");
const MAIN_BLOCK = (() => { const a = MAIN.indexOf("// ── [A-911] Own screens"); const b = MAIN.indexOf("// ── [A-911] end ──"); return a > 0 && b > a ? MAIN.slice(a, b) : ""; })();
const CSS_BLOCK = (() => { const a = CSS.indexOf("/* ── [A-911] Own screens"); const b = CSS.indexOf("/* ── [A-911] end"); return a > 0 && b > a ? CSS.slice(a, b) : ""; })();
let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); console.log(`PASS  ${name}`); pass += 1; } catch (e) { console.log(`FAIL  ${name}\n      ${String(e && e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)}`); fail += 1; } };

const GIFT = {
  stage: "fan", ci: 1, picked: null, flipped: false, typing: "none",
  fronts: [{ id: "01" }, { id: "02" }, { id: "04" }], amountUsd: 0,
  presets: [20, 50, 100].map((n) => ({ id: String(n), label: `$${n}`, selected: false })),
  fields: { to: "", message: "", from: "" }, payerName: "Honeybun", balanceUsd: "38", short: false, canSend: false,
  fees: { giftGasCost: { usd: "0.02", known: true }, arasoFee: { usd: "0" } },
};
const PIGGIES = [{ id: "a", name: "Honeybun", amount: "$20", away: false }, { id: "b", name: "Mochi", amount: "unknown", away: true }];

check("A1 files: a911-screens.js imports only pure responsive geometry, back-sticker.svg exists, the CSS block + two main.js blocks are present", () => {
  assert.deepEqual(SCREENS.match(/^import .*$/gm), ['import { responsiveFrame } from "./responsive-layout.js";'], "only the shared pure geometry import");
  assert.ok(existsSync(path.join(REPO, "app/public/card/back-sticker.svg")));
  assert.ok(CSS_BLOCK.length > 5000, "CSS block");
  assert.ok(MAIN.includes("// ── [A-911] imports") && MAIN.includes("// ── [A-911] end imports ──") && MAIN_BLOCK.length > 3000, "main.js blocks");
  assert.equal(MAIN.split("// ── [A-911] Own screens").length, 2, "one wiring block");
});

check("A2 CSS: the [A-911] block sits before the final 640 block, which stays last; no animation/transition none, no new reduce block, no literal content strings", () => {
  const tail = "@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}\n";
  assert.ok(CSS.endsWith(tail), "final 640 block last");
  assert.ok(CSS.indexOf("/* ── [A-911] end") < CSS.lastIndexOf(tail));
  assert.ok(!/animation:\s*none|transition:\s*none/.test(CSS_BLOCK));
  assert.ok(!CSS_BLOCK.includes("prefers-reduced-motion: reduce"), "no reduce block in A-911 (a735 A6)");
  assert.equal(/content:\s*["'][^"']+["']/.test(CSS_BLOCK), false);
  assert.equal((CSS.match(/paper_tex_ivory/g) || []).length, 16, "paper texture reference count unchanged (a736); the screen sets it as --a911-tex inline");
  assert.ok(/--a911-tex:url\('\/card\/paper_tex_ivory\.png'\)/.test(SCREENS));
});

check("A3 safe area: the screen is full-bleed fixed inset 0; only content uses env(safe-area-inset-*)", () => {
  assert.match(CSS_BLOCK, /html \.a911-screen \{[\s\S]*?position: fixed;\s*inset: 0;/);
  assert.match(CSS_BLOCK, /env\(safe-area-inset-top/);
  assert.match(CSS_BLOCK, /env\(safe-area-inset-bottom/);
  assert.match(CSS_BLOCK, /background-color: #161616/);
});

check("A4 owner answers in CSS: ONE send/ok button (= .a898-faceBtn grammar: 3.2em high, side 1.6em, label Button 16 x z), zoom 1/1.15/1.35 written by a911Fit (no media step), paper 420 x zoom, ONE place (A-917)", () => {
  // pre-A-917 baseline: Gift 26/51 + money 24/46 sizes, z stepped by media queries at 641 / 1024 (1.15 / 1.35), Move ok/Send beside the paper at >= 1024 (--a911-actL).
  // pre-A-917 baseline (interim design): 46 high / side 18; Cowork 19:20 replaced it with the .a898-faceBtn body (3.2em = 51.2, side 1.6em).
  assert.match(CSS_BLOCK, /--a911-actPx: 51\.2px;\s*--a911-actFont: 16px;/);
  assert.match(CSS_BLOCK, /html \.a911-act \{[\s\S]*?height: 3\.2em;\s*padding: 0 1\.6em;/);
  assert.ok(!/\[data-a911="gift"\] \{ --a911-actPx/.test(CSS_BLOCK), "no per-screen button size (A-917)");
  assert.ok(!/min-width: (641|1024)px\) \{ html \.a911-screen \{ --a911-z/.test(CSS_BLOCK), "no z media-query step (A-829 #1)");
  assert.match(SCREENS, /--a911-z/);
  assert.match(CSS_BLOCK, /max-width: calc\(420px \* var\(--a911-z\)\)/);
  assert.match(CSS_BLOCK, /right: var\(--a911-m\);[\s\S]*?bottom: calc\(var\(--a911-sb\) \+ var\(--a911-bm/);
  assert.ok(!/left: var\(--a911-actL/.test(CSS_BLOCK), "no beside-the-paper rule (A-917)");
});

check("B1 Gift fan: three vertical cards, centre + sides, no card side lines, no Chog/Piggy-screen/jar, Send absent in the fan", () => {
  const h = a911GiftMarkup(GIFT);
  assert.equal((h.match(/class="a911-card /g) || []).length, 3);
  assert.equal((h.match(/is-centre/g) || []).length, 1);
  assert.equal((h.match(/is-side/g) || []).length, 2);
  assert.ok(h.includes('data-a898-act="gift-back"') && h.includes('>Gift a Piggy<'));
  assert.ok(!/a Piggy came for you|a911-side|chogHome|a905Jar|homeChar/.test(h), "no side lines / Chog / jar");
  assert.ok(!h.includes('gift-faceid'), "no Send in the fan");
  assert.ok(h.includes('/card/back-sticker.svg'));
});

check("B2 Gift pick: text picks (no boxed buttons), hint, from line, fee line, Send disabled until canSend, back = repick", () => {
  const view = { ...GIFT, stage: "pick", picked: "02", amountUsd: 50, presets: GIFT.presets.map((p) => ({ ...p, selected: p.id === "50" })) };
  const h = a911GiftMarkup(view);
  assert.ok(h.includes("tap to turn it over") && h.includes("from <") && h.includes("Gift gas cost") && h.includes("Araso fee"));
  assert.ok(/class="a911-chip is-on"[^>]*aria-pressed="true"[^>]*data-a898-act="gift-amount"/.test(h));
  assert.ok(/data-a898-act="gift-faceid" disabled/.test(h), "Send disabled");
  assert.ok(a911GiftMarkup({ ...view, canSend: true }).includes('data-a898-act="gift-faceid"><'), "Send enabled");
  assert.ok(h.includes('data-a898-act="gift-repick"'));
  assert.ok(!a911GiftMarkup({ ...view, typing: "amount" }).includes('data-a911-field'), "no typed-amount input on the card");
  assert.ok(a911GiftMarkup({ ...view, typing: "letter" }).includes('data-typing="1"'));
});

check("B3 Gift link step: link + copy (yellow check when copied) + share; back = gift-back", () => {
  const view = { ...GIFT, stage: "done", picked: "02", link: "https://x.test/g#abc", copied: false };
  const h = a911GiftMarkup(view);
  assert.ok(h.includes('data-a911-act="link-copy"') && h.includes('data-a911-act="link-share"') && h.includes("https://x.test/g#abc"));
  assert.ok(h.includes('data-a898-act="gift-back"'), "done: back closes the Gift");
  assert.ok(a911GiftMarkup({ ...view, copied: true }).includes('data-copied="1"'));
});

check("C1 Money tab: headline never 'unknown'; Move money + Gift a Piggy rows keep their ids; list rows; title is the handwritten Money", () => {
  const h = a911MoneyMarkup({ total: "", assets: "20 USDC", canMove: true, canGift: true, piggies: PIGGIES });
  assert.ok(!/a911-money__total/.test(h), "no empty headline");
  assert.ok(h.includes('id="a905MoveMoney"') && h.includes('id="a905GiftPiggy"') && h.includes("&gt; Move money") && h.includes("&gt; Gift a Piggy"));
  assert.ok(h.includes('data-away="1"') && h.includes("still out working."));
  assert.equal(A911_COPY.money, "Money");
  assert.ok(h.includes('<h1 class="a911-title">Money</h1>'));
  assert.ok(h.includes('data-a905-act="back"') && h.includes('data-a905-view="tab"'));
  assert.ok(a911MoneyMarkup({ total: "$38", assets: "", canMove: true, canGift: true, piggies: PIGGIES }).includes(">$38<"));
});

check("D1 Move in: switch once, rows (card + bank always dim 'Not ready yet', crypto go), split = amounts only (no %), ok id kept", () => {
  const rows = a911MoveMarkup({ dir: "in", step: "rows", rows: [{ id: "card", label: "Pay with card", available: false }, { id: "bank", label: "Bank transfer", available: false }, { id: "crypto", label: "Pay with crypto", available: true }] });
  assert.equal((rows.match(/a911-sw__opt/g) || []).length, 2, "switch once");
  assert.equal((rows.match(/Not ready yet/g) || []).length, 2);
  assert.ok(rows.includes('data-a898-act="funding-row"'));
  const split = a911MoveMarkup({ dir: "in", step: "split", total: "20", split: [{ id: "a", name: "Honeybun", amount: "10" }, { id: "b", name: "Mochi", amount: "10" }], canOk: true });
  assert.ok(split.includes('id="homeAddMoneyTotal"') && split.includes('id="homeAddMoneyAmount--a"') && split.includes('id="homeAddMoneyOk"'));
  assert.ok(!/%|Percent/.test(split), "no % column (owner answer 5)");
  const crypto = a911MoveMarkup({ dir: "in", step: "crypto", assets: [{ id: "USDC", selected: true }, { id: "MON" }], address: "0x1111111111111111111111111111111111111111", copied: false });
  assert.ok(crypto.includes("Monad network") && crypto.includes('data-a898-act="funding-copy"') && crypto.includes('data-a898-act="funding-asset"'));
  const gift = a911MoveMarkup({ dir: "in", step: "rows", noSwitch: true, rows: [] });
  assert.equal((gift.match(/a911-sw__opt/g) || []).length, 0, "no switch when the funding came from a Gift");
});

check("D2 Move out: pick list, amount (chips + ok), address is a textarea (wraps) with Send; ids kept", () => {
  const pick = a911MoveMarkup({ dir: "out", step: "pick", rows: PIGGIES });
  assert.ok(pick.includes('data-a905-act="out-pick"') && pick.includes('data-pick="0"'));
  const amount = a911MoveMarkup({ dir: "out", step: "amount", piggy: { name: "Honeybun" }, balance: "$20", amount: "", choices: [{ id: "20", label: "$20" }], canOk: false });
  assert.ok(amount.includes('id="a924OutAmount"') && amount.includes('data-a905-field="amount"') && amount.includes('inputmode="decimal"') && amount.includes('id="a905OutOk"') && amount.includes('data-a905-act="out-choice"')) // [A-924 RE-PIN · Owner 06:4x ③] typed amount input. pre-A-924 baseline: !amount.includes('<input') && amount.includes('data-a905-amount-view');
  const addr = a911MoveMarkup({ dir: "out", step: "address", piggy: { name: "Honeybun" }, amount: "20", address: "0xabc", canSend: false });
  assert.ok(/<textarea class="a911-addrField"[^>]*data-a905-field="address"/.test(addr), "address is a textarea");
  assert.ok(addr.includes('id="a905OutFaceId"') && /<span class="a911-act__label">Send<\/span>/.test(addr) && /id="a905OutFaceId"[^>]*disabled/.test(addr));
  assert.ok(!addr.includes("Confirm with Face ID"));
});

check("E1 no new copy: every visible word in the builders is an existing/Owner line", () => {
  // [A-924 RE-PIN] + "Needs your OK — nothing has been sent yet." (existing app copy: money-tab.js OUT_CONFIRM_NOTE; mock O3, A-920 item 6). The Gift front captions
  // (mock gift_screen_mock.html :85 / :93 / :101) are ≤ 7 words and pass the existing short-line rule. pre-A-924 baseline: the regex below without the Needs-your-OK line
  const allowed = /^(Needs your OK — nothing has been sent yet\.|Araso|Gift a Piggy|Money|Move money|Send|ok|in|out|TO|FROM|tap to turn it over|for you|back|Not ready yet|Monad network|copy|copied|Gift gas cost|Araso fee|need|more|Add money|Use MON for the remaining|What's this\?|Try again|USDC|MON|from|to|total|still out working\.|Pay with crypto|nothing moved\.|checking…|can't tell yet\.|name|a few words…|unknown|\$?[\d.,]+|[·—>&gt;]+)$/;
  const views = [a911GiftMarkup({ ...GIFT, stage: "pick", picked: "01", short: true, shortfallUsd: "12", monOption: { offered: true, remainingUsd: "12" }, requote: true, canSend: true }),
    a911MoneyMarkup({ total: "$38", assets: "20 USDC", canMove: true, canGift: true, piggies: PIGGIES }),
    a911MoveMarkup({ dir: "in", step: "crypto", assets: [{ id: "USDC" }, { id: "MON" }], address: "0x1" }),
    a911MoveMarkup({ dir: "out", step: "address", piggy: { name: "Honeybun" }, amount: "20", address: "", canSend: true })];
  const bad = [];
  for (const h of views) {
    const chunks = h.replace(/<(textarea|input)[^>]*>/g, ">").replace(/<svg[\s\S]*?<\/svg>/g, ">").split(/<[^>]+>/).map((x) => x.replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim()).filter(Boolean);
    for (const c of chunks) {
      const ok = c.split(/\s+/).every((w) => /^[A-Za-z$0-9.,·—>'’…:!?&-]+$/.test(w)) && (allowed.test(c) || c.split(/\s+/).length <= 7);
      if (!ok) bad.push(c);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(!/SEND_PIGGY/.test(SCREENS + MAIN_BLOCK + CSS_BLOCK), "no SEND_PIGGY");
});

{
  const results = [];
  const run = async (nav, label) => {
    const prev = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
    let copied = 0;
    const r = await a911Share("https://x.test", () => { copied += 1; });
    Object.defineProperty(globalThis, "navigator", { value: prev, configurable: true });
    results.push([label, r, copied]);
  };
  await run({}, "unsupported");
  await run({ share: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } }, "error");
  await run({ share: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); } }, "abort");
  await run({ share: async () => {} }, "ok");
  check("F2 share results: unsupported -> copied(1) · error -> copied(1) · abort -> cancelled(0) · ok -> shared(0)", () => {
    assert.deepEqual(results, [["unsupported", "copied", 1], ["error", "copied", 1], ["abort", "cancelled", 0], ["ok", "shared", 0]]);
  });
}

check("G1 main.js wiring: seams reassigned, hook on refreshHomePaperMount, existing handlers reused, Money tab opens without the Home paper", () => {
  assert.match(MAIN_BLOCK, /a905OpenMoneyTab = function[\s\S]*?state\.a905Money = moneyTabOpen\(state\.scene\);[\s\S]*?a911Sync\(\);/);
  assert.ok(!/chogHomeHit|homePaperMode = "money"/.test(MAIN_BLOCK.slice(MAIN_BLOCK.indexOf("a905OpenMoneyTab = function"), MAIN_BLOCK.indexOf("function a911Root")).replace(/\/\/.*$/gm, "")), "no Home paper opened");
  assert.match(MAIN_BLOCK, /a905Gate = function[\s\S]*?state\.scene === "secondAway"/, "Money tab / jar gate includes secondAway");
  assert.match(MAIN_BLOCK, /refreshHomePaperMount = function refreshHomePaperMountA911\(\) \{\s*a911RefreshOrig\(\);\s*a911Sync\(\);/);
  for (const needle of ["void a898Act(a898El)", "a905HandleClick(event)", "confirmAddMoney()", "handleAddMoneyInput(event)", "a905OutFaceId()", "a905SwitchPayer(", "a911Share(", "visualViewport", "a911Fit(", "a911FitList("]) assert.ok(MAIN_BLOCK.includes(needle), needle);
  assert.ok(!MAIN_BLOCK.includes("a898AutoFlip"), "no auto-flip on the Gift screen");
});

check("G2 safety: the A-911 block has no signing / WebAuthn / network / chain calls and no storage of its own", () => {
  const code = MAIN_BLOCK.replace(/\/\/.*$/gm, "");
  for (const bad of ["credentials.", "requestPrf", "sendPiggy", "createPasskey", "eth_send", "fetch(", "localStorage", "safeLocalStorage", "signTransaction", "sendTransaction", "executor("]) assert.ok(!code.includes(bad), bad);
  assert.ok(code.includes("MONEY_TAB_CONFIG.sendMoney") && /typeof MONEY_TAB_CONFIG\.sendMoney === "function"/.test(code), "Send stays behind the null seam");
});

check("G3 main.js: the A-911 additions are the imports block + one wiring block, written in // comments; the textarea address needs no HTMLInputElement handler", () => {
  for (const line of MAIN_BLOCK.split("\n")) assert.ok(!/^\s*\/\*/.test(line), `no block comments: ${line.slice(0, 50)}`);
  assert.equal((MAIN.match(/instanceof HTMLInputElement/g) || []).length, 1, "only the A-646 allocation handler (inputs); the a905 address field is read by dataset, not by type");
  assert.ok(MAIN.includes('const field = event.target?.dataset?.a905Field;'));
});

check("G4 keyboard + multi list + hidden scrollbar contracts exist in the builders/CSS", () => {
  assert.match(CSS_BLOCK, /\.a911-screen\[data-typing="1"\] \.a911-body \{ bottom: var\(--a911-kb\)/);
  assert.match(CSS_BLOCK, /\.a911-list \{[^}]*scrollbar-width: none/);
  assert.match(CSS_BLOCK, /\.a911-list::-webkit-scrollbar \{ display: none/);
  assert.match(CSS_BLOCK, /\.a911-list\.is-scroll \{ -webkit-mask-image/);
  assert.match(CSS_BLOCK, /\.a911-screen\[data-typing="1"\] \.a911-act \{ opacity: 0; pointer-events: none; \}/);
  assert.match(SCREENS, /export function a911FitList/);
  assert.match(CSS_BLOCK, /input[^{]*\{[^}]*font-size: 16px|a911-addrField \{[^}]*16px/);
});

console.log(`\nA-911: ${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
