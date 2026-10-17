// [A-1361 · Owner 10-17 16:0x "익스플로어일 때 표시를 해보자" · "줄 누르면 초그가 말함"] On the Journey 2 pick paper (candidates), a tap on
// a job row = Chog says that job's two Owner lines (JOB_HELP_LINES) over its head, one at a time; another row = that job's lines. Also
// measured, 390 · 810 · 1440: [A-1366 RE-PIN · Owner 22:1x] the lines start on the one Chog start line, left-aligned (pre-A-1366: A-1359 left of Chog as .chogCheckLine--left), in the
// Owner's pieces (same words, one at a time) — pre-A-1359: the default spot centred over Chog (Cowork 18:0x).
// (base: A-1353 ② "잡 관련 일들 설명을 다 정했는데 안 나와" · FIRST_JOURNEY_PACING_20261015.md:161–167 "2차 잡 설명 = ? 탭 때 초그"]
// On the Journey 2 job card (the picked job with Home / Send), a tap on ? = Chog says that job's explanation, the job's two lines in turn
// (Owner set, word for word). Not the last line again.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { launch, sleep } from "./helpers/a803-browser.mjs";

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a1361 explore say browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }
const OUT = path.resolve(process.argv[2] || "screenshots/a1361-explore-say");
mkdirSync(OUT, { recursive: true });
// Owner set (sian chog_lines_sian_20261016.md:41–50) — job title on the card → its lines
const SET = {
  "go to the market": ["piggy trades one coin for another.", "a quick swap at the market."],
  "leave an order": ["piggy leaves a price and waits.", "buy only if the price comes."],
  "pick up what is owed": ["piggy picks up what's yours.", "something's waiting for you."],
  "put some money to work": ["piggy parks money where it earns a little.", "let money sit and grow."],
};
const H = await launch({ forkMode: true });
const { p } = H;
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails += 1; console.log(`FAIL  ${msg}`); } else console.log(`PASS  ${msg}`); };
const say = () => p.evaluate(() => { const s = document.querySelector("#chogHome #exploreChogSay"); if (!s) return []; const l = [...s.querySelectorAll(".chogCheckLine__line")]; return (l.length ? l : [s]).filter((e) => getComputedStyle(e).visibility !== "hidden").map((e) => e.textContent.trim()); });
const geo = () => p.evaluate(() => {
  const s = document.querySelector("#chogHome #exploreChogSay"); if (!s) return null;
  const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const ink = (e) => { const r = document.createRange(); r.selectNodeContents(e); return box(r); };
  const lines = [...(s.querySelectorAll(".chogCheckLine__line").length ? s.querySelectorAll(".chogCheckLine__line") : [s])].map((e) => ({ text: e.textContent.trim(), ...ink(e) }));
  const pig = [...document.querySelectorAll("#homeSeat, #homeWalk")].filter((e) => { const cs = getComputedStyle(e); return cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; }).map(box);
  const parts = [...document.querySelectorAll("#chogHome .chogHome__part")].filter((e) => { const cs = getComputedStyle(e); return cs.visibility !== "hidden" && Number(cs.opacity) > 0.05 && e.getBoundingClientRect().width > 0; }).map(box);
  const chogL = parts.length ? Math.min(...parts.map((x) => x.l)) : null;
  return { w: innerWidth, lines: lines.map((x) => [x.text, Math.round(x.l), Math.round(x.r)]), minL: Math.min(...lines.map((x) => x.l)), maxR: Math.max(...lines.map((x) => x.r)), pig: pig.map((x) => [Math.round(x.l), Math.round(x.r)]), chogL };
});
async function toPickList() {
  await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true }));
  await p.locator("#secondJourneyCard .secondJourney__item").first().waitFor({ timeout: 8000 });
  const items = p.locator("#secondJourneyCard .secondJourney__item");
  const n = await items.count();
  for (let i = 0; i < n; i += 1) if (/go to the market|leave an order/.test(await items.nth(i).textContent())) await items.nth(i).click();
  await p.locator("#exploreSaveButton").click();
  await p.locator(".secondJourney__pick").first().waitFor({ timeout: 10000 });
  await sleep(4500); // "let me see which jobs can go." then the pick line
}
try {
  await H.seedSolo("Honeybun");
  for (const [w, h] of [[390, 844], [810, 1080], [1440, 900]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600); await H.unlock(); await H.waitScene(["sendstay"], 9000);
    await toPickList();
    const picks = p.locator(".secondJourney__pick");
    const titles = [];
    for (let i = 0; i < await picks.count(); i += 1) titles.push((await picks.nth(i).textContent()).trim());
    const first = titles.findIndex((t) => SET[t]);
    check(first >= 0, `${w}: a job row with an Owner set (${JSON.stringify(titles)})`);
    if (first < 0) continue;
    await picks.nth(first).click(); await sleep(700);
    const a = await say();
    await p.screenshot({ path: path.join(OUT, `pick-${w}-line1.png`) });
    check(a.length > 0 && SET[titles[first]][0].startsWith(a.join(" ")), `${w}: tap "${titles[first]}" → Chog: "${SET[titles[first]][0]}" (said ${JSON.stringify(a)})`);
    let b = await say();
    for (let t = 0; t < 30 && !b.join(" ").includes(SET[titles[first]][1]); t += 1) { await sleep(500); b = await say(); } // pieces come one at a time
    await p.screenshot({ path: path.join(OUT, `pick-${w}-line2.png`) });
    check(b.join(" ") === SET[titles[first]].join(" "), `${w}: then the second line, the first kept (said ${JSON.stringify(b)})`);
    const g = await geo();
    const spot = await p.evaluate(() => { const s = document.querySelector("#exploreChogSay"); const cs = getComputedStyle(s); return { cls: s.className, marginLeft: cs.marginLeft, translate: cs.translate, inline: s.getAttribute("style") }; });
    check(/is-explain/.test(spot.cls) && g.minL >= 7.5 && g.lines.every(([, l]) => Math.abs(l - g.lines[0][1]) <= 1) && g.maxR < g.w, `${w}: from the one start line, left-aligned, ≥ 8 px from the edge (its Chog clearance = a1366 test) ${JSON.stringify(spot)} · measured ${JSON.stringify(g)}`);
    const other = titles.findIndex((t, i) => i !== first && SET[t]);
    if (other >= 0) {
      await picks.nth(other).click(); await sleep(700);
      const c = await say();
      check(c.length > 0 && SET[titles[other]][0].startsWith(c.join(" ")), `${w}: another row "${titles[other]}" → its first line (said ${JSON.stringify(c)})`);
    }
  }
} finally {
  await H.close?.();
}
console.log(`A-1361 explore say: ${fails === 0 ? "PASS" : `FAIL ${fails}`} · ${OUT}`);
process.exit(fails === 0 ? 0 : 1);
