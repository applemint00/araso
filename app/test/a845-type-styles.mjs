// [A-845 · A-843] Text styles (Framer-style): six named styles as ON-SCREEN phone px, converted per card from that card's phone scale,
// so in-card text scales with its card at every width; Chog out-of-card text scales with the character stage.
//   Node part (always): tokens, per-card conversion constants vs the main.js layout oracle, role map coverage, no @media in the block,
//   held items untouched (Receipt step, large readiness numerals), chog-home.js tap cue no longer screen-fixed, a681 block still last.
//   Browser part (ARASO_TEST_BROWSER=1; needs local port binding + $ARASO_PRIVATE_BASE/ops/harness playwright):
//     ARASO_TEST_BROWSER=1 node app/test/a845-type-styles.mjs
//   runs helpers/a845-type-measure.mjs (390x844 / 810x1080 / 1440x900 + 1 px sweeps), writes
//   $ARASO_PRIVATE_BASE/ops/receipts/A845_type_styles/browser/a845_measure.json (+ screenshots) and checks the evidence contract.
import { restorePreA920 } from "./helpers/a920-restore.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sceneOracle } from "./helpers/a837-sweep.mjs";
import { testOutDir } from "./helpers/test-out.mjs"; // [A-932]
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
// [A-977 RE-PIN] the later [A-977] Job 10 fork block is cut before the preservation compares (pre-A-977: MAIN as is)
const A977_CUT = (s) => s.replace(/^\/\/ ── \[A-977\] Job 10 on the shared fork[\s\S]*?^\/\/ ── \[A-977\] end Job 10 on the shared fork ──\n/m, "");
// [A-1023 RE-PIN] (Owner 10-11 14:1x: only the approved post-ee4fa91 hunks are cut; no whole-card exclusion) receipts/A1023_pin_attribution/ATTRIBUTION.md.
// The delimited [A-979 ④] badge block is cut by its markers; every other approved hunk (A-979 ④ import · A-995 ①②③ · A-995-b) is restored to its
// exact ee4fa91 text and only when it occurs exactly once — anything else stays in place, so any other main.js change still fails this pin.
const A1023_RESTORES = [["A-1051 dev-only reset button hunk 1 (Owner 10-11 21:3x)", "        <div class=\"cardAnchor__fit\">${cardMarkup}</div>\n      </div>\n    </section>\n  `;", "        <div class=\"cardAnchor__fit\">${cardMarkup}</div>\n      </div>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>\n  `;"],["A-1051 dev-only reset button hunk 2 (Owner 10-11 21:3x)", "      ${/* [A-912] preview tag: DEV preview only (0 in the product build) */ (typeof A912_PRODUCT_BUILD !== \"undefined\" && A912_PRODUCT_BUILD) ? \"\" : `<p class=\"secondJourney__mockTag\">UI preview — no transaction</p>`}\n    </section>", "      ${/* [A-912] preview tag: DEV preview only (0 in the product build) */ (typeof A912_PRODUCT_BUILD !== \"undefined\" && A912_PRODUCT_BUILD) ? \"\" : `<p class=\"secondJourney__mockTag\">UI preview — no transaction</p>`}\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 3 (Owner 10-11 21:3x)", "    devExtra: hasRealReceipt\n      ? \"\"\n      : `${/* [A-912] preview tag: DEV preview only (0 in the product build) */ (typeof A912_PRODUCT_BUILD !== \"undefined\" && A912_PRODUCT_BUILD) ? \"\" : `<p class=\"secondJourney__mockTag\">UI preview — no transaction</p>`}`,\n  });", "    devExtra: hasRealReceipt\n      ? (isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\")\n      : `${/* [A-912] preview tag: DEV preview only (0 in the product build) */ (typeof A912_PRODUCT_BUILD !== \"undefined\" && A912_PRODUCT_BUILD) ? \"\" : `<p class=\"secondJourney__mockTag\">UI preview — no transaction</p>`}${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}`,\n  });"],["A-1051 dev-only reset button hunk 4 (Owner 10-11 21:3x)", "        </div>\n      </div>\n    </section>\n  `;", "        </div>\n      </div>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>\n  `;"],["A-1051 dev-only reset button hunk 5 (Owner 10-11 21:3x)", "      <p class=\"loginCheck__body\">Passkey may appear once.</p>\n    </section>", "      <p class=\"loginCheck__body\">Passkey may appear once.</p>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 6 (Owner 10-11 21:3x)", "      <button class=\"tiny skip\" id=\"skipHatchButton\" type=\"button\">skip</button>\n    </section>", "      <button class=\"tiny skip\" id=\"skipHatchButton\" type=\"button\">skip</button>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 7 (Owner 10-11 21:3x)", "      <div class=\"nameScene__chog\" aria-hidden=\"true\">${chogInviteMarkup()}</div>\n    </section>", "      <div class=\"nameScene__chog\" aria-hidden=\"true\">${chogInviteMarkup()}</div>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 8 (Owner 10-11 21:3x)", "      ${recordsCardMarkup()}\n    </section>", "      ${recordsCardMarkup()}\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 9 (Owner 10-11 21:3x)", "      }\n    </section>", "      }\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 10 (Owner 10-11 21:3x)", "    homeChogMarkup: chogHomeMarkupForReturn(\"return\"),\n    devExtra: \"\",\n  });", "    homeChogMarkup: chogHomeMarkupForReturn(\"return\"),\n    devExtra: isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\",\n  });"],["A-1051 dev-only reset button hunk 11 (Owner 10-11 21:3x)", "      <button class=\"tiny home\" id=\"fileboxHomeButton\" type=\"button\">home</button>\n    </section>", "      <button class=\"tiny home\" id=\"fileboxHomeButton\" type=\"button\">home</button>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1043 second-return mock row (Owner 10-11 20:5x)", "    // [A-1043 · Owner 10-11 20:5x] the mock path drops its \"> mock · <status>\" row (the fork/mock marker already shows at every send); the real-receipt path,\n    // every other row and the paper position are unchanged. pre-A-1043: receiptRowsMarkup: receiptPaperMarkup(hasRealReceipt ? receiptPaperFields(…) : secondJourneyReceiptFields(…)),\n    receiptRowsMarkup: ((rows) => (hasRealReceipt || typeof rows !== \"string\" ? rows : rows.replace(/\\n\\s*<div class=\"receiptPaper__status\">[^<]*<\\/div>/, \"\")))(receiptPaperMarkup(\n      hasRealReceipt\n        ? receiptPaperFields({ receipt: actual, name: displayPiggyName() })\n        : secondJourneyReceiptFields(state.secondJourney.mockReceipt, displayPiggyName()),\n    )),\n", "    receiptRowsMarkup: receiptPaperMarkup(\n      hasRealReceipt\n        ? receiptPaperFields({ receipt: actual, name: displayPiggyName() })\n        : secondJourneyReceiptFields(state.secondJourney.mockReceipt, displayPiggyName()),\n    ),\n"],["A-995 ②③ / A-995-b imports","import { registerA995InlineFace, syncA995GiftEyes } from \"./a995-eye-look.js\";\nimport { mountA995bLoadingPiggy } from \"./a995b-loading-piggy.js\";\n",""],["A-979 ④ import","import { mountForkVirtualMoneyBadge } from \"./fork-virtual-money-badge.js\";\n",""],["A-995 ① breath comment","// [A-995 ①] persistent breath: Owner-selected Sleep strength (x .0091 / y .026) on the existing 4.4 s loop, scaled about the\n","// [A-841 UI-27] persistent subtle breath: the first-arrival values (HOME_T_BREATHE sx 1-.008, sy 1+.014) on a slow loop, scaled about the\n"],["A-995 ① breath coefficients","  el.style.transform = `scale(${(1 - 0.0091 * b).toFixed(5)}, ${(1 + 0.026 * b).toFixed(5)})`;\n","  el.style.transform = `scale(${(1 - 0.008 * b).toFixed(5)}, ${(1 + 0.014 * b).toFixed(5)})`;\n"],["A-995 ② gift eyes (unchanged render)","  if (root && s.html === html) { a911Layout(); void syncA995GiftEyes(root); return; } // nothing changed: leave the DOM (focus, scroll, running transitions) alone\n","  if (root && s.html === html) { a911Layout(); return; } // nothing changed: leave the DOM (focus, scroll, running transitions) alone\n"],["A-995 ② gift eyes (sync)","  void syncA995GiftEyes(a911Root() || document);\n",""],["A-995 ③ tester intro face","  const face = el.querySelector(\".testerIntro__face\");\n  registerA995InlineFace(face);\n",""],["A-995 ③ tester intro blink","    setTimeout(() => el.classList.remove(\"is-closed\"), TESTER_INTRO_BLINK_MS - 120),\n",""],["A-995-b loading bridge","// [A-995-b] Same-turn PWA splash -> loading bridge. The browser cannot paint the first render\n// before this module task ends, so the approved 3.6 s overlay remains the first visible surface.\nmountA995bLoadingPiggy();\n",""]]; // [A-1043 RE-PIN] + the A-1043 hunk (exact, restored only when it occurs once). pre-A-1043: the list without its first entry // [A-1051 RE-PIN] + 11 exact hunks of the dev-only 'reset local test' button removal (listed first: restored before A-1043/A-1023). pre-A-1051: the list without them
const A1023_CUT = (s) => { s = s.replace(/^\/\/ ── \[A-979 ④\] Fork virtual-money badge\.[\s\S]*?^\/\/ ── \[A-979 ④\] end ──\n/m, ""); for (const [, from, to] of A1023_RESTORES) if (s.split(from).length === 2) s = s.replace(from, () => to); return s; };
const CHOG = readFileSync(path.join(REPO, "app/src/chog-home.js"), "utf8");
const CSSNC = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const START = CSSNC.indexOf(":root {\n  --ts-title:");
const BLOCK = START >= 0 ? CSSNC.slice(START, CSSNC.indexOf(":root { --type-support:")) : "";

let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String((e && e.message) || e).split("\n").slice(0, 6).join("\n      ")}`); } }
const rules = () => [...BLOCK.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sels: m[1].split(",").map((s) => s.trim()).filter(Boolean), body: m[2] }));
const fontVarOf = (sel) => { for (const r of rules()) if (r.sels.includes(sel)) { const m = r.body.match(/font-size:\s*var\((--ts[A-Za-z]+)\)/); if (m) return m[1]; } return null; };

// A-843 item 4 role map (+ the writer mapping for the lines item 4 does not name; see the style.css block comment).
export const ROLE_MAP = {
  "--tsTitle": ["html .sendCard__titleText", "html .secondJourneyCard .secondJourney__exploreText", "html .secondJourneyCard .secondJourney__heading", "html .nameCard__titleText", "html .nameCard__gotLine"],
  "--tsChoice": ["html .secondJourneyCard .secondJourney__pick", "html .secondJourneyCard .job", "html .nameCard__field input"],
  "--tsButton": ["html .sendCard .pkbtn__word", "html .nameCard .pkbtn__word", "html .secondJourneyCard .pkbtn__word"],
  "--tsBody": ["html .sendCard__message", "html #sendCard .sendCard__termLabel", "html .secondJourneyCard .secondJourney__list--interests .secondJourney__item", "html #secondSendReason", "html .secondJourneyCard .secondJourney__hint", "html .secondJourneyCard .secondJourney__picked"],
  "--tsLabel": ["html #secondJourneyCard #stayButton", "html .secondJourneyCard .sendCard__stay", "html .secondJourneyCard .back"],
  "--tsDetail": ["html .sendCard__detail", "html .sendCard__day", "html .secondJourneyCard .secondJourney__date", "html .nameCard__day"],
  "--tsWeekday": ["html .sendCard__weekday", "html .secondJourneyCard .secondJourney__date small", "html .nameCard__weekday"],
  "--tsChog": ["html .chogCheckLine", "html #returnArrivalAlarm", "html #awayRestoreLine", "html .chogHome__tapCue"],
};

// ── Part N: node ─────────────────────────────────────────────────────────────────────────────────────
await check("N1 six text styles defined once on :root as phone on-screen px (Title 26 · Choice 18 · Button 16 · Body 14 · Label 13 · Detail 12), weekday = 70 % of Detail", () => {
  assert.ok(START >= 0, "A-845 :root token block missing");
  for (const [k, v] of [["title", 26], ["choice", 18], ["button", 16], ["body", 14], ["label", 13], ["detail", 12]]) {
    assert.match(BLOCK, new RegExp(`--ts-${k}: ${v}px;`), k);
    assert.equal((CSSNC.match(new RegExp(`--ts-${k}:`, "g")) || []).length, 1, `--ts-${k} defined once`);
  }
  assert.match(BLOCK, /--ts-weekday: calc\(var\(--ts-detail\) \* 0\.7\);/);
});
await check("N2 per-card conversion = the card's phone scale at 390x844, derived from the main.js layout (Send .65 k, Second .65 card/285, Name sc, Chog S x HOME_SCALE)", () => {
  const O = sceneOracle(MAIN); const L = O.L(390, 844, 0); const n = O.name(L, 390, 844);
  const phoneCard = Number(BLOCK.match(/--tsPhoneCard: ([\d.]+);/)[1]);
  assert.ok(Math.abs(phoneCard - L.cardW) < 1e-3, `--tsPhoneCard ${phoneCard} vs layout ${L.cardW}`);
  assert.match(BLOCK, /html \.sendCard \{ --tsK: calc\(0\.65 \* var\(--tsPhoneCard\) \/ 282\); \}/);
  assert.match(BLOCK, /html \.sendCard\.secondJourneyCard \{ --tsK: calc\(0\.65 \* var\(--tsPhoneCard\) \/ 285\); \}/);
  assert.match(CSS, /\.stage\[data-scene="sendstay"\] \.cardAnchor \.sendCard \{\n  transform: scale\(calc\(0\.65 \* var\(--cardShrink, 1\) \* var\(--fmtS, 1\)\)\);/);
  assert.match(CSS, /\.stage\[data-scene="explore"\] \.cardAnchor \.sendCard \{\n  transform: scale\(calc\(0\.65 \* var\(--cardShrink, 1\) \* var\(--hlCardK, 1\)\)\);/);
  const [a, b] = BLOCK.match(/html \.nameCard \{ --tsK: calc\((\d+) \/ (\d+)\); \}/).slice(1).map(Number);
  assert.ok(Math.abs(a / b - n.sc) < 1e-9, `Name ${a}/${b} vs nameSceneLayout sc ${n.sc}`);
  const [s1, s2, hs] = BLOCK.match(/--tsChogK: calc\(([\d.]+) \/ ([\d.]+) \* ([\d.]+)\);/).slice(1).map(Number);
  assert.ok(Math.abs(s1 / s2 - L.S) < 1e-9, `stage S ${s1 / s2} vs layout ${L.S}`);
  assert.equal(String(hs), Function(`return ${CHOG.match(/export const HOME_SCALE = ([^;]+);/)[1]}`)().toFixed(10));
  for (const v of ["--tsTitle", "--tsChoice", "--tsButton", "--tsBody", "--tsLabel", "--tsDetail", "--tsWeekday"]) assert.match(BLOCK, new RegExp(`${v}: calc\\(var\\(--ts-[a-z]+\\) / var\\(--tsK\\)\\);`), v);
  assert.match(BLOCK, /--tsChog: calc\(var\(--ts-choice\) \/ var\(--tsChogK\)\);/);
});
await check("N3 every A-843 item 4 role (+ Chog lines) is set from its style, and only from the styles", () => {
  for (const [v, sels] of Object.entries(ROLE_MAP)) for (const s of sels) assert.equal(fontVarOf(s), v, `${s} -> ${v}`);
  // the only literals are the Receipt exception (A-843 item 5: its current phone px, checked in N5)
  for (const r of rules()) for (const m of r.body.matchAll(/font-size:\s*([^;]+);/g)) if (!r.sels.every((s) => /^html \.receiptPaper__/.test(s))) assert.match(m[1].trim(), /^var\(--ts[A-Za-z]+\)$/, `literal size in the A-845 block: ${r.sels.join(", ")} ${m[1]}`);
});
await check("N4 no font-size media steps in the A-845 block; rules are html-prefixed so they beat the earlier <=640 / >=641 / A-779 / A-786 rules by specificity", () => {
  assert.equal(/@media/.test(BLOCK), false);
  for (const r of rules()) for (const s of r.sels) if (!s.startsWith(":root")) assert.match(s, /^html /, s);
});
await check("N5 Receipt = its current phone (<=640) local px at every width, no step (Cowork Q1); large readiness numerals untouched (UNKNOWN role, Cowork Q2 (a))", () => {
  // pre-A-845 baseline (Cowork Q1 pending): no .receiptPaper rule in the A-845 block
  const media = CSSNC.slice(0, START); // the A-666 <=640 block precedes the A-845 block
  for (const [sel, px] of [["date", 14], ["name", 17], ["row", 15], ["status", 15]]) {
    assert.match(BLOCK, new RegExp(`html \\.receiptPaper__${sel} \\{ font-size: ${px}px; \\}`), sel);
    assert.match(media, new RegExp(`\\n  \\.receiptPaper__${sel} \\{ font-size: ${px}px; \\}`), `${sel} = the existing <=640 value`);
  }
  assert.equal(/\.field input|\.receive \{|\.receive,|claim-value/.test(BLOCK.replace(/\.receive label/g, "")), false);
});
await check("N6 Chog tap cue follows the stage: chog-home.js sets no inline font-size; the gap is 4/18 em of the CSS size; TAP_CUE_SCREEN_PX stays the phone value 18", () => {
  const i = CHOG.indexOf("function measureTapCue()"); const body = CHOG.slice(i, CHOG.indexOf("\n  }\n", i));
  assert.equal(/fontSize/.test(body.replace(/\/\/[^\n]*/g, "")), false, "no inline fontSize");
  assert.match(body, /label\.style\.top = `calc\(\$\{INK\.top\}px - \$\{TAP_CUE_GAP_SCREEN_PX \/ TAP_CUE_SCREEN_PX\}em\)`;/);
  assert.match(CHOG, /const TAP_CUE_SCREEN_PX = 18;/);
});
await check("N7 Chog lines keep their bottom anchor (264.8 local = base top 236 + 1.2 x 24) and the box grows to fit (max-width none)", () => {
  const r = rules().find((x) => x.sels.includes("html .chogCheckLine"));
  assert.match(r.body, /top: calc\(264\.8px - 1\.2 \* var\(--tsChog\)\);/); assert.match(r.body, /max-width: none;/);
  assert.ok(r.sels.includes("html #returnArrivalAlarm"));
});
await check("N8 main.js changed by A-845 ONLY inside returnLayout() (Cowork R1 (i)) vs the pre-A-845 copy, and the a681 final block stays last", () => {
  // [A-845 RE-PIN · Cowork R1 (i)] pre-A-845 baseline: main.js sha256 == HASH_BEFORE (3fc0d51d…). Now: identical to the pre-A-845 copy with the returnLayout() body cut out of both.
  const pre = privatePath("ops/receipts/A845_type_styles/pre/app_src_main.js");
  if (existsSync(pre)) {
    const PRE_MAIN = readFileSync(pre, "utf8");
    const cutFn = (src, name) => { const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, name); let d = 0, st = false; for (let j = src.indexOf("{", i); j < src.length; j += 1) { if (src[j] === "{") { d += 1; st = true; } else if (src[j] === "}") { d -= 1; if (st && d === 0) return src.slice(0, i) + src.slice(j + 1); } } throw new Error(`${name} unterminated`); };
    // pre-A-891 baseline: sha256(cut MAIN) == sha256(cut PRE_MAIN) = 4bf2fd7bfd2ddcc0bcd1ae09fe192b1dd4714a2def04888f2697f29d3085bd73 (main.js outside
    // returnLayout() == pre-A-845). [A-891 re-pin, hash pin → new sha256 of the edited file] A-891 changed main.js outside returnLayout() only
    // (mountHome settle / onTap, mountReturn tail, renderFileBox paper, resetLocalTest key, the delimited [A-891] block); returnLayout() itself untouched.
    assert.equal(createHash("sha256").update(cutFn(PRE_MAIN, "returnLayout")).digest("hex"), "4bf2fd7bfd2ddcc0bcd1ae09fe192b1dd4714a2def04888f2697f29d3085bd73", "pre-A-845 copy (cut) unchanged");
    // pre-A-893 baseline: 8a6ef137fe89578b3401658630982ffff7121128f4a2a0bb020fc2653fcd918f (post-A-891 cut). [A-893 re-pin · Cowork pre-answer, hash pin → new sha256]
    // A-893 (Wave 5 Chog cues) changed main.js outside returnLayout() only; returnLayout() itself untouched.
    // [A-891 browser fix] pre-A-891 baseline (this re-pin): 3cf597eb8565b85f70a536c822a5f13a224f878b75289672a9f6db889ad7d14a. a891AfterFiling() now clears
    // state.homeArrival at filed (DEV scene-jump parity: a Return is never a First Home arrival); returnLayout() untouched.
    // pre-A-893 baseline: 0841df8c23cf65cdca5e4584eac70e1c2109c3189bd5b0001c7d67bdf97c3042 (merged A-891 + A-893, before the A-893 review F1 fix: CG-02 cold-open
    // sequencing, Owner via Cowork 2026-10-08 "이어서"). Change outside returnLayout() only (the delimited [A-893] CG-02 block).
    // pre-A-887 baseline: 31f84058d0a5d951da58ef3f06521301bc1fb4af809a0a96ae564b62c9256413 (post-A-891+A-893 F1). [A-887 merge] A-887 adds delimited [A-887] blocks outside returnLayout() (non-design wiring; a887 N2 proves main.js minus those blocks == pre).
    // pre-A-895 baseline: d3c9136927acc33dbcc4dd985ae9759d36e97576f8d67a7a225c758935f135f4 (post-A-891+A-893+A-887). [A-895 P-D re-pin · hash pin → new sha256]
    // P-D edited main.js outside returnLayout() only: inside the delimited [A-887] First-sidecar block (I1 per-read timeout, I2 bound `>=`, I4 comment) plus three comments
    // (the GIFT_CLAIM_SUBMIT_CONFIG example, the flop draw() "never wakes" lines). returnLayout() and every protected body are byte-identical.
    // pre-A-896 baseline: e4defb382c6780280333d53712e67caf47a74166737d149161f461ffea2c7f61 (post-A-895 P-D). [A-896 re-pin · hash pin → sha256 computed from the current main.js]
    // Two changes outside returnLayout(), returnLayout() itself untouched: (1) A-896 (99e M-L-2 60 s signer margin): signerSince declaration + stamp in activateSigningSession +
    // clear in endSignerSession + one entry check in sendPiggyOnce; (2) A-893b (Away region of main.js).
    // pre-A-897 P1 baseline: 6c4550a336adefdecc8a2e16ab9357feff8a27d1a2b1b87b028a58f8ce775639 (post-A-895 P-D + A-896 + A-893b). [merged A-896 R1 + A-893b F3 + A-897 P1] standing permission INBOX :74201.
    // pre-A-897 P2 merge baseline: f92cd4dc40f31c0e98bf25c952cf738a353b326d1783f826fb639c6f46af33c2 (pre-P2 merge). standing permission INBOX :74201.
    // pre-A-897 P1-fix baseline: e43f3241e54202b6dd2112c3e8caec0b55d2881610736031bbce35bfb06c5a9e (post-A-897 P1+P2 merge). [A-897 P1-fix re-pin · standing permission, hash pin → new sha256]
    // P1-fix: the [A-897] P1 block (admit→claim→stamp, mainnet-activity read, persisted verdict) + two one-line guards (computeInitialScene Name-it, displayPiggyName index name); returnLayout() untouched.
    // pre-A-897 P2-fix baseline: 182c5059a108f5fdea76b3061ab7fb574251218e3efee1b112fd88ac5eaf173e (post-A-897 P1-fix). [A-897 P2-fix re-pin · standing permission, hash pin → new sha256]
    // P2-fix: only the [A-897 P2] name-fill info block in main.js (multi-branch first Piggy: unnamed only when index name and PIGGY_NAME_KEY are both empty); returnLayout() untouched.
    // pre-A-898 baseline: f80571b47b0e7aac83142c6355d25bf24b3b8ddc3de433884a74e48400b3e7cc (post-A-897 P2-fix). [A-898 re-pin · standing permission, hash pin → new sha256]
    // pre-A-898 baseline (post-review fixes): 16d6e8fd76073a1435728287a65c3fa569d37de06190bd886591c212c5726f79. A-898: delimited [A-898] import/wiring blocks + three one-line hooks (openAddMoney single branch · homeMoneyBodyMarkup slot · homePadMarkup close) + click delegation; returnLayout() untouched.
    // pre-A-893b-F1 baseline: 2e4042a1de5061fb4a4e69606c6ae403a64a8679d4c103959b0d6370a3c9e3ce (post-A-898). [A-893b F1 re-pin · standing permission INBOX :74201, hash pin → new sha256] F1 = idle-lock unlock counts as the next open: delimited vars + noteAwayLocked() + armAwayOpenLine head + one renderAppLock line (// comments only); returnLayout() and every pinned body untouched.
    // pre-A-803-fix baseline: 4ba2420219292a940b6da0a556a3cb6da24127e9492c228b0a50669486b0f34e (post-A-893b-F1). [A-803 fix · A-831 slots re-pin · standing permission, hash pin → new sha256] only the companion sleepFit block in main.js; returnLayout() untouched.
    // pre-A-902 dbg baseline: aba1ea59c8e2d2d00c0ff751d0211cb52028583e3465645987bb0c6ebcc48efe. [A-902 re-pin, standing permission, hash pin -> new sha256] only the [A-902] block (DEV-only unfold arming trail window.__a902dbg).
    // pre-A-902 skip/pinned baseline: 7d5ded90ecfe4a9a82e01cfd769e386babd4ceda83a538e4dd905e006031811c. [A-902 re-pin, standing permission, hash pin -> new sha256] only the [A-902] block (Skip cancels bell/toss; unfold also fires when the real gesture pins the paper).
    // pre-A-902 unfold-wait baseline: c2ca0b42935e5884e3d69e018fe5778bb46ec65cc7e3336cfba8e02ec0eab79b (post-A-898 fit). [A-902 re-pin, standing permission, hash pin -> new sha256] only the [A-902] unfold wait window (90 -> 300 frames) changed.
    // pre-A-902 baseline: c00b9c593af1338c43356640ee232f754d1c129135aa1c10eb17e781b4224c20 (post-A-905). [A-902 re-pin, standing permission, hash pin -> new sha256] A-902: one delimited [A-902] block (sound import + observers) before homePaperVisiblyOpen; returnLayout() untouched.
    // pre-A-803-debug-hook baseline: 2f0b709d9a04659ed57509ee4b7e69f9a164d134fbb87874721b29b3e8eac553 (post-A-905). [A-803 fix · __arasoSleepPlan debug hook re-pin, standing permission, hash pin -> new sha256]
    // pre-A-905 baseline: ec4530162d1ab7c087187b84d3b9dd54cea2000ab32ebfc550f29db48b86d60d (post-A-803-fix). [A-905 re-pin, standing permission, hash pin -> new sha256] A-905: delimited [A-905] import/wiring blocks + five one-line typeof-guarded hooks (homePaperEffectiveMode, homeMoneyBodyMarkup, homePadMarkup, click delegation, deposit arrival); returnLayout() untouched.
    // pre-A-898-fit baseline: 80ba3b33bd64bb2e73abd273787053284d09aac4da49a4c16c5ea34711ba1ecd (post-A-905). [A-898 fit re-pin, hash pin -> new sha256] A-898/A-905 fit pass: delimited [A-898] scroll helpers + pick/pay-step edits inside the [A-898]/[A-905] blocks + two one-line hooks in refreshHomePaperMount; returnLayout() untouched.
    // pre-A-905 N8 baseline: 859095faf537494721870d3675bdf9fae27ac569910c63b619fb3301b3ba494c (before the A-905 round-3 edits: pay-step patch guard, leg-confirm hook, wrapped bump timers). [A-905 re-pin, hash pin -> new sha256] returnLayout() untouched.
    // pre-A-897-C4 baseline: 05d0116007f7510b8f5a3a4e92e4d21942cb847658d4be490fcc8776ad225527. [A-897 C4 re-pin, hash pin -> new sha256] the Name-it fill save keeps the resident window open (wasResOpen + mountHomeResidentModule({reopen:true}) in the [A-897 P2] save); returnLayout() untouched.
    // pre-A-912 baseline: e404fda552da4489279279a0a88d3362a98869d933cf652f30869b8aebfe08e7 (post-A-897 C4). [A-912 re-pin, hash pin -> new sha256] A-912: one delimited [A-912] comment-only block + the removal of the mobile Invite copy line (invite__copy); returnLayout() untouched.
    // pre-A-912 scope-add baseline: 54720b8d9678d3a004d08b7a23dab37cc0cf33c6a4cba374ee2a88a0dc2f251f (A-912 first pass). [A-912 re-pin, Cowork-approved] + the A912_PRODUCT_BUILD const and the DEV-gated "UI preview" tag in renderSecondAway / renderSecondReturn; returnLayout() untouched.
    // pre-A-911 baseline (no typed-amount input pass: 3fe98650a291dc5cb8be6b2c02022f64ba029ce47ed043259ea0b02a53460e96): a064201866a5613c59e5fb546e86b1a50a3a14ecdac1a697cb68820cb07257a3 (post-A-912, main.js outside returnLayout()). [A-911 re-pin, hash pin -> new sha256] A-911: the delimited [A-911] imports block + the [A-911] own-screens wiring block (one block, reassigns four A-905 seams and wraps refreshHomePaperMount); returnLayout() and every protected body untouched.
    // pre-A-915 baseline: 974d3e89dabc1b27c5369b34e7ff14e01a515294a11478b1f6e494148fa80225 (post-A-911 + A-912, main.js outside returnLayout()). [A-915 re-pin, hash pin -> new sha256]
    // A-915: the delimited [A-915] imports block + the [A-915] Gift create wiring block + three typeof-guarded one-line hooks inside a898FaceId (pre-Face-ID refusal · executor fallback · plan extras);
    // pre-A-904 baseline: the delimited [A-904] jar-guide block is cut before hashing (same sha as before A-904).
    // removing exactly those restores the pre-A-915 sha above (checked when re-pinning); returnLayout() and every protected body untouched.
    assert.equal(createHash("sha256").update(cutFn(restorePreA920(A1023_CUT(A977_CUT(MAIN)) /* [A-1023 RE-PIN] pre-A-1023: A977_CUT(MAIN) */.replace(/^\/\/ ── \[A-960\] invite link → first grant\.[\s\S]*?^\/\/ ── \[A-960\] end invite link → first grant ──\n\n?/m, "").replace(/^\/\/ ── \[A-966\] Gift on the shared fork[\s\S]*?^\/\/ ── \[A-966\] end Gift on the shared fork ──\n/m, "").replace(/^\/\/ ── \[A-974\] Fork app entry[\s\S]*?^\/\/ ── \[A-974\] end fork app entry ──\n/m, "") /* [A-974 re-pin] the one [A-974] fork entry block is cut too; pre-A-974: no third cut */ /* [A-960 re-pin] the one [A-960] invite block is cut first; pre-A-960: MAIN · [A-966 re-pin] the [A-966] fork Gift block too; pre-A-966: no second cut */), "returnLayout") /* [A-920 RE-PIN] A-920 edits four main.js functions + eight const lines (a920-main-js-scope.mjs pins that scope); restorePreA920 puts the pre-A-920 text back first. pre-A-920 baseline: cutFn(MAIN, "returnLayout") */.replace(/\/\/ ── \[A-904\] One-time guide[\s\S]*?\/\/ ── \[\/A-904\][^\n]*\n\n/, "")).digest("hex"), "2f114a1067a56e585bef36f8ee1b268a83b4a57b228b3aa29895ffc299b3bae0", "main.js outside returnLayout() == post-A-895 P-D + A-896 + A-893b + A-905 + A-898 fit + A-915 + A-918");
    // [A-918 RE-PIN · A-923 merge, hash pin -> new sha256] pre-A-918 baseline: 389621a855387a8569f7e5608663136aaa564afc02b994d1359463b6fda3c370. A-918 changes main.js in one place only (the [A-905] away-anchors block: a918SeatBoxFromBoard); returnLayout() untouched.
  }
  // [A-845 regression review R1] the post-A-845 returnLayout() text itself is pinned (function keyword through its closing brace)
  {
    const i = MAIN.indexOf("function returnLayout("); let d = 0, st = false, body = null;
    for (let j = MAIN.indexOf("{", i); j < MAIN.length; j += 1) { if (MAIN[j] === "{") { d += 1; st = true; } else if (MAIN[j] === "}") { d -= 1; if (st && d === 0) { body = MAIN.slice(i, j + 1); break; } } }
    assert.equal(createHash("sha256").update(body).digest("hex"), "d2ce2b9bd2140d8041deb557de0d74c179e6b03f0d88544d304c3f9d8dab6dca", "returnLayout() == the A-845 R1 (i) text + the A-920 Receipt x keyframe"); // [A-920 RE-PIN] returnLayout() gets the RET_RCX_SHIFT term (Cowork 20:55). pre-A-920 baseline: 618680116efb9e8c10988f414c9a248944141331e78e56e8fe2bdbf7b2fa603f
  }
  if (existsSync(pre)) {
    const f = privatePath("ops/receipts/A845_type_styles/pre/HASH_BEFORE.txt");
    if (existsSync(f)) assert.equal(createHash("sha256").update(readFileSync(pre, "utf8")).digest("hex"), readFileSync(f, "utf8").split("\n").find((l) => l.endsWith(" app/src/main.js")).split(/\s+/)[0], "pre copy == HASH_BEFORE");
  }
  assert.ok(CSS.trimEnd().endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}"));
});

// ── Part B: browser ──────────────────────────────────────────────────────────────────────────────────
if (process.env.ARASO_TEST_BROWSER !== "1") console.log("SKIP  browser part (ARASO_TEST_BROWSER=1 to run)");
else if (!existsSync(privatePath("ops/harness/package.json"))) console.log("SKIP  browser part — local harness absent");
else {
  const { measureAll, evaluate } = await import("./helpers/a845-type-measure.mjs");
  const OUT = testOutDir("a845-type-styles", process.env.A845_OUT); // [A-932] pre-A-932 baseline: receipts/A845_type_styles/browser
  let R = null;
  await check("B0 measurement ran (390x844 / 810x1080 / 1440x900 + sweeps), JSON written", async () => { R = await measureAll(OUT); assert.ok(R && !R.error, R && R.error); });
  if (R && !R.error) {
    const E = evaluate(R);
    writeFileSync(path.join(OUT, "a845_evaluate.json"), JSON.stringify(E, null, 1));
    console.log(`      per-role table (min on-screen px): ${JSON.stringify(E.table)}`);
    await check("B1 per-role on-screen px at 390x844 = style target +-0.5 (Send, Second interests + candidates, Name arrival + name, Chog lines)", () => assert.deepEqual(E.phoneMisses, []));
    await check("B2 per-role on-screen px at 810x1080 / 1440x900 = target x card width / phone card width +-0.5 (Chog: x stage width ratio)", () => assert.deepEqual(E.scaleMisses, []));
    // [A-845 round 2] scrollWidth alone also counts the transparent ::after tap areas (A-735: sw - cw = their right inset 14 / 5 / 8 px), so
    // overflow = the text wider than its box, and overlap = glyph INK overlap; tap-area reach and content-area (line-box) overlaps are logged.
    // pre-round-2 criterion: E.overflow on raw scrollWidth > clientWidth + 1; E.overlaps on content-area rect intersection > 0.5 x 0.5 px.
    // [A-845 round 4 · coordinator verdict] an ink overlap that the SAME walk measured on the pre-A-845 style.css (browser_pre/a845_evaluate.json,
    // A845_CSS_FROM mode) at the same scene / viewport / text pair is pre-existing (candidates "places to explore?" x picked-interest line =
    // A-849 residue, Owner-visual), as long as it is not deeper than pre + 0.5 px. Anything else still fails. Without the pre file nothing is excluded.
    const PRE = privatePath("ops/receipts/A845_type_styles/browser_pre/a845_evaluate.json");
    const pairOf = (s) => { const m = s.match(/^(\S+ \S+ ".*?" x ".*?") INK overlap ([\d.]+) px/); return m ? { id: m[1], depth: Number(m[2]) } : null; };
    const preOv = existsSync(PRE) ? JSON.parse(readFileSync(PRE, "utf8")).overlaps.map(pairOf).filter(Boolean) : [];
    const preExisting = [], newOverlaps = [];
    for (const s of E.overlaps) { const a = pairOf(s); const p = a && preOv.find((x) => x.id === a.id); if (p && a.depth <= p.depth + 0.5) preExisting.push(`${s} [pre ${p.depth}]`); else newOverlaps.push(s); }
    // [A-845 round 5 · coordinator verdict] same rule for text overflow: the nowrap handwriting titles' text runs 1.1-1.9 px past the integer
    // clientWidth in the pre-A-845 walk too ("send?" pre 82.27 > 81, after 80.17 > 79). Pre-existing = same scene / selector / text in browser_pre
    // overflow at ANY viewport (matched regardless of viewport on purpose: the local excess follows the font, and the A-845 Title sits between the
    // pre phone 39 / web 34 css sizes), with excess (text - cw, local px) <= the largest pre excess for that string over all viewports + 0.5 px.
    // (Ink overlaps above, by contrast, are matched per viewport.)
    const ovOf = (s) => { const m = s.match(/^(\S+) \S+ (.*?) "(.*?)" text ([\d.]+) \/ sw \d+ .*?> cw (\d+)/); return m ? { id: `${m[1]} ${m[2]} "${m[3]}"`, excess: Number(m[4]) - Number(m[5]) } : null; };
    const preOf = existsSync(PRE) ? JSON.parse(readFileSync(PRE, "utf8")).overflow.map(ovOf).filter(Boolean) : [];
    const preOverflow = [], newOverflow = [];
    for (const s of E.overflow) { const a = ovOf(s); const pm = a ? Math.max(-Infinity, ...preOf.filter((x) => x.id === a.id).map((x) => x.excess)) : -Infinity; if (a && a.excess <= pm + 0.5) preOverflow.push(`${s} [pre max excess ${pm.toFixed(2)}]`); else newOverflow.push(s); }
    // pre-round-4: assert.deepEqual(E.overlaps, []);  pre-round-5: assert.deepEqual(E.overflow, []);
    await check("B3 no text overflow (text width <= box; scrollWidth minus the transparent ::after tap area <= clientWidth), no clipping outside the card, no glyph-ink overlap — beyond the measured pre-A-845 ones", () => { assert.deepEqual(newOverflow, []); assert.deepEqual(E.clipped, []); assert.deepEqual(newOverlaps, []); });
    console.log(`      pre-existing text overflow (browser_pre evidence): ${preOverflow.length}`);
    for (const x of preOverflow) console.log(`        ${x}`);
    console.log(`      pre-existing ink overlaps (browser_pre evidence): ${preExisting.length}`);
    for (const x of preExisting) console.log(`        ${x}`);
    console.log(`      tap-area reach (not overflow): ${E.hitAreaReach.length} · line-box overlaps with ink apart: ${E.lineBoxOverlaps.length}`);
    for (const x of E.lineBoxOverlaps) console.log(`        ${x}`);
    await check("B4 1 px sweeps (640/641 and the 390 / 810 / 1100 / 1440 boundaries): no text-size step (px / card width changes <= 1 % between adjacent widths)", () => assert.deepEqual(E.steps, []));
    await check("B5 weekday = 70 % of Detail on the same card (+-0.3 px)", () => assert.deepEqual(E.weekdayMisses, []));
    await check("B6 Chog lines scale with the Chog / Piggy stage (px / Chog hit width constant +-1 %)", () => assert.deepEqual(E.chogMisses, []));
    await check("B7 Receipt = its current phone on-screen sizes x paper scale (+-0.5), no 640 step (sweep included in B4)", () => assert.deepEqual(E.receiptMisses, []));
    console.log(`      Receipt (Return / Second Return / filebox): ${JSON.stringify(E.receipt)}`);
    // [A-845 R2] placeholder fields ("—" / "Unknown") in the Second Return / filebox receipts are recorded, not asserted (they come from the app's data, not from type)
    console.log(`      receipt placeholder fields: ${E.placeholders.length ? E.placeholders.join(" | ") : "none"}`);
  }
}
console.log(`\nA-845: ${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
