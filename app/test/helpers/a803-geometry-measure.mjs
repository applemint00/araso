// [A-803] CLI: measured collision evidence of the lying (Flop→sleep) pose against Chog / other Piggies / Paper+HISTORY / safe viewport,
// at the 6 Home viewports. Usage: node a803-geometry-measure.mjs <solo|multi> <awake|dozing> <label> <outDir>
//   awake = Chog awake (3 s sleep seam) · dozing = Chog already dozing (real >60 s idle, 70 s seam, A-790 order of events)
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { launch, sleep, sweepSeat, SEAT, COMP } from "./a803-browser.mjs";

const [mode = "solo", chog = "awake", label = "before", outDir = "."] = process.argv.slice(2);
export const VIEWPORTS = [[390, 844], [430, 932], [700, 900], [1024, 768], [1180, 820], [1440, 900]];
mkdirSync(path.join(outDir, "shots"), { recursive: true });
const h = await launch();
const table = {};
try {
  const seam = chog === "dozing" ? 70000 : 3000;
  // A803_ADJUST='{"angle":0}' re-measures the pre-adjustment pose (the "before" columns) on the final build
  await h.context.addInitScript(([ms, force, adj]) => { globalThis.__a790SleepAfterMs = ms; if (force) globalThis.__a803AmbientForce = force; if (adj) globalThis.__a803SleepAdjust = adj; }, [seam, mode === "multi" ? { seat: "idle", companion: "idle" } : null, process.env.A803_ADJUST ? JSON.parse(process.env.A803_ADJUST) : null]);
  await h.seedSolo();
  if (mode === "multi") await h.seedMulti();
  for (const [w, hh] of VIEWPORTS) {
    const key = `${w}x${hh}`;
    await h.p.setViewportSize({ width: w, height: hh });
    await h.p.reload({ waitUntil: "networkidle" }); await sleep(600); await h.unlock(); await h.waitScene(["sendstay"], 9000);
    const shotAt = new Set([0.5, 6, 20]);
    const r = await sweepSeat(h.p, { others: mode === "multi" ? COMP : null, onSample: async (T) => { if (shotAt.has(T)) await h.p.screenshot({ path: path.join(outDir, "shots", `${label}_${mode}_${chog}_${key}_T${String(T).replace(".", "p")}.png`) }); } });
    if (r.error) { table[key] = r; continue; }
    // footprints that only exist when Home is opened: wake first (any interaction), then read Paper / HISTORY / seat / safe margins
    const seat = await h.p.evaluate(() => { const b = document.querySelector('.homeLiving[data-seat="1"]')?.getBoundingClientRect(); return b ? [b.left, b.top, b.right, b.bottom].map(Math.round) : null; });
    await h.p.evaluate(() => { window.__a803Fz = null; });
    const opened = await h.openHomePaper(); await sleep(800);
    const paper = await h.p.evaluate(() => { const b = document.querySelector("#homePaper")?.getBoundingClientRect(); return b && b.width > 100 ? [b.left, b.top, b.right, b.bottom].map(Math.round) : null; });
    let records = null;
    if (opened && await h.realClick(".homePaper__records", 0) === "pointer") { await sleep(1300); records = await h.p.evaluate(() => { const b = document.querySelector("#recordsCardAnchor")?.getBoundingClientRect(); return b && b.width > 50 ? [b.left, b.top, b.right, b.bottom].map(Math.round) : null; }); await h.closeRecords(); }
    const safe = await h.p.evaluate(() => ({ top: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-top-safe")) || null, bottom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-bottom-safe")) || null }));
    const ink = r.summary.sleeperInkUnion;
    const gapTo = (b) => (b && ink ? { dx: Math.max(b[0] - ink[2], ink[0] - b[2]), dy: Math.max(b[1] - ink[3], ink[1] - b[3]) } : null);
    table[key] = { ...r.summary, seatBox: seat, paperBox: paper, recordsBox: records, safe, inkToPaper: gapTo(paper), inkToRecords: gapTo(records), inkToViewport: ink ? { left: ink[0], top: ink[1], right: r.summary.vw - ink[2], bottom: r.summary.vh - ink[3] } : null, rows: r.rows.map((x) => ({ T: x.T, overlapChog: x.vsChog.overlapPx, gapChog: x.vsChog.minGapPx, overlapOthers: x.vsOthers.overlapPx, gapOthers: x.vsOthers.minGapPx, ink: x.sleeperInk })) };
    console.log(key, JSON.stringify({ overlapChog: r.summary.maxOverlapChogPx, gapChog: r.summary.minGapChogPx, overlapOthers: r.summary.maxOverlapOthersPx, gapOthers: r.summary.minGapOthersPx, ink }));
  }
} catch (e) { table.error = String((e && e.stack) || e); console.log("ERROR", table.error); } finally {
  table.pageErrors = h.errors;
  writeFileSync(path.join(outDir, `geometry_${label}_${mode}_${chog}.json`), JSON.stringify(table, null, 1));
  await h.close();
}
