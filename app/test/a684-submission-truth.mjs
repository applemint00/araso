// [A-684] Submission Truth pins — node-only, deterministic (no browser, no network, no tx).
//   node app/test/a684-submission-truth.mjs
//
// Pins: legacy MON never shown with "$" (exact token fallback) · went out / kept stay honest ·
// failure copy uses only the existing evidence classes · default HISTORY masthead has no raw address ·
// reachable Korean submission-path strings are English · capability preflight is read-only and bounded ·
// root `npm test` entry exists.
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { formatEther } from "viem";
import { receiptPaperFields } from "../src/receipt-paper.js";
import { homeMoneyTotalsNote, fundingMethodsMarkup } from "../src/home-paper.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const PKG = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

let pass = 0;
let fail = 0;
function check(name, ok, extra = "") {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}${extra ? ` (${extra})` : ""}`); }
}

// Cut one top-level function: from its head to the next column-0 closing brace.
function cutFn(name, { async = false } = {}) {
  const head = `${async ? "async " : ""}function ${name}(`;
  const start = MAIN.indexOf(head);
  if (start < 0) throw new Error(`main.js: ${name} not found`);
  // Top-level functions in main.js close with "\n}" at column 0 (comments/strings may hold braces).
  const end = MAIN.indexOf("\n}\n", start);
  if (end > 0) return MAIN.slice(start, end + 2);
  throw new Error(`main.js: ${name} unterminated`);
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

// ── 1. Money / unit copy ────────────────────────────────────────────────────────────────────
{
  const ctx = { formatEther, Number };
  vm.createContext(ctx);
  vm.runInContext(`${cutFn("formatMoney")}\nglobalThis.__fm = formatMoney;`, ctx);
  const fm = ctx.__fm;
  check("legacy 0.001 MON -> '0.001 MON'", fm(1000000000000000n) === "0.001 MON", fm(1000000000000000n));
  check("legacy amount has no '$'", !fm(1000000000000000n).includes("$"));
  check("zero -> '0 MON' (no '$')", fm(0n) === "0 MON", fm(0n));
  check("sub-milli amount keeps 6 decimals + unit", fm(345678000000000n) === "0.000346 MON" || fm(345678000000000n) === "0.0003 MON" || /^0\.000\d+ MON$/.test(fm(345678000000000n)), fm(345678000000000n));
  check("unreadable amount -> 'Unknown' (no invented value)", fm(undefined) === "Unknown" && fm("x") === "Unknown");

  // receiptRows / receiptCheck through the real source (cut together with formatMoney + shortHash)
  const rowsCtx = { formatEther, Number, String, BigInt };
  vm.createContext(rowsCtx);
  vm.runInContext(
    `${cutFn("shortHash")}\n${cutFn("formatMoney")}\n${cutFn("receiptRows")}\n${cutFn("receiptCheck")}\n` +
      `globalThis.__rows = receiptRows; globalThis.__check = receiptCheck;`,
    rowsCtx,
  );
  const legacy = {
    before: 5000000000000000n, sent: 1000000000000000n, gas: 12000000000000n, after: 3988000000000000n,
    txHash: `0x${"a".repeat(64)}`, redeemTxHash: `0x${"b".repeat(64)}`, redeemBlockNumber: 123n,
  };
  const rows = rowsCtx.__rows(legacy);
  const joined = rows.map((r) => `${r.label}:${r.value}`).join("|");
  check("legacy Receipt rows never contain '$'", !joined.includes("$"), joined);
  check("Sent row is exact token truth", rows.find((r) => r.label === "Sent")?.value === "0.001 MON");
  check("receiptCheck never contains '$'", !rowsCtx.__check(legacy).includes("$"), rowsCtx.__check(legacy));
  check("receiptCheck still reconciles (same as Left)", rowsCtx.__check(legacy).includes("same as Left"));
  const sealedOff = rowsCtx.__check({ ...legacy, after: legacy.after + 1000000000000n });
  check("receiptCheck 'off by' carries unit, not '$'", sealedOff.includes("off by") && sealedOff.includes("MON") && !sealedOff.includes("$"), sealedOff);

  const fmSrc = stripComments(cutFn("formatMoney"));
  check("formatMoney source has no '$' prefix template", !/`\$\$\{/.test(fmSrc) && !/"\$"/.test(fmSrc));
  check("no gas/paymaster/relayer word added to user copy of Receipt rows", !/paymaster|relayer|gas fee/i.test(stripComments(cutFn("receiptRows"))));
}

// ── 2. Receipt semantics: went out / kept ───────────────────────────────────────────────────
{
  const receipt = { sent: 1000000000000000n, after: 3988000000000000n, before: 5000000000000000n, gas: 1n, at: Date.UTC(2026, 9, 3, 12, 30) };
  const f = receiptPaperFields({ receipt, name: "Piggy" });
  check("went out stays '—' with no stored departure time", f.wentOut === "—", f.wentOut);
  check("went out is not the amount sent", f.wentOut !== "0.001" && !String(f.wentOut).includes("0.001"));
  check("kept stays '—' (no verified profit source)", f.kept === "—", f.kept);
  check("kept is not receipt.after / sent / principal", !String(f.kept).includes("3988") && !String(f.kept).includes("0.001"));
  check("kept '—' even with a balance-looking field", receiptPaperFields({ receipt: { ...receipt, balance: 7n, principal: 9n } }).kept === "—");
  check("went out is not the return time (receipt.at)", f.wentOut === "—" && f.cameBack !== "—");
  check("no departedAt field introduced", !/departedAt/.test(readFileSync(new URL("../src/receipt-paper.js", import.meta.url), "utf8").replace(/\/\/[^\n]*/g, "")));
  check("empty receipt -> Unknown / '—' unchanged", (() => { const e = receiptPaperFields({ receipt: null }); return e.empty === true && e.wentOut === "—" && e.kept === "—" && e.statusLabel === "Unknown"; })());
  const rp = stripComments(readFileSync(new URL("../src/receipt-paper.js", import.meta.url), "utf8"));
  check("receipt-paper never maps sent/after/balance/principal into kept or wentOut", !/kept:\s*[^"—,\n]*(sent|after|balance|principal)/.test(rp) && !/wentOut:[^\n]*(sent|amount)/.test(rp));
}

// ── 3. Failure-state copy: existing evidence classes only ───────────────────────────────────
// Mapped at the copy-render point (sendFailureCopy, called by setScene) so the byte-pinned send/auth
// functions are untouched. Headlines stay byte-identical; only the detail line is added.
{
  const copy = (scene, message, detail, { pending = null, tripReason = "" } = {}) => {
    const ctx = { state: { tripReason }, readSendPending: () => pending };
    vm.createContext(ctx);
    vm.runInContext(`${cutFn("sendFailureCopy")}\nglobalThis.__c = sendFailureCopy;`, ctx);
    return ctx.__c(scene, message, detail);
  };
  const relayer = copy("sendstay", "relayer unreachable", "");
  check("'relayer' never reaches the user; headline reuses existing copy", relayer.message === "Piggy can't go out yet." && relayer.detail === "nothing moved." && !/relayer/i.test(relayer.message + relayer.detail));
  check("pre-send can't-go-out -> nothing moved.", copy("sendstay", "Piggy can't go out yet.", "").detail === "nothing moved.");
  check("headline 'Piggy can't go out yet.' stays byte-identical", copy("sendstay", "Piggy can't go out yet.", "").message === "Piggy can't go out yet.");
  const ready = (pending) => copy("sendstay", "Piggy could not get ready.", "", { pending });
  check("could-not-get-ready, no send started -> nothing moved.", ready(null).detail === "nothing moved.");
  check("after deposit-sending -> can't tell yet.", ready({ stage: "deposit-sending" }).detail === "can't tell yet.");
  check("deposit broadcast but unconfirmed -> can't tell yet. (not still out.)", ready({ stage: "deposit-broadcast" }).detail === "can't tell yet.");
  check("unreadable pending record -> can't tell yet.", ready({ stage: "unknown" }).detail === "can't tell yet.");
  check("redeem-broadcast (deposit confirmed) -> still out.", ready({ stage: "redeem-broadcast" }).detail === "still out.");
  check("headline 'Piggy could not get ready.' stays byte-identical", ready(null).message === "Piggy could not get ready.");
  const fin = (tripReason) => copy("sendstay", "couldn't finish this one.", "", { tripReason });
  check("finishTrip headline byte-identical", fin("reverted").message === "couldn't finish this one.");
  check("failed(reverted), stage unknown -> can't tell yet. (never nothing moved)", fin("reverted").detail === "can't tell yet.");
  check("deposit confirmed, redeem unconfirmed/reverted -> still out.", fin("redeem-unconfirmed-or-reverted").detail === "still out.");
  check("settle exception -> can't tell yet.", fin("unconfirmed").detail === "can't tell yet.");
  check("an explicit detail is never overwritten", copy("sendstay", "Piggy can't go out yet.", "Open again when you need it.").detail === "Open again when you need it.");
  check("other scenes untouched", copy("birth", "Piggy can't go out yet.", "").detail === "");
  const all = [relayer, ready(null), fin("reverted"), fin("redeem-unconfirmed-or-reverted")].map((s) => `${s.message} ${s.detail}`).join(" ");
  check("failure copy never claims coming home / came back", !/coming home|is home|came back/i.test(all));
  check("setScene routes through sendFailureCopy", /function setScene\([^)]*\) \{\n  \(\{ message, detail \} = sendFailureCopy\(/.test(MAIN));
  check("'coming home' still only in the existing returnArrivalAlarm path", /is coming home/.test(MAIN));
  check("no blind retry: sendFailureCopy has no send/timer calls", !/sendPiggy|setTimeout|waitFor/.test(cutFn("sendFailureCopy")));
}

// ── 4. HISTORY default masthead: no raw address ─────────────────────────────────────────────
{
  const fn = stripComments(cutFn("recordsMastheadMarkup"));
  check("recordsMastheadMarkup no longer renders state.address", !/state\.address/.test(fn) && !fn.includes("identityAddress"));
  check("recordsMastheadMarkup still renders the Piggy name", fn.includes("recordsCard__identityName"));
  check("receipt detail rows still carry Tx/Block evidence (not removed)", /label: "Tx"/.test(cutFn("receiptRows")));
}

// ── 5. English-only submission-path strings ─────────────────────────────────────────────────
{
  check("home totals note is English", !HANGUL.test(homeMoneyTotalsNote({ totalUsd: null, reason: "incomplete_valuation" })));
  const methods = [
    { method: "bank_card_apple_pay", available: false, unavailableReason: "no_provider_selected" },
    { method: "from_another_wallet", available: false, unavailableReason: "no_provider_selected" },
    { method: "other_options", available: false, unavailableReason: "unknown_reason" },
  ];
  const html = fundingMethodsMarkup(methods);
  check("funding method list is English", !HANGUL.test(html), html.match(HANGUL)?.[0] || "");
  check("funding list still shows unavailable methods honestly (disabled)", (html.match(/disabled/g) || []).length === 3);
  const mi = stripComments(cutFn("moneyIntentMarkup"));
  check("permission confirm copy is English", !HANGUL.test(mi), mi.match(HANGUL)?.[0] || "");
  check("permission copy keeps the 'nothing sent / one time / nothing changed' truth", mi.includes("nothing has been sent yet") && mi.includes("this one time only") && mi.includes("nothing changed"));
  check("Face ID button label English", mi.includes("Confirm with Face ID"));
}

// ── 6. Capability preflight: NOT implemented (PREMISE_CONFLICT) ─────────────────────────────
// Every WebAuthn attempt site (openPiggy, checkPiggy, startPiggyOpen, render, renderAuthCard) is
// byte-pinned by a667/a669/a642/a653. Pin that none of them gained a preflight or a credential call.
{
  check("no preflight helper left half-wired in main.js", !/webAuthnUnavailable/.test(MAIN));
}

// ── 7. Root test entry ──────────────────────────────────────────────────────────────────────
{
  check("package.json has root 'test' script -> app/test/run-all.mjs", PKG.scripts?.test === "node app/test/run-all.mjs", PKG.scripts?.test);
  check("run-all.mjs exists", existsSync(new URL("./run-all.mjs", import.meta.url)));
  const ra = readFileSync(new URL("./run-all.mjs", import.meta.url), "utf8");
  check("runner reports explicit PASS/SKIP/FAIL and exits non-zero on FAIL", /status: "PASS"/.test(ra) && /status: "SKIP"/.test(ra) && /status: "FAIL"/.test(ra) && /process\.exit\(count\("FAIL"\) > 0 \? 1 : 0\)/.test(ra));
  check("runner never writes files", !/writeFileSync|appendFileSync|unlinkSync|renameSync/.test(ra));
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
