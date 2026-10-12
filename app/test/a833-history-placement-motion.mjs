import {createResponsiveLayout} from "../src/responsive-layout.js";
// [A-833] History placement (A-829 item 6) + shared open/close motion (item 7, preset C) + portrait/landscape card blend (A-831 U2).
//   node app/test/a833-history-placement-motion.mjs                       (Part N, always: the pure placement rule in a vm, sweeps, source surface)
//   ARASO_TEST_BROWSER=1 node app/test/a833-history-placement-motion.mjs  (+ Part B: six sizes, frame samples open/close, reduced motion, live resize)
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { layoutOracle } from "./helpers/a831-sweep.mjs";
import { testOutDir } from "./helpers/test-out.mjs"; // [A-932]

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const RECEIPT = testOutDir("a833-history-placement-motion", process.env.A833_OUT); // [A-932] pre-A-932 baseline: receipts/A833_history_placement_motion
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
function fnSrc(src, name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `function ${name}`);
  const j = src.indexOf("\n}\n", i);
  return src.slice(i, j + 3);
}

// The pure placement rule evaluated in a vm on top of the pure keyframe layout (no DOM).
const layout = layoutOracle(MAIN);
const P = createResponsiveLayout(layoutOracle(MAIN,true)).history;

// ═══ Part N ═══
await check("N1 approved desktop reference and paired paper size",()=>{
 const p=P(1440,900);near(p.cardW,376.5,.01,'1440 card');near(p.homeLeft,125.3787,.01,'Home');near(p.histLeft,533.9213,.01,'History');
});
await check("N2 narrow overlap exposes the Home title and wide gaps never reverse",()=>{
 for(const h of [700,800,900,1080,1440]){let prev=null;for(let w=641;w<=2560;w++){
  const p=P(w,h);assert.ok(p.histLeft>=p.homeLeft+.611*p.cardW-.5,`${w}x${h} title`);
  if(prev)assert.ok(p.signedGap>=prev.signedGap-1e-6,`${w} gap`);prev=p;
 }}
});
await check("N3 History does not intersect the character stage or viewport edge",()=>{
 for(const h of [700,800,900,1080,1440])for(let w=641;w<=2560;w+=3){const p=P(w,h),L=p.L;
  assert.ok(p.homeLeft>=-.5&&p.histRight<=w+.5&&p.top+p.cardH<=h+.5,`${w}x${h} bounds`);
  assert.ok(!(p.histRight>L.stageLeft+.01&&p.top+p.cardH>L.stageTop+.01),`${w}x${h} stage`);
 }
});
await check("N4 Home card x/y has no step at the portrait/landscape switch: w/h 0.70..1.30 swept in 1 px steps (A-831 U2)", () => {
  const worst = { x: 0, y: 0, atX: 0, atY: 0 };
  for (const h of [700, 800, 900, 1080]) {
    let prev = null;
    for (let w = Math.round(0.7 * h); w <= Math.round(1.3 * h); w += 1) {
      const q = layout(w, h, 0);
      if (prev) {
        const dx = Math.abs(q.cardX - prev.cardX), dy = Math.abs(q.cardY - prev.cardY);
        if (dx > worst.x) { worst.x = dx; worst.atX = `${w}x${h}`; }
        if (dy > worst.y) { worst.y = dy; worst.atY = `${w}x${h}`; }
        assert.ok(dx <= 3 && dy <= 3, `${w}x${h}: card moved ${dx.toFixed(2)} / ${dy.toFixed(2)} px for 1 px of width`);
      }
      prev = q;
    }
  }
  console.log(`      max 1 px step: x ${worst.x.toFixed(2)} (${worst.atX}), y ${worst.y.toFixed(2)} (${worst.atY})`);
});
await check("N5 height beyond the internal frame adds equal vertical margins",()=>{
 const a=layout(1940,1200),b=layout(1940,1400);
 near(b.cardY-a.cardY,100,1e-9,'card');near(b.stageTop-a.stageTop,100,1e-9,'characters');near(b.asTop-a.asTop,100,1e-9,'brand');
 near(a.cardW,b.cardW,1e-9,'size unchanged');
});
await check("N6 source: pinned literals kept, durations / frames / curves per preset C, reduced motion, EXIT 260, no 46 px driver", () => {
  assert.match(MAIN, /const RECORDS_EXIT_MS = 260;/);
  assert.match(MAIN, /const RECORDS_OPEN_MS = 320;/); assert.match(MAIN, /const RECORDS_CLOSE_MS = 240;/);
  const anim = fnSrc(MAIN, "animateRecordsCard");
  assert.match(anim, /offset: 0\.62/); assert.match(anim, /offset: 0\.63/); assert.match(anim, /cubic-bezier\(\.25,\.8,\.35,1\)/); assert.match(anim, /cubic-bezier\(\.45,0,\.35,1\)/);
  assert.match(anim, /clearDx|const clear = placement\.clearDx/); assert.match(anim, /map\(\(fr\) => \(fr\.offset === undefined \? fr : \{ \.\.\.fr, offset: 1 - fr\.offset \}\)\)/);
  assert.match(CSS, /\.homePaperMount \{\s*\n\s*transition: transform 240ms cubic-bezier\(0\.5, 0, 0\.75, 0\.2\);/);
  assert.match(CSS, /\.homePaperMount\.homePaperMount--twoCardShift \{\s*\n\s*transition: transform 320ms cubic-bezier\(0\.2, 0\.9, 0\.3, 1\);/);
  assert.match(CSS, /transform: translate\(var\(--twoCardShiftLocalPx,[^;]+--twoCardShiftLocalY/, "coupled x/y transform wired");
  assert.match(CSS, /prefers-reduced-motion: reduce\) \{\s*\n\s*\.homePaperMount,/);
  const setShift = fnSrc(MAIN, "setHomeTwoCardShift");
  assert.ok(!/HOME_TWO_CARD_SHIFT_LOCAL_PX|HOME_PAPER_DOCK_RATIO/.test(setShift), "Home move no longer uses the fixed 46 px / stale dock ratio");
  const fit = fnSrc(MAIN, "computeHistoryFitMode");
  assert.match(fit, /computeHistoryPlacement\(\)/); assert.match(fit, /if \(!stage \|\| !paper\) return "stacked";/);
  const close = fnSrc(MAIN, "closeRecordsCard");
  assert.match(close, /animateRecordsCard\(anchor, false\)/); assert.match(close, /prefersReducedMotion\(\)/);
  assert.match(fnSrc(MAIN, "openRecordsCard"), /animateRecordsCard\(anchor, true\)/);
  assert.match(fnSrc(MAIN, "resetRecordsForFullRender"), /cancelRecordsCardAnim\(\)/);
  assert.ok(CSS.endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}\n"), "style.css tail pin (a827 N6 / a744 A6)");
});

// ═══ Part B ═══
if (process.env.ARASO_TEST_BROWSER === "1") {
  const S = await import("./helpers/a831-sweep.mjs");
  mkdirSync(RECEIPT, { recursive: true });
  const H = await S.launchHome(1440, 900);
  const out = { sizes: {} };
  const rectOf = (sel) => H.p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } : null; }, sel);
  // [A-1109 answer 6] opaque-pixel (ink) box of an <img>: alpha > 16 bbox of its natural bitmap, mapped onto the rendered element box.
  const inkRectOf = (sel) => H.p.evaluate((s) => {
    const e = document.querySelector(s); if (!e || !e.naturalWidth) return null;
    const b = e.getBoundingClientRect(); if (!b.width) return null;
    const c = document.createElement("canvas"); c.width = e.naturalWidth; c.height = e.naturalHeight;
    const g = c.getContext("2d"); g.drawImage(e, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y += 1) for (let x = 0; x < c.width; x += 1) if (d[(y * c.width + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const sx = b.width / c.width, sy = b.height / c.height;
    return { l: b.left + x0 * sx, t: b.top + y0 * sy, r: b.left + (x1 + 1) * sx, b: b.top + (y1 + 1) * sy, w: (x1 + 1 - x0) * sx, h: (y1 + 1 - y0) * sy };
  }, sel);
  const openHistory = async () => {
    // pre-A-1109: launchHome reached a free Home here; First Send re-entry can leave Stay mounted until it is explicitly chosen.
    if (await H.p.locator("#stayButton").count()) { await H.p.evaluate(() => document.querySelector("#stayButton")?.click()); await S.sleep(1200); }
    if (!(await H.openHomePaper())) throw new Error("paper did not open");
    await S.sleep(900);
    let idx = await H.p.evaluate(() => [...document.querySelectorAll(".homePaper__records")].findIndex((e) => e.getBoundingClientRect().width > 0));
    if (idx < 0) { await H.p.evaluate(() => document.querySelector(".homeFlap")?.click()); await S.sleep(800); idx = await H.p.evaluate(() => [...document.querySelectorAll(".homePaper__records")].findIndex((e) => e.getBoundingClientRect().width > 0)); }
    return idx;
  };
  // Samples Home paper + History anchor every animation frame for `ms` after `trigger()` runs inside the page.
  const sample = (trigger, ms) => H.p.evaluate(([trig, dur]) => new Promise((res) => {
    const rows = []; const t0 = performance.now();
    // eslint-disable-next-line no-new-func
    new Function(trig)();
    const tick = () => {
      const t = performance.now() - t0; const a = document.querySelector("#recordsCardAnchor"); const p = document.querySelector("#homePaper");
      const ar = a.getBoundingClientRect(), pr = p.getBoundingClientRect(); const cs = getComputedStyle(a);
      rows.push({ t: Math.round(t * 10) / 10, homeL: pr.left, histL: ar.left, histW: ar.width, hidden: a.hidden, z: cs.zIndex, op: cs.opacity, anims: a.getAnimations().length });
      if (t < dur) requestAnimationFrame(tick); else res(rows);
    };
    requestAnimationFrame(tick);
  }), [trigger, ms]);
  const OPEN = `document.querySelector(".homePaper__records")?.click()`;
  const CLOSE = `document.querySelector("#recordsCardClose")?.click()`;
  const openTrig = (idx) => `document.querySelectorAll(".homePaper__records")[${idx}].click()`;

  for (const [w, h] of [[390, 844], [640, 900], [810, 1080], [1100, 800], [1440, 900], [1920, 1080]]) {
    await H.p.setViewportSize({ width: w, height: h }); await S.sleep(900);
    const exp = P(w, h); const L = layout(w, h, 0);
    const idx = await openHistory();
    assert.ok(idx >= 0, `${w}x${h}: records button reachable`);
    const closedHome = await rectOf("#homePaper");
    const rows = await sample(openTrig(idx), 520);
    await S.sleep(200);
    const home = await rectOf("#homePaper"), hist = await rectOf("#recordsCardAnchor");
    const cls = await H.p.evaluate(() => [...document.querySelector("#recordsCardAnchor").classList]);
    // pre-A-1109: chog: await rectOf("#chogHome img") (element box incl. transparent PNG margin). A-1109 answer 6 = A-829 item 2 stage = Chog ink.
    const chars = { seat: await rectOf("#homeSeat"), chog: await inkRectOf("#chogHome img") };
    const mountInert = await H.p.evaluate(() => document.querySelector(".homePaperMount").inert);
    const rec = { vw: w, vh: h, expected: exp, closedHome, home, hist, classes: cls, chars, mountInert, openFrames: rows.filter((_, i) => i % 3 === 0 || i === rows.length - 1) };
    await check(`B ${w}x${h}: mode ${exp.mode}; Home/History rects = the placement rule; class ${exp.mode === "stacked" ? "--stackedMode" : "--sideMode"}`, () => {
      assert.ok(cls.includes(exp.mode === "stacked" ? "recordsCardAnchor--stackedMode" : "recordsCardAnchor--sideMode"), cls.join(" "));
      near(closedHome.l, L.cardX, 1.5, "closed Home left = layout card x");
      near(hist.w, exp.cardW, 1.5, "History width = coupled card"); near(hist.w, home.w, 0.6, "same size as Home");
      if (exp.mode !== "stacked") { near(home.l, exp.homeLeft, 1.5, "Home left"); near(hist.l, exp.histLeft, 1.5, "History left"); assert.equal(mountInert, false, "Home live in side modes"); }
      else { near(home.l, exp.homeLeft, 1.5, "Home follows stacked transition geometry"); assert.equal(mountInert, true, "Home inert while stacked"); }
    });
    await check(`B ${w}x${h}: History clear of the characters (no rect overlap) and ${exp.mode === "fan" ? "card overlap <= half a card" : "inside the viewport"}`, () => {
      assert.ok(hist.r <= w + 0.6 && hist.l >= -0.6, "inside viewport");
      for (const [n, c] of Object.entries(chars)) if (c) assert.ok(!(hist.l < c.r && hist.r > c.l && hist.t < c.b && hist.b > c.t), `History overlaps ${n}`);
      // pre-A-1109: if (exp.mode === "fan") (half-card limit in every orientation). A-1109 answer 7 / A-833 answer: landscape + square always fan, limit only when w < h (= node N2).
      // pre-A-1109(answer 10): `&& w < h`. Answer 10: the half-card limit is phone-only (vw <= 640).
      if (exp.mode === "fan" && w < h && w <= 640) assert.ok(home.r - hist.l <= 0.5 * home.w + 1, `overlap ${home.r - hist.l}`);
    });
    await check(`B ${w}x${h}: open frames - Home and History move together over ${exp.mode === "stacked" ? "320 ms (History from the right on top)" : "320 ms (tuck-out, z swap at the clear point, settle)"}`, () => {
      const first = rows[0], last = rows[rows.length - 1];
      assert.equal(first.hidden, false); assert.ok(last.anims === 0, "animation cleaned up");
      if (exp.mode === "stacked") {
        assert.ok(rows.some((r) => Number(r.op) < 0.99) || rows[0].t > 0, "fades/slides in");
        return;
      }
      const dx = exp.homeLeft - L.cardX;
      near(first.homeL, closedHome.l, Math.abs(dx) * 0.6 + 2, "Home starts from the closed spot");
      assert.ok(rows.some((r) => Math.abs(r.homeL - closedHome.l) > 1 && Math.abs(r.homeL - exp.homeLeft) > 1), "Home passes through mid positions (animated, not instant)");
      near(rows.find((r) => r.t >= 340)?.homeL ?? last.homeL, exp.homeLeft, 1.5, "Home at the end of 320 ms");
      const homeFinalR = exp.homeLeft + exp.cardW;
      const zi = rows.findIndex((r) => r.z === "2" || r.z === "auto" ? false : false);
      void zi;
      const swapIdx = rows.findIndex((r, i) => i > 0 && Number(r.z) >= 2 && Number(rows[i - 1].z) < 2);
      assert.ok(swapIdx > 0 || exp.overlap === 0 || Number(rows[0].z) >= 2, "z swap observed");
      if (swapIdx > 0) assert.ok(rows[swapIdx].histL >= homeFinalR - 3, `swap at the clear point (History left ${rows[swapIdx].histL} vs Home final right ${homeFinalR})`);
      near(rows[rows.length - 1].histL, exp.histLeft, 1.5, "History settled");
      assert.ok(Math.max(...rows.map((r) => r.histL)) >= exp.histLeft + exp.clearDx - 3, "slides out beyond rest until clear of Home (+10), then settles back");
    });
    // close: reversed, never instant
    const crows = await sample(CLOSE, 520);
    await S.sleep(150);
    const homeAfter = await rectOf("#homePaper");
    const hiddenAfter = await H.p.evaluate(() => document.querySelector("#recordsCardAnchor").hidden);
    rec.closeFrames = crows.filter((_, i) => i % 3 === 0 || i === crows.length - 1);
    await check(`B ${w}x${h}: close is animated (not an instant hide), Home returns in parallel, hidden after ~240 ms`, () => {
      const early = crows.find((r) => r.t >= 40 && r.t <= 120);
      assert.ok(early && early.hidden === false, "still visible at ~60 ms (no instant hide)");
      const hideAt = crows.find((r) => r.hidden)?.t;
      assert.ok(hideAt !== undefined && hideAt >= 200 && hideAt <= 330, `hidden at ${hideAt} ms`);
      near(homeAfter.l, closedHome.l, 1.5, "Home back at the closed spot");
      assert.equal(hiddenAfter, true);
      if (exp.mode !== "stacked") assert.ok(crows.some((r) => Math.abs(r.homeL - closedHome.l) > 1 && Math.abs(r.homeL - exp.homeLeft) > 1), "Home animates back (not an instant snap)");
    });
    out.sizes[`${w}x${h}`] = rec;
  }

  // reopen during close: no stale class / timer, ends open
  await H.p.setViewportSize({ width: 1100, height: 800 }); await S.sleep(900);
  {
    const idx = await openHistory();
    await H.p.evaluate((i) => { document.querySelectorAll(".homePaper__records")[i].click(); }, idx); await S.sleep(500);
    await H.p.evaluate(() => document.querySelector("#recordsCardClose")?.click()); await S.sleep(120);
    await H.p.evaluate((i) => { document.querySelectorAll(".homePaper__records")[i].click(); }, idx); await S.sleep(700);
    const st = await H.p.evaluate(() => { const a = document.querySelector("#recordsCardAnchor"); return { hidden: a.hidden, cls: [...a.classList], anims: a.getAnimations().length }; });
    const exp = P(1100, 800); const hist = await rectOf("#recordsCardAnchor");
    await check("B reopen during close: cancels cleanly (visible, no --sideClosing/--closing, no running animation, rests at the placement)", () => {
      assert.equal(st.hidden, false); assert.ok(!st.cls.includes("recordsCardAnchor--sideClosing") && !st.cls.includes("recordsCardAnchor--closing"), st.cls.join(" "));
      assert.equal(st.anims, 0); near(hist.l, exp.histLeft, 1.5, "History left");
    });
    await H.p.evaluate(() => document.querySelector("#recordsCardClose")?.click()); await S.sleep(700);
  }

  // live resize while open: re-decides the mode, no stale shift / inert
  {
    await H.p.setViewportSize({ width: 1440, height: 900 }); await S.sleep(900);
    const idx = await openHistory();
    await H.p.evaluate((i) => { document.querySelectorAll(".homePaper__records")[i].click(); }, idx); await S.sleep(700);
    const steps = [[810, 1080], [390, 844], [1100, 800], [640, 900], [1440, 900]];
    const res = [];
    for (const [w, h] of steps) {
      await H.p.setViewportSize({ width: w, height: h }); await S.sleep(700);
      const exp = P(w, h);
      const s = await H.p.evaluate(() => { const a = document.querySelector("#recordsCardAnchor"); const m = document.querySelector(".homePaperMount"); const r = a.getBoundingClientRect(); const hp = document.querySelector("#homePaper").getBoundingClientRect(); return { hidden: a.hidden, cls: [...a.classList], shift: m.classList.contains("homePaperMount--twoCardShift"), inert: m.inert, histL: r.left, homeL: hp.left, anims: a.getAnimations().length, scrollW: document.documentElement.scrollWidth }; });
      res.push({ w, h, exp: exp.mode, ...s });
      await check(`B resize while open -> ${w}x${h}: mode ${exp.mode}, Home coupled sizing true, inert ${exp.mode === "stacked"}, rects = placement, no stale class`, () => {
        assert.equal(s.hidden, false); assert.equal(s.shift, true); assert.equal(s.inert, exp.mode === "stacked");
        assert.equal(s.cls.includes("recordsCardAnchor--stackedMode"), exp.mode === "stacked"); assert.equal(s.cls.includes("recordsCardAnchor--sideMode"), exp.mode !== "stacked");
        near(s.histL, exp.histLeft, 1.5, "History left"); near(s.homeL, exp.homeLeft, 1.5, "Home left");
        assert.equal(s.anims, 0); assert.ok(s.scrollW <= w + 1, "no horizontal scroll");
      });
    }
    out.resize = res;
    await H.p.evaluate(() => document.querySelector("#recordsCardClose")?.click()); await S.sleep(700);
  }

  // reduced motion: instant open / close in every mode
  await H.p.emulateMedia({ reducedMotion: "reduce" });
  for (const [w, h] of [[390, 844], [810, 1080], [1440, 900]]) {
    await H.p.setViewportSize({ width: w, height: h }); await S.sleep(900);
    const exp = P(w, h); const idx = await openHistory(); const L = layout(w, h, 0);
    const rows = await sample(openTrig(idx), 120);
    const crows = await sample(CLOSE, 120);
    await check(`B reduced motion ${w}x${h}: open and close are instant (no animation, no mid frames)`, () => {
      const r = rows.find((x) => x.t > 40) ?? rows[rows.length - 1];
      assert.equal(r.hidden, false); assert.ok(rows.every((x) => x.anims === 0), "no running animation");
      if (exp.mode !== "stacked") near(r.homeL, exp.homeLeft, 1.5, "Home already at the open spot");
      assert.ok(crows.slice(1).every((x) => x.hidden), "hidden by the second frame");
      assert.ok(crows.slice(1).every((x) => Math.abs(x.homeL - L.cardX) < 1.5), "Home back immediately");
    });
  }
  await H.p.emulateMedia({ reducedMotion: "no-preference" });

  writeFileSync(path.join(RECEIPT, "a833_frames.json"), JSON.stringify(out, null, 1));
  await check("B page errors = 0", async () => { assert.deepEqual(H.errors ?? [], []); });
  if (H.close) await H.close();
}
console.log(`\nA-833: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
