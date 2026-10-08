// [A-827] Desktop Home scale sweep / snapshot helper (A-825 desktop format: one s, s = 1 at 1440x900).
//   CLI (needs a local browser + vite port; run unsandboxed):
//     ARASO_TEST_BROWSER=1 node app/test/helpers/a827-sweep.mjs sweep    <outDir> [wFrom=1100] [wTo=1600] [step=1] [heights=900,800]
//     ARASO_TEST_BROWSER=1 node app/test/helpers/a827-sweep.mjs snapshot <outDir> [w,h ...]      (JSON + screenshots, card pass + paper pass)
//     ARASO_TEST_BROWSER=1 node app/test/helpers/a827-sweep.mjs boundary <outDir>                (1099 / 1100 pair at heights 900 + 800)
//   Library: launchHome(), measure(H, w, h, {resize}), cardPass(H), ratios(rows). Every number is getBoundingClientRect / computed style (CSS px).
//   `sweep` writes sweep_<h>.csv (+ summary.json with the max ratio deviation per metric); the ratio chart PNG is drawn by the caller with
//   whatever plotting is already installed (no npm install) - see WRITER_NOTES.md.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./a803-browser.mjs";

const r2 = (x) => Math.round(x * 100) / 100;
export { sleep };

/** Seeded solo Piggy on Home at (w,h). withCard=true: replays the first-arrival so the First Send card is up (measured with the card). */
export async function launchHome(w = 1440, h = 900) {
  const H = await launch();
  await H.seedSolo("Honeybun");
  await H.p.setViewportSize({ width: w, height: h });
  await H.p.reload({ waitUntil: "networkidle" });
  await sleep(600);
  await H.unlock();
  await H.waitScene(["sendstay"], 9000);
  await sleep(4500);
  return H;
}

/** Opens the First Send card (first-arrival replay through the DEV scene jump) and waits for it. */
export async function showSendCard(H) {
  await H.p.evaluate(() => window.__arasoScene("sendstay", { arrival: true }));
  for (let t0 = Date.now(); Date.now() - t0 < 20000;) {
    if (await H.p.locator("#sendCard #sendButton").count()) break;
    await sleep(250);
  }
  await sleep(3800);
}

const MEASURE = `(() => {
  const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); if (!(b.width > 0)) return null; return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const eff = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); const k = e.offsetWidth ? b.width / e.offsetWidth : 1; return parseFloat(getComputedStyle(e).fontSize) * k; };
  const bs = getComputedStyle(document.body).backgroundSize.split(" ");
  const brandEl = document.querySelector(".arasoBrand");
  const root = getComputedStyle(document.documentElement);
  return {
    vw: innerWidth, vh: innerHeight,
    fmtS: root.getPropertyValue("--fmtS").trim() || null,
    piggy: rect("#homeSeat"), chog: rect("#chogHome img"), name: rect("#homeName"),
    card: rect("#sendCard"), cardAnchor: rect("#sendCardAnchor"), cardText: eff("#sendCard .sendCard__titleText"),
    paper: rect("#homePaper"), paperText: eff("#homePaper .homePaper__heading"),
    records: rect("#recordsCardAnchor"),
    brand: rect(".arasoBrand"), brandFont: brandEl ? parseFloat(getComputedStyle(brandEl).fontSize) : null,
    linePitch: bs.length > 1 ? parseFloat(bs[1]) : null,
    scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
  };
})()`;

/** Measure the current page (optionally after a no-reload resize). */
export async function measure(H, w, h, { resize = true, settle = 450 } = {}) {
  if (resize) { await H.p.setViewportSize({ width: w, height: h }); await sleep(settle); }
  const m = await H.p.evaluate(MEASURE);
  const d = { ...m };
  d.pw = m.piggy?.w ?? null; d.cw = m.chog?.w ?? null;
  d.cardW = m.card?.w ?? null; d.cardH = m.card?.h ?? null;
  d.piggyFoot = m.piggy?.b ?? null; d.chogFoot = m.chog?.b ?? null;
  d.sideMargin = m.chog ? m.vw - Math.max(m.chog.r, m.piggy?.r ?? 0) : null;   // right edge of the character stage to the viewport edge
  d.bottomMargin = m.piggy ? m.vh - m.piggy.b : null;                               // Piggy foot to the viewport bottom
  d.brandX = m.brand?.l ?? null; d.brandY = m.brand?.t ?? null;
  d.paperW = m.paper?.w ?? null;
  return d;
}

/** Metrics compared as metric / vw (A-825 item 8). */
export const RATIO_METRICS = ["pw", "cw", "cardW", "cardText", "brandX", "brandY", "brandFont", "sideMargin", "bottomMargin", "linePitch", "paperW"];

/** rows -> { metric: { mean, maxDevPct } } over rows where the metric exists. */
export function ratios(rows, metrics = RATIO_METRICS) {
  const out = {};
  for (const k of metrics) {
    const v = rows.filter((r) => r[k] != null && r.vw > 0).map((r) => r[k] / r.vw);
    if (!v.length) { out[k] = null; continue; }
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    out[k] = { n: v.length, mean, maxDevPct: Math.max(...v.map((x) => Math.abs(x / mean - 1) * 100)) };
  }
  return out;
}

export const toCsv = (rows, cols = ["vw", "vh", "fmtS", ...RATIO_METRICS, "piggyFoot", "chogFoot", "cardH"]) =>
  [cols.join(","), ...rows.map((r) => cols.map((c) => (typeof r[c] === "number" ? r2(r[c]) : r[c] ?? "")).join(","))].join("\n") + "\n";

async function cli() {
  const [mode, outDir = "a827_out", ...rest] = process.argv.slice(2);
  mkdirSync(outDir, { recursive: true });
  const H = await launchHome();
  try {
    if (mode === "sweep") {
      const from = Number(rest[0] || 1100), to = Number(rest[1] || 1600), step = Number(rest[2] || 1);
      const heights = (rest[3] || "900,800").split(",").map(Number);
      const summary = {};
      for (const pass of ["card", "paper"]) {
        if (pass === "card") await showSendCard(H);
        else { await H.p.evaluate(() => document.querySelector("#sendCard #stayButton")?.click()); await sleep(1500); await H.p.setViewportSize({ width: 1440, height: 900 }); await sleep(600); await H.openHomePaper(); await sleep(1200); }
        for (const h of heights) {
          const rows = [];
          for (let w = from; w <= to; w += step) rows.push(await measure(H, w, h, { settle: 350 }));
          writeFileSync(path.join(outDir, `sweep_${pass}_${h}.csv`), toCsv(rows));
          summary[`${pass}_${h}`] = ratios(rows, pass === "card" ? RATIO_METRICS.filter((k) => k !== "paperW") : ["pw", "cw", "brandX", "brandFont", "sideMargin", "bottomMargin", "linePitch", "paperW"]);
        }
      }
      writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 1));
      console.log(JSON.stringify(summary, null, 1));
    } else if (mode === "snapshot") {
      const sizes = rest.length ? rest.map((s) => s.split(",").map(Number)) : [[1100, 900], [1280, 800], [1440, 900], [1600, 900], [1920, 1080]];
      const all = {};
      await showSendCard(H);
      for (const [w, h] of sizes) { const m = await measure(H, w, h, { settle: 900 }); all[`card_${w}x${h}`] = m; await H.p.screenshot({ path: path.join(outDir, `home_card_${w}x${h}.png`) }); }
      await H.p.evaluate(() => document.querySelector("#sendCard #stayButton")?.click()); await sleep(1500);
      for (const [w, h] of sizes) {
        await H.p.setViewportSize({ width: w, height: h }); await sleep(700);
        await H.openHomePaper(); await sleep(900);
        all[`paper_${w}x${h}`] = await measure(H, w, h, { resize: false });
        await H.p.screenshot({ path: path.join(outDir, `home_paper_${w}x${h}.png`) });
      }
      writeFileSync(path.join(outDir, "snapshot.json"), JSON.stringify(all, null, 1));
      console.log(`wrote ${Object.keys(all).length} snapshots`);
    } else if (mode === "boundary") {
      await showSendCard(H);
      const rows = [];
      for (const h of [900, 800]) for (const w of [1099, 1100]) rows.push(await measure(H, w, h, { settle: 900 }));
      writeFileSync(path.join(outDir, "boundary.json"), JSON.stringify(rows, null, 1));
      console.log(toCsv(rows));
    } else throw new Error(`unknown mode ${mode}`);
    console.log("pageerrors:", JSON.stringify(H.errors));
  } finally { await H.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP - set ARASO_TEST_BROWSER=1"); process.exit(0); }
  cli().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
