import { createResponsiveLayout } from "../../src/responsive-layout.js";
// [A-831] Home keyframe layout sweep / snapshot helper (A-829 items 1-5). Reuses the A-827 browser scaffold.
//   CLI (local browser + vite port; run unsandboxed, one at a time):
//     ARASO_TEST_BROWSER=1 node app/test/helpers/a831-sweep.mjs sweep    <outDir> [wFrom=360] [wTo=1920] [step=1] [heights=800,900,1080]
//     ARASO_TEST_BROWSER=1 node app/test/helpers/a831-sweep.mjs snapshot <outDir> [w,h ...]   (JSON + screenshots, card closed + paper open)
//   Library: layoutOracle(MAIN) (the pure homeKeyframeLayout evaluated in a vm), measure831(H, w, h), stepReport(rows).
//   `sweep` writes sweep_<h>.csv + summary.json (max adjacent-width step per metric, in %).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { launchHome, showSendCard, measure, sleep } from "./a827-sweep.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = path.resolve(HERE, "..", "..", "src", "main.js");
const r2 = (x) => Math.round(x * 100) / 100;
export { sleep, launchHome, showSendCard };

function fnSrc(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} missing`);
  let depth = 0, started = false;
  for (let j = src.indexOf("{", i); j < src.length; j += 1) {
    if (src[j] === "{") { depth += 1; started = true; } else if (src[j] === "}") { depth -= 1; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`${name} unterminated`);
}

/** The pure keyframe rule from main.js, evaluated in a vm: (vw, vh, safeTop?) -> layout. */
export function layoutOracle(main = readFileSync(MAIN_PATH, "utf8"), raw = false) {
  const ctx = { Math, createResponsiveLayout, resolveCssLengthVarPx: () => 0 };
  vm.createContext(ctx);
  vm.runInContext([
    "const HOME_SEAT_W = 150; const HOME_SEAT_H = (HOME_SEAT_W * 551) / 528; const HOME_CENTER = 1041; const HOME_SEAT_L = HOME_CENTER - 0.4991 * HOME_SEAT_W;",
    ...["HK_STAGE_W", "HK_SIDE_M", "HK_BOTTOM", "HK_CAP", "HK_PAPER_H_PER_W", "HK_CARD_REF_W", "HK_F_PORTRAIT", "HK_F_LANDSCAPE", "HK_INK_L", "HK_INK_R", "HK_INK_FOOT", "HK_INK_TOP"].map((n) => main.match(new RegExp(`const ${n} = [^;]+;`))[0]),
    main.match(/const hkClamp = [^;]+;/)[0], fnSrc(main, "hkKey"), fnSrc(main, "homeKeyframeLayoutBase"),
    "let responsiveSolver = null, responsiveSafeTop = null;", fnSrc(main, "getResponsiveSolver"), fnSrc(main, "homeKeyframeLayout"),
    "globalThis.__L = homeKeyframeLayout;",
  ].join("\n"), ctx);
  return raw ? vm.runInContext("homeKeyframeLayoutBase", ctx) : ctx.__L;
}

/** Measured Home values (CSS px). Character stage width = group scale (Piggy seat box / 150 board units) x 271.37 ink units. */
export async function measure831(H, w, h, opts = {}) {
  const m = await measure(H, w, h, opts);
  const S = m.piggy ? m.piggy.w / 150 : null;
  const k = m.card ? m.card.w / 285 : null; // First Send box is 285 k wide (same centre as the 282 k Home paper)
  return {
    ...m, S, k,
    stageW: S == null ? null : S * 271.375, M: m.piggy ? m.vw - m.piggy.r : null, bottom: m.piggy ? m.vh - m.piggy.b : null,
    asX: m.brand?.l ?? null, asFont: m.brandFont, asTop: m.brand?.t ?? null, cardW282: k == null ? null : k * 282,
    cardX: m.card ? (m.card.l + m.card.r) / 2 - (k * 282) / 2 : null, cardY: m.card ? m.card.t + (m.card.h - k * 400.4) / 2 : null,
    pitch: m.linePitch,
  };
}

/** Metrics that may not step by more than 1 % between adjacent 1 px widths (A-829 item 8). */
export const STEP_METRICS = ["stageW", "M", "bottom", "asX", "asFont", "asTop", "cardW282", "pitch"];

/** rows (sorted by width, same height) -> { metric: { maxStepPct, atW } }. */
export function stepReport(rows, metrics = STEP_METRICS) {
  const out = {};
  for (const k of metrics) {
    let max = 0, at = null;
    for (let i = 1; i < rows.length; i += 1) {
      const a = rows[i - 1][k], b = rows[i][k];
      if (a == null || b == null || !(Math.abs(a) > 0)) continue;
      const d = (Math.abs(b - a) / Math.abs(a)) * 100;
      if (d > max) { max = d; at = rows[i].vw; }
    }
    out[k] = { maxStepPct: max, atW: at };
  }
  return out;
}

export const toCsv = (rows, cols = ["vw", "vh", "fmtS", "stageW", "M", "bottom", "asX", "asFont", "asTop", "cardW282", "cardX", "cardY", "pitch", "scrollW", "scrollH"]) =>
  [cols.join(","), ...rows.map((r) => cols.map((c) => (typeof r[c] === "number" ? r2(r[c]) : r[c] ?? "")).join(","))].join("\n") + "\n";

async function cli() {
  const [mode, outDir = "a831_out", ...rest] = process.argv.slice(2);
  mkdirSync(outDir, { recursive: true });
  const H = await launchHome();
  try {
    await showSendCard(H);
    if (mode === "sweep") {
      const from = Number(rest[0] || 360), to = Number(rest[1] || 1920), step = Number(rest[2] || 1);
      const heights = (rest[3] || "800,900,1080").split(",").map(Number);
      const summary = {};
      for (const h of heights) {
        const rows = [];
        for (let w = from; w <= to; w += step) rows.push(await measure831(H, w, h, { settle: 120 }));
        writeFileSync(path.join(outDir, `sweep_${h}.csv`), toCsv(rows));
        summary[`h${h}`] = stepReport(rows);
      }
      writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 1));
      console.log(JSON.stringify(summary, null, 1));
    } else if (mode === "snapshot") {
      const sizes = rest.length ? rest.map((s) => s.split(",").map(Number)) : [[390, 844], [640, 900], [810, 1080], [1000, 700], [1100, 800], [1440, 900], [1920, 1080]];
      const all = {};
      for (const [w, h] of sizes) { const m = await measure831(H, w, h, { settle: 900 }); all[`card_${w}x${h}`] = m; await H.p.screenshot({ path: path.join(outDir, `home_card_${w}x${h}.png`) }); }
      await H.p.evaluate(() => document.querySelector("#sendCard #stayButton")?.click()); await sleep(1500);
      await H.p.setViewportSize({ width: 1440, height: 900 }); await sleep(600); await H.openHomePaper(); await sleep(1200);
      for (const [w, h] of sizes) { const m = await measure831(H, w, h, { settle: 900 }); all[`paper_${w}x${h}`] = m; await H.p.screenshot({ path: path.join(outDir, `home_paper_${w}x${h}.png`) }); }
      writeFileSync(path.join(outDir, "snapshot.json"), JSON.stringify(all, null, 1));
    } else throw new Error(`mode? ${mode}`);
  } finally { await H.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.env.ARASO_TEST_BROWSER === "1") cli().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
