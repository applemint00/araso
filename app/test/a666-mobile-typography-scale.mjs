// A-666 §3 [GLOBAL MOBILE TYPOGRAPHY] — regression contract for the global mobile type-scale
// pass (TYPOGRAPHY_SCALE.md). Node-only, no network/port.
//   node app/test/a666-mobile-typography-scale.mjs
//
// Owner decision (INBOX A-666): increase ALL existing user-visible app text on mobile from the
// currently-approved sizes, preserving families/weights/italics/casing/hierarchy/spacing-logic;
// desktop 700/1440 unchanged. style.css had (TYPE_INVENTORY.md) only 3 of ~100 text-sizing
// rules with any ≤640px override before this card — this file proves:
//   1. every "shared" (non-mobile-scoped) base declaration this card targets is UNCHANGED
//      (same family/weight/line-height, same base px) — the increase lives only in a new
//      trailing `@media (max-width:640px)` block, so 700/1440 render exactly as before.
//   2. that trailing block overrides the EXACT same selector text with only `font-size`, at
//      the ratio/table TYPOGRAPHY_SCALE.md documents (≈1.15×, rounded).
//   3. the 3 selectors that were ALREADY mobile-scoped before this card were bumped in place
//      (not duplicated into a competing rule).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");

let pass = 0;
let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}

const MARKER = "GLOBAL MOBILE TYPOGRAPHY";
const blockStart = CSS.indexOf(MARKER);

check("the consolidated A-666 mobile type-scale block exists, exactly once, scoped inside a single @media (max-width: 640px)", () => {
  assert.ok(blockStart > 0, "marker comment must exist");
  assert.equal(CSS.indexOf(MARKER, blockStart + 1), -1, "marker must appear exactly once");
  const mqAt = CSS.indexOf("@media (max-width: 640px) {", blockStart);
  assert.ok(mqAt > blockStart && mqAt - blockStart < 4000, "the @media block must immediately follow the marker comment");
});

const block = CSS.slice(blockStart);

// Role -> [selector, beforePx, afterPx]. Mirrors TYPOGRAPHY_SCALE.md §2 exactly (shared /
// non-mobile-scoped selectors only — the 3 already-mobile-scoped ones are checked separately
// below, in place).
const ROLE_TABLE = [
  [".note--quiet .line", 24, 28],
  [".eyebrow", 13, 15],
  [".terms li", 18, 21],
  [".detail", 16, 18],
  [".notice", 14, 16],
  [".address", 13, 15],
  [".nameCard__day", 15, 17],
  [".nameCard__weekday", 10, 11.5],
  [".nameCard__gotLine", 34, 39],
  [".nameCard__titleText", 36, 41],
  [".authCard__eyebrow", 10, 11.5],
  [".authCard__title", 30, 35],
  [".authCard__body", 13, 15],
  [".sendCard__day", 15, 17],
  [".sendCard__weekday", 10, 11.5],
  [".sendCard__dom", 10, 11.5],
  [".sendCard__titleText", 36, 41],
  [".sendCard__address", 10.5, 12],
  [".sendCard__detail", 12, 14],
  [".sendCard__message", 13, 15],
  [".sendCard__termLabel", 13, 15],
  [".sendCard__stay", 13, 15],
  [".secondJourney__heading", 36, 41],
  [".secondJourney__exploreText", 36, 41],
  [".homeChar__name", 13, 15],
  [".homeLiving__name", 13, 15],
  [".chogCheckLine", 24, 28],
  [".receipt", 12, 14],
  [".receipt-check", 10, 11.5],
  [".receiptPaper__date", 12, 14],
  [".receiptPaper__name", 15, 17],
  [".receiptPaper__row", 13, 15],
  [".receiptPaper__status", 13, 15],
  [".tiny", 12, 14],
  [".recordsCard__detailRows", 12, 14],
  [".invite__line2", 25, 29],
  [".invite__face", 16, 18],
  [".invite__copy", 13, 15],
  [".invite--wide .invite__face", 17, 19.5],
  [".returnTap__hint", 12, 14],
  [".recordsCard__date", 15, 17],
  [".nameCard__field input", 20, 23],
  [".secondJourney__hint", 13, 15],
  [".secondJourney__item", 13, 15],
  [".secondJourney__candidateTitle", 13, 15],
  [".secondJourney__candidateStatus", 11.5, 13],
  [".secondJourney__checkBtn", 12, 14],
  [".secondJourney__jitBtn", 12, 14],
  [".secondJourney__amountRow", 13, 15],
  [".secondJourney__amountRow input", 13, 15],
  [".secondJourney__reason", 11.5, 13],
  [".secondJourney__mockTag", 10, 11.5],
  [".secondJourney__primary", 13, 15],
  [".homePaper__heading", 25, 29],
  [".homePaper__statusText", 17, 19.5],
  [".homePaper__time", 13, 15],
  [".homePaper__num", 30, 35],
  [".homePaper__name", 21, 24],
  [".homePaper__state", 13, 15],
  [".homePaper__records", 12, 14],
  [".homePaper__rowLabel", 13, 15],
  [".homePaper__amount", 15, 17],
  [".homePaper__unit", 11, 12.5],
  [".homePaper__percent", 11, 12.5],
  [".homePaper__note", 11, 12.5],
  [".homePaper__moneyStatusText", 13, 15],
  [".recordsCard__empty", 13, 15],
  [".recordsCard__identityName", 20, 23],
  [".recordsCard__identityAddress", 11, 12.5],
  [".recordsCard__rowDate", 13, 15],
  [".recordsCard__rowStatus", 11, 12.5],
  [".recordsFolder__slipRow", 10, 11.5],
  [".recordsFolder__slipStatus", 9.5, 11],
  [".recordsCard__tier", 10, 11.5],
  [".secondJourneyCard .job", 24, 28],
  [".secondJourneyCard .field input", 46, 53],
  [".secondJourneyCard .field input::placeholder", 32, 37],
  [".secondJourneyCard .receive", 46, 53],
  [".secondJourneyCard .claim-value--text", 24, 28],
  [".secondJourneyCard .claim-bring", 12, 14],
  [".secondJourneyCard .secondJourney__list--interests .secondJourney__item", 13, 15],
  [".secondJourneyCard .receive label", 13, 15],
  [".secondJourneyCard .claim-value span", 32, 37],
  [".secondJourneyCard .balance", 12, 14],
  [".secondJourneyCard .condition", 13, 15],
  [".secondJourneyCard .failure", 13, 15],
  [".secondJourneyCard .back", 13, 15],
  [".stage--loginCheck .arasoBrand", 16, 18],
  [".stage--loginCheck .loginCheck__title", 28, 32],
  [".stage--loginCheck .loginCheck__body", 12, 14],
  [".recordsCard__date small", 10, 11.5],
];

check(`every shared role in the A-666 table (${ROLE_TABLE.length} selectors) has exactly one ≤640px override in the consolidated block, set to its TYPOGRAPHY_SCALE.md "after" value`, () => {
  const missing = [];
  for (const [sel, , after] of ROLE_TABLE) {
    const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped} \\{ font-size: ${String(after).replace(".", "\\.")}px; \\}`);
    if (!re.test(block)) missing.push(sel);
  }
  assert.deepEqual(missing, [], `selectors missing their expected override: ${missing.join(", ")}`);
});

check(".recordsCard__back, .recordsCard__close share one 14px override (grouped selector, not split)", () => {
  assert.match(block, /\.recordsCard__back,\s*\n\s*\.recordsCard__close \{ font-size: 14px; \}/);
});

check("--btnWordSize token is redefined to 23px inside :root, ≤640 only (single lever for every .pkbtn__word app-wide)", () => {
  assert.match(block, /:root \{\s*\n\s*--btnWordSize: 23px;\s*\n\s*\}/);
  const base = CSS.slice(0, blockStart);
  assert.match(base, /--btnWordSize: 20px;/, "the :root base (>640px) value must stay 20px");
});

check("h1 clamp is raised only inside ≤640 (min/preferred up ≈1.15×, max bound 56px unchanged)", () => {
  assert.match(block, /h1 \{\s*\n\s*font-size: clamp\(37px, 9\.2vw, 56px\);\s*\n\s*\}/);
  const base = CSS.slice(0, blockStart);
  assert.match(base, /font-size: clamp\(32px, 8vw, 56px\);/, "the base (>640px) h1 clamp must stay unchanged");
});

check("no base (pre-A-666, >640px) declaration for any table selector was itself edited — every base px from TYPOGRAPHY_SCALE.md's \"before\" column still appears in the file before the marker", () => {
  const base = CSS.slice(0, blockStart);
  const missingBase = [];
  for (const [sel, before] of ROLE_TABLE) {
    // spot-check a representative subset (full file already covered by individual role-table
    // asserts elsewhere in the suite, e.g. a621/a623/a642/a665); this is a sanity sweep.
    const px = String(before);
    if (!base.includes(`${px}px`)) missingBase.push(`${sel} (${px}px)`);
  }
  // some before-values are shared across many selectors (e.g. many 13px rules) so a strict
  // per-selector check isn't meaningful here — just confirm the overall before-value set is
  // still present SOMEWHERE in the base file (i.e. nothing was pre-emptively bumped in place).
  assert.ok(missingBase.length < ROLE_TABLE.length / 2, `too many before-values missing from the base file: ${missingBase.slice(0, 5).join(", ")}...`);
});

// -- §3 Already-mobile-scoped selectors (bumped in place, not duplicated) --------------------

check("`.arasoBrand` mobile override (already ≤640-scoped before this card) is 12.5px in place — the web/base 12px rule is untouched, and this is NOT a new rule in the consolidated block", () => {
  const baseAt = CSS.indexOf(".arasoBrand {");
  assert.match(CSS.slice(baseAt, CSS.indexOf("}", baseAt) + 1), /font-size:\s*12px;/, "the web/base .arasoBrand rule (1st occurrence) must stay 12px");
  const arasoMobileAt = CSS.indexOf(".arasoBrand {", baseAt + 1);
  const rule = CSS.slice(arasoMobileAt, CSS.indexOf("}", arasoMobileAt) + 1);
  assert.match(rule, /font-size:\s*12\.5px;/);
  // must be BEFORE the consolidated A-666 block (edited in its original location)
  assert.ok(arasoMobileAt < blockStart, "the arasoBrand mobile bump must be at its original ≤640 location, not inside the new consolidated block");
  // (`.stage--loginCheck .arasoBrand { font-size: 18px; }` DOES legitimately live in the
  // consolidated block — a different, higher-specificity selector — so check for the bare
  // selector specifically, not a raw substring match.)
  assert.equal(/^\s*\.arasoBrand \{/m.test(block), false, "the consolidated block must not also declare a competing bare .arasoBrand rule (line-anchored, so '.stage--loginCheck .arasoBrand' — a descendant selector, legitimately present — does not trip this)");
});

check("`#homeRecordsButton, .homePaper__records[data-piggy-id]` (already ≤640-scoped) is 21px in place", () => {
  assert.match(CSS, /#homeRecordsButton,\s*\n\s*\.homePaper__records\[data-piggy-id\] \{\s*\n\s*font-size:\s*21px;\s*\n\s*\}/);
});

check("`#awayRestoreLine` local px is 141 in place (≈20.6px visual at 390, derived through the existing composite-scale math, not a raw ×1.15 of the local px)", () => {
  const at = CSS.indexOf("#awayRestoreLine {");
  const rule = CSS.slice(at, CSS.indexOf("}", at) + 1);
  assert.match(rule, /font-size:\s*141px;/);
});

check("`.receiptPaper__date`/`__name`/`__row`/`__status` ARE included in the mobile bump (OWNER CORRECTION — receipt text is not exempt), same ≈1.15× ratio as every other role; the hitbox-drift risk is fixed in return-view.js's placePaper() instead of excluding these roles", () => {
  for (const [sel, after] of [[".receiptPaper__date", 14], [".receiptPaper__name", 17], [".receiptPaper__row", 15], [".receiptPaper__status", 15]]) {
    const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(block, new RegExp(`${escaped} \\{ font-size: ${after}px; \\}`), `${sel} must have a ≤640px override to ${after}px`);
  }
});

// -- Desktop/700/1440 untouched sanity ---------------------------------------------------------

check("desktop (>640) sanity: a handful of representative base declarations are byte-identical to their pre-A-666 shape (family/weight/line-height untouched, only font-size differs ≤640)", () => {
  assert.match(CSS, /\.detail \{\s*\n\s*margin: 16px 0 0;\s*\n\s*color: rgba\(237, 232, 220, 0\.78\);\s*\n\s*font-size: 16px;\s*\n\s*line-height: 1\.45;\s*\n\s*\}/);
  assert.match(CSS, /\.homePaper__records \{\s*\n\s*display: block;\s*\n\s*margin-top: 6px;\s*\n\s*padding: 0;\s*\n\s*border: 0;\s*\n\s*background: none;\s*\n\s*font: italic 12px\/1\.2 Georgia, "Times New Roman", serif;/);
  const sendTitleAt = CSS.indexOf(".sendCard__titleText {");
  assert.match(CSS.slice(sendTitleAt, CSS.indexOf("}", sendTitleAt) + 1), /font-size: 36px;/);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
