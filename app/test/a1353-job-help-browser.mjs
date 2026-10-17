// [A-1353 ② · Owner 10-17 13:4x "잡 관련 일들 설명을 다 정했는데 안 나와" · FIRST_JOURNEY_PACING_20261015.md:161–167 "2차 잡 설명 = ? 탭 때 초그"]
// On the Journey 2 job card (the picked job with Home / Send), a tap on ? = Chog says that job's explanation, the job's two lines in turn
// (Owner set, word for word). Not the last line again.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { launch, sleep } from "./helpers/a803-browser.mjs";

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a1353 job help browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }
const OUT = path.resolve(process.argv[2] || "screenshots/a1353-job-help");
mkdirSync(OUT, { recursive: true });
// Owner set (sian chog_lines_sian_20261016.md:41–50) — job title on the card → its lines
const SET = {
  "go to the market": ["piggy trades one coin for another.", "a quick swap at the market."],
  "leave an order": ["piggy leaves a price and waits.", "buy only if the price comes."],
  "pick up what is owed": ["piggy picks up what's yours.", "something's waiting for you."],
  "put some money to work": ["piggy parks money where it earns a little.", "let money sit and grow."],
};
// [Cowork 14:1x] tidy the wallet (new meaning · change → MON) and help with trades (★ lines) are in too — checked in main.js word for word
import { readFileSync } from "node:fs";
const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
for (const [id, lines] of [["clean", ["want me to sweep the crumbs into MON?", "little bits everywhere. make them one MON pile?"]], ["lp", ["earn a little when people swap", "piggy helps others trade."]]]) {
  const row = new RegExp(`\\b${id}: \\[${lines.map((l) => JSON.stringify(l).replace(/[.?*+()[\]]/g, "\\$&")).join(", ")}\\]`);
  if (!row.test(MAIN)) { console.log(`FAIL  ${id} lines in JOB_HELP_LINES`); process.exitCode = 1; } else console.log(`PASS  ${id} lines in JOB_HELP_LINES`);
}
const H = await launch({ forkMode: true });
const { p } = H;
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails += 1; console.log(`FAIL  ${msg}`); } else console.log(`PASS  ${msg}`); };
const said = () => p.evaluate(() => [...document.querySelectorAll("#chogHome .chogCheckLine")].map((e) => e.textContent.trim()).filter(Boolean));
try {
  await H.seedSolo("Honeybun");
  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload({ waitUntil: "networkidle" });
  await sleep(600);
  await H.unlock();
  await H.waitScene(["sendstay"], 9000);
  await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true }));
  await p.locator("#secondJourneyCard .secondJourney__item").first().waitFor({ timeout: 8000 });
  // pick the market errand (go to the market), save, pick its candidate, ok → the job card
  const items = p.locator("#secondJourneyCard .secondJourney__item");
  const n = await items.count();
  for (let i = 0; i < n; i += 1) if (/go to the market/.test(await items.nth(i).textContent())) { await items.nth(i).click(); break; }
  await p.locator("#exploreSaveButton").click();
  await p.locator(".secondJourney__pick").first().waitFor({ timeout: 10000 });
  await p.locator(".secondJourney__pick").first().click();
  await p.locator("#secondOkButton").click();
  await p.locator("#secondSendButton").waitFor({ timeout: 10000 });
  await sleep(800);
  const title = (await p.locator("#secondJourneyCard .job").first().textContent())?.trim();
  const want = SET[title] || null;
  await p.screenshot({ path: path.join(OUT, "job-card.png") });
  check(!!want, `job card title "${title}" has an Owner set`);
  const help = await p.locator("#chogHelp").count();
  check(help === 1, "? is on the job card");
  if (help === 1 && want) {
    await p.locator("#chogHelp").click(); await sleep(600);
    const a = await said();
    await p.screenshot({ path: path.join(OUT, "help-1.png") });
    check(a.includes(want[0]), `first ? = "${want[0]}" (Chog said ${JSON.stringify(a)})`);
    await p.locator("#chogHelp").click(); await sleep(600);
    const b = await said();
    check(b.includes(want[1]), `second ? = "${want[1]}" (Chog said ${JSON.stringify(b)})`);
    await p.locator("#chogHelp").click(); await sleep(600);
    check((await said()).includes(want[0]), "third ? = the first line again (two lines in turn)");
  }
} finally {
  await H.close?.();
}
console.log(`A-1353 ② job help: ${fails === 0 ? "PASS" : `FAIL ${fails}`} · ${OUT}`);
process.exit(fails === 0 && !process.exitCode ? 0 : 1);
