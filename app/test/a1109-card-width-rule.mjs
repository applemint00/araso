// [A-1109] S4 Framer card-width rule selected from the A-1113 board.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { layoutOracle } from "./helpers/a831-sweep.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(path.resolve(HERE, "../src/main.js"), "utf8");
const L = layoutOracle(MAIN);
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b} (tol ${tol})`);
let pass = 0, fail = 0;
const check = (label, fn) => { try { fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${e.message}`); fail += 1; } };

check("N1 S4 19-size widths: A-1113 table, then answer 11 (open Home paper also fits) - 4 short landscape sizes shrink to the floor line", () => {
  // pre-A-1109(answer 11): 667x375 220.810 · 844x390 228.761 · 1280x640 375.397 · 1440x600 351.936 (Send box only fitted; paper reached past the floor line).
  const expected = [
    [320,568,231.631],[360,640,260.585],[375,667,271.442],[390,844,282.324],[393,659,283.217],
    [393,852,285.279],[430,932,315.824],[667,375,210.763],[810,1080,410.704],[844,390,218.352],
    [1024,768,399.083],[1280,640,358.317],[1280,800,385.186],[1440,600,335.923],[1440,900,376.500],
    [1536,864,401.600],[1920,1080,500.745],[2560,1440,500.745],[3840,2160,500.745],
  ];
  for (const [w, h, cw] of expected) near(L(w, h).cardW, cw, 0.5, `${w}x${h}`);
});

check("N2 reference frames remain within 0.5 px and 1920/1440 = 1.33", () => {
  for (const [w,h,cw] of [[390,844,282.3],[810,1080,410.7],[1440,900,376.5]]) near(L(w,h).cardW, cw, 0.5, `${w}x${h}`);
  near(L(1920,1080).cardW / L(1440,900).cardW, 1.33, 1e-12, "ratio");
});

check("N3 one-pixel sweep 360..1920 has no adjacent card-width step above 1 percent", () => {
  for (const h of [659,844,900,1080]) { let prev = L(360,h).cardW; for (let w=361; w<=1920; w+=1) { const cw=L(w,h).cardW; assert.ok(Math.abs(cw-prev)/prev <= 0.01, `${w}x${h}`); prev=cw; } }
});

check("N4 S4 max-width composition freezes at 1920 and centres above it", () => {
  const a=L(1920,1080), b=L(2560,1080); near(b.cardW,a.cardW,1e-12,"card"); near(b.stageW,a.stageW,1e-12,"stage"); near(b.cardX-a.cardX,320,1e-9,"card centre offset"); near(b.stageLeft-a.stageLeft,320,1e-9,"stage offset");
});

check("N5 A-835 consumer ratios and A-829 12 px History rail remain wired", () => {
  assert.match(MAIN, /--hlCardW/); assert.match(MAIN, /cardW \/ 285/); assert.match(MAIN, /L\.stageLeft - 12/);
  assert.doesNotMatch(MAIN, /characterGuard = 50/);
});

// [A-1109 answers 13/14] History placement on the S4 layout: the pure computeHistoryPlacement in a vm, desktopFormat = the S4 layout.
const placement = (() => {
  const src = (name) => { const i = MAIN.indexOf(`function ${name}(`); let d = 0, st = false; for (let j = MAIN.indexOf("{", i); j < MAIN.length; j += 1) { if (MAIN[j] === "{") { d += 1; st = true; } else if (MAIN[j] === "}") { d -= 1; if (st && d === 0) return MAIN.slice(i, j + 1); } } throw new Error(`${name} missing`); };
  const ctx = { L }; vm.createContext(ctx);
  vm.runInContext(`function desktopFormat(vw, vh) { const L0 = L(vw, vh, 0); return { s: L0.s, ox: L0.M, L: L0 }; }\n${src("computeHistoryPlacement")}\nglobalThis.__P = computeHistoryPlacement;`, ctx);
  return ctx.__P;
})();
check("N6 conflict boundary: a card fitted to touch the stage top is not 'reaching' it (800/900 x 900 false), a card that does reach it is (1000x900, 1100x800 true)", () => {
  // Reverting `> L.stageTop + 0.5` to `> L.stageTop` flips 800x900 / 900x900 to true (rail stageLeft - 12, overlap 412 / 323) and fails here.
  for (const [w, h, want] of [[800, 900, false], [900, 900, false], [1000, 900, true], [1100, 800, true]]) assert.equal(placement(w, h).conflict, want, `${w}x${h} conflict`);
  near(placement(800, 900).overlap, 81.9, 0.5, "800x900 fan overlap"); near(placement(900, 900).overlap, 0, 0.5, "900x900 fan overlap");
});
check("N7 PHONE boundary: History stacks only at vw <= 640 (640 stacked, 641 fan at 900 tall)", () => {
  assert.equal(placement(640, 900).mode, "stacked"); assert.equal(placement(641, 900).mode, "fan");
  for (const h of [800, 900]) for (let w = 641; w <= 1099; w += 1) assert.notEqual(placement(w, h).mode, "stacked", `${w}x${h}`);
});

// [A-1109 answer 15] Part B (ARASO_TEST_BROWSER=1): with History open, the Home and History cards share top and bottom edges (<= 1 px).
if (process.env.ARASO_TEST_BROWSER === "1") {
  const S = await import("./helpers/a831-sweep.mjs");
  const H = await S.launchHome(1440, 900);
  try {
    for (const [w, h] of [[641, 900], [800, 900], [900, 900], [1000, 900], [1100, 800], [1440, 900]]) {
      await H.p.setViewportSize({ width: w, height: h }); await S.sleep(900);
      if (await H.p.locator("#stayButton").count()) { await H.p.evaluate(() => document.querySelector("#stayButton")?.click()); await S.sleep(1200); }
      if (!(await H.openHomePaper())) throw new Error(`${w}x${h}: paper did not open`);
      await S.sleep(900);
      let idx = await H.p.evaluate(() => [...document.querySelectorAll(".homePaper__records")].findIndex((e) => e.getBoundingClientRect().width > 0));
      if (idx < 0) { await H.p.evaluate(() => document.querySelector(".homeFlap")?.click()); await S.sleep(800); idx = await H.p.evaluate(() => [...document.querySelectorAll(".homePaper__records")].findIndex((e) => e.getBoundingClientRect().width > 0)); }
      await H.p.evaluate((i) => document.querySelectorAll(".homePaper__records")[i].click(), idx);
      await S.sleep(1300);
      const r = await H.p.evaluate(() => { const b = (s) => { const x = document.querySelector(s).getBoundingClientRect(); return { t: x.top, b: x.bottom }; }; return { home: b("#homePaper"), hist: b("#recordsCardAnchor") }; });
      check(`B ${w}x${h}: Home and History cards share top / bottom edges (<= 1 px)`, () => { near(r.hist.t, r.home.t, 1, "top"); near(r.hist.b, r.home.b, 1, "bottom"); });
      await H.p.evaluate(() => document.querySelector("#recordsCardClose")?.click()); await S.sleep(900);
    }
  } finally { await H.close?.(); }
}

console.log(`\nA-1109: ${pass} PASS / ${fail} FAIL`);
if (fail) process.exitCode = 1;
