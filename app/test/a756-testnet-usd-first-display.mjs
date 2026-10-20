// [A-756] TESTNET First Job display truth (Owner decision lock 2026-10-05 (A)) — node only, network 0, browser 0.
//   node app/test/a756-testnet-usd-first-display.mjs
// - main visible First-test amount = "$5" on the existing pre-send card (send-card.js terms row)
// - the real fixed amount (SEND_AMOUNT = 0.001 MON) appears only as secondary/faint detail: pre-send card detail line + Receipt "Sent" row
// - no "$5 limit" / "up to $5" (no claim of a dynamic USD enforcement that does not exist)
// - no price source / conversion / rounding / oracle; execution amount unchanged
// - H-1 stale-tab guard runtime proof lives in money-safety-m2b.mjs (A756-H1*); source-position pins repeated here.
import fs from "node:fs";
import vm from "node:vm";
import { formatEther, parseEther } from "viem";
import { sendCardMarkup } from "../src/send-card.js";

const MAIN = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CSS = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) pass += 1;
  else fail += 1;
};
function fnSrc(name) {
  const m = MAIN.match(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  if (!m) throw new Error(`function missing: ${name}`);
  return MAIN.slice(m.index, MAIN.indexOf("\n}\n", m.index) + 2);
}
const constLine = (name) => {
  const m = MAIN.match(new RegExp(`^const ${name} = .*;$`, "m"));
  if (!m) throw new Error(`const missing: ${name}`);
  return m[0];
};
const visibleText = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// ── copy / constants ─────────────────────────────────────────────────────────────────────────────
check("no '$5 limit' copy anywhere in main.js", !MAIN.includes("$5 limit"));
check("no 'up to $5' copy anywhere in main.js", !/up to \$5/i.test(MAIN));
check("away line no longer claims 'up to $5' (now 'Can go out once.')", MAIN.includes('setScene("away", "Piggy went out.", "Can go out once.");'));
check("execution amount unchanged: SEND_AMOUNT = parseEther(\"0.001\")", constLine("SEND_AMOUNT") === 'const SEND_AMOUNT = parseEther("0.001");');
check("FIRST_SEND_USD is the fixed literal \"$5\" (no computation)", constLine("FIRST_SEND_USD") === 'const FIRST_SEND_USD = "$5";');
// [A-779 RE-PIN] A-777 §8.2 LOCKED removes the "Ask me every time" / "One-time" rows from the visible card (label-only;
// the one-time refusal is pinned by money-safety-first / a756 enforcement suites, untouched). The $5 row stays first (and only).
check("send card terms: first row is the $5 label", MAIN.includes('terms: [FIRST_SEND_USD_LABEL],'));
{
  const block = MAIN.slice(MAIN.indexOf("// [A-756] TESTNET"), MAIN.indexOf("const SHMON_ADDRESS"));
  const rows = fnSrc("sentRowValue");
  const all = block + rows;
  check("no oracle / price feed / conversion / rounding in the A-756 display code", !/oracle|price|usdTo|toUsd|monToUsd|fetch\(|Math\.round|toFixed|\* ?\d|\/ ?\d/i.test(all.replace(/\/\/.*$/gm, "")), all);
}

// ── pre-send card: rendered through the real send-card.js with the real label/secondary values ───────────────
const ctx = { formatEther, parseEther, Number, String, BigInt };
vm.createContext(ctx);
vm.runInContext(
  [constLine("SEND_AMOUNT"), constLine("FIRST_SEND_USD"), constLine("FIRST_SEND_USD_LABEL"), fnSrc("firstSendAmountSecondary"), fnSrc("formatMoney"), fnSrc("shortHash"), fnSrc("sentRowValue"), fnSrc("receiptRows"), fnSrc("receiptCheck"), fnSrc("escapeHtml"), fnSrc("receiptRowMarkup"),
    "globalThis.__t = { SEND_AMOUNT, FIRST_SEND_USD_LABEL, firstSendAmountSecondary, receiptRows, receiptCheck, receiptRowMarkup };"].join("\n"),
  ctx,
);
const T = ctx.__t;
check("secondary pre-send detail = '0.001 MON test' (from SEND_AMOUNT via formatMoney)", T.firstSendAmountSecondary() === "0.001 MON test", T.firstSendAmountSecondary());
check("main label is exactly '$5'", T.FIRST_SEND_USD_LABEL === "$5", T.FIRST_SEND_USD_LABEL);
{
  // reproduce renderSendStay's detail composition exactly (source pin below keeps it honest)
  // [A-1434 A5] the "0.001 MON test" line left the card: detail = state.detail only; the actual MON is in more info (firstSendActualLine) and on the
  // first sheet. pre-A-1434: composeSrc = [state.detail, firstSendAmountSecondary()].filter(Boolean).join(" · ") and det.endsWith("0.001 MON test")
  const composeSrc = ": state.detail || \"\",";
  check("renderSendStay composes detail = state.detail only (non-blocked) · the MON amount moved to more info", fnSrc("renderSendStay").includes(composeSrc) && /firstSendActualLine\(\)/.test(fnSrc("firstSendInfoMarkup")) && /formatMoney\(SEND_AMOUNT\)/.test(fnSrc("firstSendActualLine")));
  for (const detail of ["", "Open again when you need it.", "nothing moved."]) {
    const composed = detail;
    const html = sendCardMarkup({ message: "Piggy is home.", detail: composed, terms: [T.FIRST_SEND_USD_LABEL] }); // [A-779] = the live terms list
    const terms = [...html.matchAll(/class="sendCard__termLabel">([^<]*)</g)].map((m) => m[1]);
    const det = (html.match(/class="sendCard__detail">([^<]*)</) || [])[1] || "";
    check(`card[detail=${JSON.stringify(detail)}]: terms row 1 shows '$5' (USD-first main amount)`, terms[0] === "$5", JSON.stringify(terms));
    check(`card[detail=${JSON.stringify(detail)}]: no MON on the card's terms / message / detail lines (it lives in more info)`, !det.includes("MON") && !terms.join("|").includes("MON") && !/sendCard__message">[^<]*MON/.test(html), det);
    check(`card[detail=${JSON.stringify(detail)}]: visible text has no 'limit' / 'up to'`, !/limit|up to/i.test(visibleText(html)), visibleText(html));
  }
  const blocked = fnSrc("renderSendStay").match(/detail: blocked\s*\?\s*"Piggy can only go out from the real app\."/);
  check("blocked origin card keeps its existing detail (no amount claim where nothing can go out)", !!blocked);
}
check(".sendCard__detail is the existing faint style (italic 12px, rgba .6) — reused, not changed", /\.sendCard__detail,\n\.sendCard__address \{\n  margin: 0 0 6px;\n  font: italic 12px\/1\.4 Georgia, "Times New Roman", serif;\n  color: rgba\(20, 18, 16, 0\.6\);/.test(CSS));

// ── Receipt rows (filebox + HISTORY detail use receiptRows; value is inserted as markup) ───────────────────────
const legacy = { before: 500000000000000000n, sent: 1000000000000000n, gas: 1000000000000n, after: 498999000000000000n, txHash: "0x" + "ab".repeat(32), redeemTxHash: "0x" + "cd".repeat(32), redeemBlockNumber: 101n };
const rows = T.receiptRows(legacy);
// [A-768 M-T-2 · declared expectation update] rows now carry TEXT ({ label, value, sub? }) and receiptRowMarkup() escapes it; the
// rendered Sent markup must stay byte-identical to the pre-A-768 `<span class="value">$5 <span class="receipt-sub">0.001 MON</span></span>`.
const sentRow = rows.find((r) => r.label === "Sent") || {};
const sent = T.receiptRowMarkup(sentRow);
check("Receipt Sent row = '$5' first, real '0.001 MON' as faint .receipt-sub", sentRow.value === "$5" && sentRow.sub === "0.001 MON" && sent === '<p class="receipt-row"><span class="label">Sent</span><span class="value">$5 <span class="receipt-sub">0.001 MON</span></span></p>', sent);
check("Receipt labels unchanged (Sent/Cost/Left/Tx/Block)", rows.map((r) => r.label).join(",") === "Sent,Cost,Left,Tx,Block");
check("Cost/Left stay exact MON, no '$'", rows.filter((r) => r.label === "Cost" || r.label === "Left").every((r) => /MON$/.test(r.value) && !r.value.includes("$")));
check("non-First amount never claims $5", T.receiptRows({ ...legacy, sent: 2000000000000000n }).find((r) => r.label === "Sent").value === "0.002 MON");
check("add_money receipt untouched (Tx/Block only, no $)", JSON.stringify(T.receiptRows({ kind: "add_money", txHash: "0x" + "ef".repeat(32), blockNumber: 7 })).includes("$") === false);
check("receiptCheck math unchanged (no $)", !T.receiptCheck(legacy).includes("$") && T.receiptCheck(legacy).includes("same as Left"));
check(".receipt-row .receipt-sub = faint secondary (color + size only)", /\.receipt-row \.receipt-sub \{\n  color: rgba\(22, 22, 22, 0\.5\);\n  font-size: 0\.85em;\n\}/.test(CSS));

// ── H-1 source pins (runtime proof: money-safety-m2b.mjs A756-H1a..h) ─────────────────────────────────────
{
  const p = fnSrc("promoteSendReservation");
  check("H-1: promoteSendReservation (runs only inside the exclusive lock) rechecks trip-closed before writing the shared slot", p.indexOf("firstTripClosedShared()") > 0 && p.indexOf("firstTripClosedShared()") < p.indexOf("localStorage.setItem(SEND_PENDING_KEY"));
  const f = fnSrc("firstTripClosedShared");
  check("H-1: trip-closed reads shared storage each call (TRIP_CLOSED_KEY + legacy txHash) and fails closed", f.includes("localStorage.getItem(closedKey)") && f.includes('localStorage.getItem("araso.txHash")') && /catch \{\s*return true;/.test(f));
}

console.log(`\nA-756 display: ${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
