// [A-1346 ①] The Journey 2 paper's date head reads as two clean lines, like the first paper's (send?) head: the weekday line sits under
// the date line, not on it. Measured in the browser: the date text box and the weekday box must not overlap, on the Explore paper.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { launch, sleep } from "./helpers/a803-browser.mjs";

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a1346 second paper date browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }

const OUT = path.resolve(process.argv[2] || "screenshots/a1346-second-paper-date");
mkdirSync(OUT, { recursive: true });
const H = await launch({ forkMode: true });
const { p } = H;
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails += 1; console.log(`FAIL  ${msg}`); } else console.log(`PASS  ${msg}`); };

// date text = the text node before <small>; weekday = <small>
const boxes = (sel) => p.evaluate((s) => {
  const date = document.querySelector(s);
  if (!date) return null;
  const small = date.querySelector("small");
  const text = [...date.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
  const range = document.createRange(); range.selectNodeContents(text);
  const a = range.getBoundingClientRect(); const b = small.getBoundingClientRect();
  return { date: text.textContent.trim(), weekday: small.textContent.trim(), dateTop: a.top, dateBottom: a.bottom, weekTop: b.top, weekBottom: b.bottom };
}, sel);

try {
  await H.seedSolo("Honeybun");
  for (const [w, h] of [[390, 844], [810, 1080], [1440, 900]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.reload({ waitUntil: "networkidle" });
    await sleep(600);
    await H.unlock();
    await H.waitScene(["sendstay"], 9000);
    await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true }));
    await p.locator("#secondJourneyCard .secondJourney__date").waitFor({ timeout: 8000 });
    await sleep(900);
    const b = await boxes("#secondJourneyCard .secondJourney__date");
    await p.screenshot({ path: path.join(OUT, `explore-${w}.png`) });
    check(!!b && b.dateBottom <= b.weekTop + 0.5, `${w}px: date "${b?.date}" ends at ${b?.dateBottom?.toFixed(1)} · weekday "${b?.weekday}" starts at ${b?.weekTop?.toFixed(1)} (no overlap)`);
  }
} finally {
  await H.close?.();
}
console.log(`A-1346 ① second paper date: ${fails === 0 ? "PASS" : `FAIL ${fails}`} · ${OUT}`);
process.exit(fails === 0 ? 0 : 1);
