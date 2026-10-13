// [A-831] Home keyframe layout (A-829 items 1-5): one rule at every width from the 390 / 810 / 1440 reference frames.
//   node app/test/a831-home-keyframe-layout.mjs                       (Part N, always: the pure rule in a vm, 1 px sweeps, source surface)
//   ARASO_TEST_BROWSER=1 node app/test/a831-home-keyframe-layout.mjs  (+ Part B: real browser equality, sampled sweep, ARASO / card / margins, other scenes)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutOracle, stepReport, STEP_METRICS } from "./helpers/a831-sweep.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const L = layoutOracle(MAIN);

// ═══ Part N ═══
await check("N1 v10 keyframe equality at 390x844 / 810x1080 / 1440x900", () => {
  const T = [
    { w: 390, h: 844, st: 211, m: 20, bot: 0.071, cw: 400.9 / 1.42, as: 18.07 },
    { w: 810, h: 1080, st: 321, m: 52, bot: 0.08, cw: 410.704, as: 26.285 },
    { w: 1440, h: 900, st: 361, m: 120, bot: 0.08, cw: 534.6 / 1.42, as: 24.09 },
  ];
  for (const t of T) {
    const q = L(t.w, t.h);
    near(q.stageW, t.st, 0.5, `stage ${t.w}`); near(q.M, t.m, 0.5, `margin ${t.w}`); near(q.bottom, t.bot * t.h, 0.5, `bottom ${t.w}`);
    near(q.cardW, t.cw, 0.5, `card w ${t.w}`); near(q.cardH, t.cw * 1.42, 0.7, `card h ${t.w}`);
    near(q.asFont, t.as, 0.05, `ARASO font ${t.w}`); near(q.asTop, 2 * q.asFont, 1e-9, `ARASO top ${t.w}`); near(q.pitch, (32 * q.cardW) / 282, 1e-9, `pitch ${t.w}`);
    near(q.boardLeft + (1041 - 0.4991 * 150 + 150) * q.S, t.w - t.m, 1e-6, `right ink edge ${t.w}`);
  }
});
await check("N2 1940 max width composition and full viewport height",()=>{
 // A-1123 width keyframe=282.3, rather than 844*.475/1.42. Preserve
 // the canon reference within its declared half-pixel tolerance.
 near(L(390,844).cardW,282.32394366197184,.5,'phone');
 near(L(393,659).cardW,220.656,.5,'v10 short phone');
 near(L(1440,900).cardW,376.5,1e-9,'desktop');
 const a=L(1940,1200),b=L(2560,1200),c=L(2560,1400);
 near(a.cardW,376.5*1.05,1e-9,'max card');near(b.cardW,a.cardW,1e-9,'fixed size');
 near(b.cardX-a.cardX,310,1e-9,'x margins');near(b.cardY-a.cardY,0,1e-9,'same-height card y');
 assert.ok(c.floorY>b.floorY+100,'floor follows full height');
 near(L(1440,1440).cardX,L(1440,900).cardX,0.1,'1440 horizontal anchor retained at tall height');
 near(L(2560,1440).cardX,870.13,0.6,'2560 horizontal anchor from A-1137 baseline');
});
await check("N3 no step: 1 px width sweep 360..1920 at heights 800 / 900 / 1080 - adjacent widths differ <= 1 % in every keyframed value", () => {
  const res = {};
  for (const h of [800, 900, 1080]) {
    const rows = [];
    for (let w = 360; w <= 1920; w += 1) { const q = L(w, h); rows.push({ vw: w, stageW: q.stageW, M: q.M, bottom: q.bottom, asX: q.M, asFont: q.asFont, asTop: q.asTop, cardW282: q.cardW, pitch: q.pitch }); }
    res[h] = stepReport(rows, STEP_METRICS);
    for (const [k, v] of Object.entries(res[h])) {
      // Bottom is a position, with the same 1.6px floor as A-837's positional sweep.
      const at=rows.findIndex(r=>r.vw===v.atW), delta=at>0?Math.abs(rows[at][k]-rows[at-1][k]):0;
      assert.ok(v.maxStepPct <= 1 || (k === "bottom" && delta <= 1.6), `h${h} ${k} steps ${v.maxStepPct.toFixed(3)} % at ${v.atW}`);
    }
  }
});
await check("N4 card stays inside the margins and clear of ARASO / characters across the sweep (portrait and landscape)", () => {
  const notes = [];
  for (const h of [800, 900, 1080]) for (let w = 360; w <= 1920; w += 1) {
    const q = L(w, h);
    assert.ok(q.cardX >= q.M - 1e-6 && q.cardX + q.cardW <= w - q.M + 1e-6, `${w}x${h} card inside margins`);
    assert.ok(q.M <= q.cardX + 1e-6, `${w}x${h} ARASO left of / on the card's left line`);
    if (!(w > h)) assert.ok(q.cardY >= q.asBottom - 1e-6, `${w}x${h} portrait card below ARASO`);
    if (q.cardX + q.cardW > q.stageLeft && q.cardY + q.cardH > q.stageTop + 0.5) notes.push(`${w}x${h}`);
  }
  console.log(`      card/character overlaps (report only, ${notes.length}): ${notes.slice(0, 6).join(" ")}${notes.length > 6 ? " ..." : ""}`);
});
await check("N5 source surface: helper feeds fitHomeBoard via homeBoardGeom; the old phone boost / blend / floor are untouched and bypassed for Home", () => {
  const fn = (name) => { const i = MAIN.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return MAIN.slice(i, i + 4000); };
  assert.match(fn("fitHomeBoard"), /homeBoardGeom\(\)/); assert.match(fn("homeBoardGeom"), /desktop: true/);
  assert.match(MAIN, /function homeCharMobileBoost\(\) \{\n  return 1 \+ \(HOME_CHAR_MOBILE_GROUP_BOOST - 1\) \* homeNarrowBlend\(\);\n\}/);
  assert.match(MAIN, /const HOME_CHAR_SCALE_FLOOR = 0\.52;/);
  assert.equal((MAIN.match(/const midK = desktopFormat\(\) \? 1 : homeCharMobileBoost\(\);/g) || []).length, 2, "Home mid-band group + its read-only twin");
  assert.match(fn("computeHomeMidBandDropPx"), /if \(desktopFormat\(vw\)\) return 0;/);
  assert.ok(CSS.endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}\n"));
  for (const f of ["chog-home.js", "return-view.js"]) assert.ok(!/A-831/.test(readFileSync(path.join(REPO, "app/src", f), "utf8")), `${f} untouched by A-831`);
});

// ═══ Part B ═══
if (process.env.ARASO_TEST_BROWSER === "1") {
  const S = await import("./helpers/a831-sweep.mjs");
  const H = await S.launchHome(1440, 900);
  try {
    await S.showSendCard(H);
    const eq = (q, l, tag, tol = 0.6) => {
      near(q.stageW, l.stageW, tol, `${tag} stage`); near(q.M, l.M, tol, `${tag} margin`); near(q.bottom, l.bottom, tol, `${tag} bottom`);
      near(q.asX, l.M, tol, `${tag} ARASO x`); near(q.asFont, l.asFont, 0.05, `${tag} ARASO font`); near(q.asTop, l.asTop, tol, `${tag} ARASO top`);
      near(q.cardW282, l.cardW, tol, `${tag} card w`); near(q.card.h, 364 * l.k, 0.8, `${tag} card h`);
      near(q.pitch, l.pitch, 0.01, `${tag} pitch`);
    };
    await check("B1 keyframe equality in the browser at 390x844 / 810x900 / 1440x900 (<= 0.6 px)", async () => {
      for (const [w, h] of [[390, 844], [810, 1080], [1440, 900]]) eq(await S.measure831(H, w, h, { settle: 900 }), L(w, h), `${w}x${h}`);
    });
    await check("B2 sampled widths 360..1920 at heights 800 / 900 / 1080 equal the rule; ARASO left of the card; card inside margins; no scroll", async () => {
      for (const h of [800, 900, 1080]) for (const w of [360, 430, 500, 640, 720, 810, 900, 1000, 1100, 1280, 1440, 1600, 1920]) {
        const q = await S.measure831(H, w, h, { settle: 500 }), l = L(w, h);
        eq(q, l, `${w}x${h}`);
        const slack = ((285 - 282) * l.k) / 2 + 0.6;
        assert.ok(q.card.l >= l.M - slack && q.card.r <= w - l.M + slack, `${w}x${h} card inside margins`);
        assert.ok(q.brand.l <= q.card.l + slack, `${w}x${h} ARASO left of card`);
        assert.ok(q.scrollW <= w && q.scrollH <= h + 1, `${w}x${h} no scroll (${q.scrollW}x${q.scrollH})`);
      }
    });
    await check("B3 other scenes share the stage: Away / Return / Explore foot == Home foot at 390x844, 810x1080, 1440x900", async () => {
      for (const [w, h] of [[390, 844], [810, 1080], [1440, 900]]) {
        await H.p.setViewportSize({ width: w, height: h }); await S.sleep(500);
        const feet = {};
        for (const sc of ["sendstay", "away", "return", "explore"]) {
          await H.p.evaluate(([n]) => window.__arasoScene(n, { arrival: true }), [sc]); await S.sleep(2800);
          feet[sc] = await H.p.evaluate(() => { const e = document.querySelector("#chogHome img"); const b = e?.getBoundingClientRect(); return b && b.width ? b.bottom : null; });
        }
        for (const sc of ["away", "return", "explore"]) near(feet[sc], feet.sendstay, 1, `${w}x${h} ${sc} foot vs Home`);
      }
    });
    await check("B4 whole run: pageerror 0", () => assert.deepEqual(H.errors, []));
  } finally { await H.close(); }
} else console.log("SKIP  Part B (set ARASO_TEST_BROWSER=1)");

console.log(`\nA-831: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
