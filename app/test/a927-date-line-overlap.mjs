// [A-927] Date / weekday line ink overlap on the Send card and the Name card — for EVERY real label, not just today's.
// The labels come from the same toLocaleDateString("en-US") calls as send-card.js:71-72 / name-card.js:45-46, injected into a copy of each card's
// date block in the page (the app clock is NOT pinned). Ink = the a845 method: the line's Range rect narrowed to the glyphs' real extent
// (canvas actualBoundingBoxAscent / Descent vs fontBoundingBox*). A gap < 1 on-screen px at the card's phone scale = FAIL.
// Browser only (ARASO_TEST_BROWSER=1). Without it this file prints SKIP and exits 0.
import assert from "node:assert/strict";
import { launch, sleep, harnessPresent } from "./helpers/a803-browser.mjs";

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a927 browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }
if (!harnessPresent()) { console.log("SKIP  a927 (no _private/ops/harness)"); process.exit(0); }

// every month-day label of a leap year + every weekday label (uppercase, en-US: the cards' own format)
const days = [], weekdays = new Set();
for (let t = Date.UTC(2028, 0, 1); t < Date.UTC(2029, 0, 1); t += 864e5) {
  const d = new Date(t);
  days.push(d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).toUpperCase());
  weekdays.add(d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toUpperCase());
}
const H = await launch();
const { p } = H;
let fail = 0;
const out = {};
try {
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(H.BASE, { waitUntil: "networkidle" }); await sleep(1500);
  await p.evaluate(() => document.fonts && document.fonts.ready);
  for (const card of ["sendCard", "nameCard"]) {
    const r = await p.evaluate(async ([card, days, weekdays]) => {
      await document.fonts.ready;
      const host = document.createElement("div");
      host.className = card; host.style.cssText = "position:absolute;left:0;top:0;width:460px;height:600px;transform:none;visibility:visible;z-index:99999";
      host.innerHTML = `<div class="${card}__date"><div class="${card}__day"></div><div class="${card}__weekday"></div></div>`;
      document.body.appendChild(host);
      const dayEl = host.querySelector(`.${card}__day`), wkEl = host.querySelector(`.${card}__weekday`);
      const ctx = document.createElement("canvas").getContext("2d");
      const ink = (e, txt) => {
        const cs = getComputedStyle(e); ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const mt = ctx.measureText(txt);
        const rg = document.createRange(); rg.selectNodeContents(e); const rr = rg.getBoundingClientRect();
        const k = rr.height / (mt.fontBoundingBoxAscent + mt.fontBoundingBoxDescent);
        return { top: rr.top + (mt.fontBoundingBoxAscent - mt.actualBoundingBoxAscent) * k, bottom: rr.top + (mt.fontBoundingBoxAscent + mt.actualBoundingBoxDescent) * k };
      };
      let worst = { gap: Infinity };
      for (const w of weekdays) {
        wkEl.textContent = w;
        for (const d of days) {
          dayEl.textContent = d;
          const a = ink(dayEl, d), b = ink(wkEl, w);
          const gap = b.top - a.bottom;
          if (gap < worst.gap) worst = { gap, day: d, weekday: w };
        }
      }
      // the card's phone scale: local px -> on-screen px at 390. --tsK is a calc() string, so derive it from the weekday style:
      // tsWeekday = ts-weekday (12 × 0.7 = 8.4 on-screen px, A-843 #5) / tsK  =>  tsK = 8.4 / computed weekday font size
      const k = 8.4 / parseFloat(getComputedStyle(wkEl).fontSize);
      host.remove();
      return { worst, tsK: k, combos: days.length * weekdays.length };
    }, [card, days, [...weekdays]]);
    out[card] = r;
    const screenGap = r.worst.gap * (r.tsK || 1);
    const ok = screenGap >= 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${card}: worst ink gap over ${r.combos} labels = ${r.worst.gap.toFixed(2)} local px (≈ ${screenGap.toFixed(2)} on-screen px at the phone scale, tsK ${r.tsK.toFixed(4)}) — "${r.worst.day}" / "${r.worst.weekday}"`);
    if (!ok) fail += 1;
  }
} catch (e) { console.log("FAIL  exception", e); fail += 1; }
finally { await H.close(); }
if (process.env.A927_OUT) (await import("node:fs")).writeFileSync(process.env.A927_OUT, JSON.stringify(out, null, 1));
process.exit(fail ? 1 : 0);
