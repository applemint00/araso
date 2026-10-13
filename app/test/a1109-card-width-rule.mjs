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

// Owner 2026-10-13 supersedes S4's 1.33 wide cap and independent History rail.
// Keep original phone closed-card expectations; use invariant tests for the new
// coupled geometry and centred 1940 / +5% composition.
await import('./responsive-layout.mjs');
check("N1 closed phone follows A-1144 width key despite toolbar height changes",()=>{
 for(const[w,h,cw] of [[390,844,282.3],[393,659,283.217],[393,852,283.217],[430,932,294.529]])near(L(w,h).cardW,cw,.5,`${w}x${h}`);
 for(let h=659;h<900;h++)near(L(393,h+1).cardW,L(393,h).cardW,1e-9,`393x${h} height resize invariance`);
});
check("N2 desktop cap is 1940 / 1.05 with full viewport height",()=>{
 const a=L(1440,900),b=L(1940,1200),c=L(2560,1200),d=L(2560,1400);
 near(b.cardW,a.cardW*1.05,1e-9,'growth');near(c.cardW,b.cardW,1e-9,'cap');
 near(c.cardX-b.cardX,310,1e-9,'horizontal');near(c.cardY-b.cardY,0,1e-9,'same-height vertical');
 assert.ok(d.floorY>c.floorY+100,'floor follows taller viewport');
});
check("N3 existing card consumers remain connected to shared layout",()=>{
 assert.match(MAIN,/--hlCardW/);assert.match(MAIN,/cardW \/ 285/);assert.match(MAIN,/getResponsiveSolver\(\)\.history/);
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
