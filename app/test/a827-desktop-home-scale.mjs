// [A-827] Desktop Home format (A-825): ONE scale s for every Home composition length at vw >= 1100, s = 1 at 1440x900.
//   node app/test/a827-desktop-home-scale.mjs                       (Part N, always)
//   ARASO_TEST_BROWSER=1 node app/test/a827-desktop-home-scale.mjs  (+ Part B: real browser, ratio sweep on a coarse grid; the 1 px sweep is the helper's `sweep` mode)
// Part N: the s rule evaluated in a vm (reference identity, cap, short window, <1100 inactive), the CSS/JS surface is the documented one.
// Part B: 1440x900 equals the A-819/A-786 baseline values (<= 0.5 px), ratio constancy +-1 % across 1100..1600 at heights 900 and 800,
//   cap (1920x1080 / 2560x1440), short window (1440x700 / 1280x640), < 1100 untouched (1099 has no --fmtS and the 285x364 card / 32 px pitch).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
const fnSrc = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} missing`);
  let depth = 0, started = false;
  for (let j = src.indexOf("{", i); j < src.length; j += 1) {
    if (src[j] === "{") { depth += 1; started = true; } else if (src[j] === "}") { depth -= 1; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`${name} unterminated`);
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

// ═══ Part N ═══
// [A-831] re-pin: the A-827 pure-s rule is replaced by the A-829 keyframe rule (main.js homeKeyframeLayout / desktopFormat / homeBoardGeom).
//   Every superseded expectation is kept as a `// pre-A-831 baseline:` comment next to its replacement.
const fmt = () => {
  const ctx = { window: { innerWidth: 1440, innerHeight: 900 }, Math };
  vm.createContext(ctx);
  vm.runInContext([
    "const HOME_BOARD_W = 1256, HOME_BOARD_H = 772;",
    MAIN.match(/const HOME_SEAT_W = [^;]+;/)[0], MAIN.match(/const HOME_SEAT_H = [^;]+;/)[0], MAIN.match(/const HOME_CENTER = [^;]+;/)[0], MAIN.match(/const HOME_SEAT_L = [^;]+;/)[0],
    ...["HK_STAGE_W", "HK_SIDE_M", "HK_BOTTOM", "HK_CAP", "HK_PAPER_H_PER_W", "HK_CARD_REF_W", "HK_F_PORTRAIT", "HK_F_LANDSCAPE", "HK_INK_L", "HK_INK_R", "HK_INK_FOOT", "HK_INK_TOP"].map((n) => MAIN.match(new RegExp(`const ${n} = [^;]+;`))[0]),
    MAIN.match(/const hkClamp = [^;]+;/)[0], "let hkMemo = null; const resolveCssLengthVarPx = () => 0;",
    fnSrc(MAIN, "hkKey"), fnSrc(MAIN, "homeKeyframeLayout"), fnSrc(MAIN, "desktopFormat"), fnSrc(MAIN, "homeBoardGeom"),
    "globalThis.__f = { f: desktopFormat, g: homeBoardGeom, L: homeKeyframeLayout };",
  ].join("\n"), ctx);
  return ctx.__f;
};

await check("N1 keyframes: at 390x844 / 810x1080 / 1440x900 stage 211/321/361, margin 20/52/120, bottom 7.1/8/8 % of vh (<= 0.5 px); k = card w / 282", () => {
  // pre-A-831 baseline: s = 1 and ox = 0 at 1440x900; s = vw/1440 inside 1100..1915 at tall-enough heights
  const { L } = fmt();
  for (const [w, h, st, m, b] of [[390, 844, 211, 20, 0.071], [810, 1080, 321, 52, 0.08], [1440, 900, 361, 120, 0.08]]) {
    const q = L(w, h); near(q.stageW, st, 0.5, `stage ${w}`); near(q.M, m, 0.5, `margin ${w}`); near(q.bottom, b * h, 0.5, `bottom ${w}`); near(q.k, q.cardW / 282, 1e-12, `k ${w}`);
  }
  near(L(1440, 900).cardW, 376.5, 0.5, "card w 1440x900"); near(L(1440, 900).cardH, 534.6, 0.5, "card h 1440x900");
  near(L(810, 1080).cardH, 583.2, 0.5, "card h 810x1080"); near(L(390, 844).cardH, 400.9, 0.5, "card h 390x844");
  const q = L(1440, 900); near(q.asFont, q.cardW * 0.064, 1e-9, "ARASO font"); near(q.asTop, 2 * q.asFont, 1e-9, "ARASO top"); near(q.pitch, (32 * q.cardW) / 282, 1e-9, "pitch");
});

await check("N2 S4 cap: 1920 reaches 1.33; above it the whole composition freezes and centres", () => {
  const { L } = fmt();
  // pre-A-831 baseline: s stops at 1.33 and the reference frame centres horizontally (ox = (vw - 1440 s) / 2)
  for (const [w, h] of [[1920, 1080], [2560, 1440]]) {
    const q = L(w, h), ox = Math.max(0, (w - 1920) / 2);
    near(q.stageW, 361 * 1.33, 1e-9, `stage ${w}`); near(q.M, ox + 120 * 1.33, 1e-9, `margin ${w}`); near(q.bottom, 0.08 * h, 1e-9, `bottom ${w}`);
    // pre-A-1109: card kept the uncapped height rule.
    near(q.cardW, 376.5 * 1.33, 1e-9, `card ${w} = S4 max width`);
  }
  near(L(1920, 1080).cardW, 500.745, 1e-9, "1920x1080 card = 376.5 x 1.33");
});

await check("N3 short window: S4 compresses vertical gaps first and only then caps width; stage + margins do not depend on vh", () => {
  const { L } = fmt();
  // pre-A-831 baseline: assert.equal(f(1440, 700).s, 1); assert.equal(f(1280, 640).s, 1280 / 1440); near(f(1440, 500).s, 500 / 612, 1e-12, "height-limited");
  const q = L(1440, 700); near(q.cardW, 376.5, 1e-9, "1440x700 width key"); near(q.stageW, 361, 1e-9, "stage"); near(q.cardY, 87.5, 0.01, "card top = 12.5 % vh");
  // pre-A-1109: 1280x640 cardH = 640 x .594.
  // pre-A-1109(answer 11): 375.3974674271362 (Send box only); the open Home paper now also stays above the floor line.
  near(L(1280, 640).cardW, 358.3169014084507, 1e-9, "1280x640 after floor-line cap (paper + Send box)");
});

await check("N4 the format is active at every width (no 1100 gate); the board is the keyframe stage, shared by Away / Return / Second", () => {
  const { f, g } = fmt();
  // pre-A-831 baseline: assert.equal(f(1099, 900), null); assert.equal(f(700, 900), null); q.desktop === false, S = min(vw/1256, vh/772)
  for (const [w, h] of [[360, 800], [390, 844], [700, 900], [1099, 900]]) { assert.ok(f(w, h), `active at ${w}`); const q = g(w, h); assert.equal(q.desktop, true); assert.ok(q.S >= 0.52, `S >= .52 at ${w} (floor group never engages)`); }
});

await check("N5 board geometry: the group's right ink edge sits on vw - margin and its foot ink on vh - bottom margin at 390 / 810 / 1440", () => {
  const { g, L } = fmt();
  // pre-A-831 baseline: S = 1440/1256, left 0, top (900 - 772 S)/2 at 1440x900; board bottom gap = reference x s
  for (const [w, h] of [[390, 844], [810, 1080], [1440, 900], [1000, 700]]) {
    const q = g(w, h), l = L(w, h), seatR = 1041 - 0.4991 * 150 + 150;
    near(q.left + seatR * q.S, w - l.M, 1e-6, `right ink edge ${w}`); near(q.top + 648.29 * q.S, h - l.bottom, 1e-6, `foot ink ${w}`);
    near((seatR - 844.76) * q.S, l.stageW, 1e-6, `stage width ${w}`);
  }
});

await check("N6 CSS surface: Home-only, every rule reads --fmtS / --hl*; no media query; the last-block pin (a744 A6) still holds", () => {
  const i = CSS.indexOf("[A-831 · A-829 KEYFRAME LAYOUT]");
  assert.ok(i > 0, "block present");
  // pre-A-831 baseline: CSS.indexOf("[A-827 · A-825 DESKTOP FORMAT]") + assert.match(blk, /@media \(min-width: 1100px\)/)
  const blk = CSS.slice(i, CSS.indexOf("/* [A-786 HOME SCALE", i)); // [A-831] the block now sits before the A-786 block (a744 A5 scans text after every min-width:641px media for ".cardAnchor {")
  assert.ok(!/@media/.test(blk), "no media gate");
  for (const sel of [".arasoBrand", ".cardAnchor", ".cardAnchor .sendCard", ".recordsCard", ".homePaper", "body:has(.stage[data-scene=\"sendstay\"])"]) assert.ok(blk.includes(sel), sel);
  assert.equal((blk.match(/data-scene="sendstay"/g) || []).length >= 5, true);
  // pre-A-831 baseline: top: calc(32px * var(--fmtS, 1)) / font-size: calc(12px * var(--fmtS, 1))
  assert.match(blk, /top: calc\(var\(--hlAsTop, 32px\) \+ var\(--hk-safe-top, 0px\)\)/); assert.match(blk, /font-size: var\(--hlAsFont, 12px\)/); assert.match(blk, /left: var\(--hlM, 140px\)/);
  assert.match(blk, /background-size: 100% calc\(32px \* var\(--fmtS, 1\)\)/);
  assert.ok(CSS.endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}\n"));
});

await check("N7 JS surface: one format function drives fitHomeBoard / mid-band drop / canvases / card shrink / records gap; nothing below 1100 changed in the drop gate", () => {
  assert.match(fnSrc(MAIN, "fitHomeBoard"), /homeBoardGeom\(\)/);
  assert.match(fnSrc(MAIN, "computeHomeMidBandDropPx"), /if \(desktopFormat\(vw\)\) return 0;/);
  assert.match(fnSrc(MAIN, "fitCardAnchor"), /if \(desktopFormat\(\)\)/);
  assert.match(fnSrc(MAIN, "applyHomeFloorToDepartCanvas"), /applyDesktopBoardToCanvas\(canvas\)/);
  assert.match(MAIN, /if \(applyDesktopBoardToCanvas\(canvas\)\) return; \/\/ \[A-827\] desktop: same board box as #homeBoard/);
  // pre-A-833 baseline: assert.match(fnSrc(MAIN, "computeHistoryFitMode"), /fmtLen\(RECORDS_CARD_GAP\)/);  (gap 24 x s now lives in computeHistoryPlacement)
  assert.match(fnSrc(MAIN, "computeHistoryPlacement"), /const gap = 24 \* L\.k;/);
  assert.match(fnSrc(MAIN, "computeHistoryFitMode"), /computeHistoryPlacement\(\)/);
  assert.match(fnSrc(MAIN, "syncDesktopFormatVars"), /--fmtS/);
  for (const f of ["chog-home.js", "return-view.js"]) assert.ok(!/A-827/.test(readFileSync(path.join(REPO, "app/src", f), "utf8")), `${f} untouched`);
});

// ═══ Part B ═══
if (process.env.ARASO_TEST_BROWSER === "1") {
  const S = await import("./helpers/a827-sweep.mjs");
  const H = await S.launchHome(1440, 900);
  try {
    await S.showSendCard(H);
    const OR = fmt().L(1440, 900); // [A-831] oracle = the keyframe rule (homeKeyframeLayout), evaluated in a vm
    const m = await S.measure(H, 1440, 900, { resize: false });
    const expect = (q, L, tag) => {
      near(q.piggy.r, L.vw - L.M, 0.6, `${tag} Piggy right edge = vw - margin`); near(q.piggyFoot, L.floorY, 0.6, `${tag} foot = vh - bottom margin`);
      near(q.brand.l, L.M, 0.6, `${tag} brand x`); near(q.brandFont, L.asFont, 0.05, `${tag} brand font`); near(q.brandY, L.asTop, 0.6, `${tag} brand y`);
      near(q.card.w, 285 * L.k, 0.6, `${tag} card w`); near(q.card.h, 364 * L.k, 0.6, `${tag} card h`);
      near((q.card.l + q.card.r) / 2, L.cx, 0.6, `${tag} card cx`); near((q.card.t + q.card.b) / 2, L.cy, 0.6, `${tag} card cy`);
      near(q.linePitch, L.pitch, 0.01, `${tag} pitch`);
    };
    await check("B1 1440x900 = the A-829 keyframe: stage 361 / margin 120 / bottom 72, ARASO (120, 48.2) 24.1 px, card k = 1.335 centred in the card zone, pitch 42.7", () => {
      // pre-A-831 baseline (all of it): Piggy 172.0 wide / foot 750.7 / cx 1193.7, Chog 154.5 / foot 771.6, brand (140,32) 12 px, card 285x364 centred (688,402), pitch 32
      expect(m, OR, "1440x900");
      near(m.piggy.r - m.chog.l, 361 + 28.4 * OR.S / OR.S, 40, "group box width ~ stage (box, not ink)");
      near(m.chogFoot - m.piggyFoot, 18.21 * OR.S, 0.6, "Chog box foot vs Piggy foot (same group scale)");
    });
    for (const h of [900, 800]) {
      const rows = [];
      for (const w of [390, 640, 810, 1100, 1200, 1280, 1360, 1440, 1520, 1600, 1920]) rows.push(await S.measure(H, w, h, { settle: 700 }));
      await check(`B2 [h=${h}] every sampled width equals the keyframe rule (<= 0.6 px) and the card stays inside the side margins`, () => {
        // pre-A-831 baseline: ratios (metric / vw) constant +-1 % across 1100..1600 (S.ratios, RATIO_METRICS minus paperW)
        for (const q of rows) { const L = fmt().L(q.vw, h); expect(q, L, `${q.vw}x${h}`); const box = ((285 - 282) * L.k) / 2 + 0.6; /* First Send box is 285 wide, the Home paper 282: same centre */ assert.ok(q.card.l >= L.M - box && q.card.r <= q.vw - L.M + box, `${q.vw} card inside margins`); assert.ok(q.scrollW <= q.vw && q.scrollH <= h + 1, "no scroll"); }
      });
    }
    await check("B3 cap: 1920x1080 and 2560x1440 follow min(vw/1440, 1.33): stage / margin x 1.33 at 2560, card <= its 1440x900 value x factor", async () => {
      // pre-A-831 baseline: card 285 x 1.33, brand x (w - 1440*1.33)/2 + 140*1.33, pitch 32*1.33
      for (const [w, h] of [[1920, 1080], [2560, 1440]]) {
        const q = await S.measure(H, w, h, { settle: 900 }); const L = fmt().L(w, h);
        expect(q, L, `${w}x${h}`); /* card = height rule, checked by expect() */
      }
    });
    await check("B4 short window: 1440x700 and 1280x640 follow the rule (card h = 0.594 vh, top 12.5 % vh), characters + card inside the viewport, card clears the wordmark", async () => {
      // pre-A-831 baseline: card w = 285 x (w/1440) (A-827 short-window s)
      for (const [w, h] of [[1440, 700], [1280, 640]]) {
        const q = await S.measure(H, w, h, { settle: 900 }); const L = fmt().L(w, h);
        expect(q, L, `${w}x${h}`);
        assert.ok(q.card.t >= q.brand.b + 1, `card top ${q.card.t} clears brand bottom ${q.brand.b}`);
        assert.ok(q.piggy.b <= h && q.chog.b <= h && q.piggy.t >= 0, "characters inside");
        assert.ok(q.scrollH <= h + 1, "no vertical scroll");
      }
    });
    await check("B5 below 1100 follows the same rule (no gate): 1099x900 has --fmtS = k, card 285 k, ARASO font card x .064, pitch 32 k", async () => {
      // pre-A-831 baseline: assert.equal(q.fmtS, null); card 285x364, brand 12 px at x 140, pitch 32
      const q = await S.measure(H, 1099, 900, { settle: 900 }); const L = fmt().L(1099, 900);
      near(Number(q.fmtS), L.k, 1e-6, "fmtS"); expect(q, L, "1099x900");
    });
    // [fix R2 · Owner decision B 2026-10-07] shared scenes follow the desktop board: Away / Return / Explore (Second) foot == Home foot.
    await check("B7 Chog foot per scene at 1180x820, 1280x800, 1440x800, 1600x900: Away / Return / Explore == Home (<= 1 px)", async () => {
      const rows = [];
      for (const [w, h] of [[1180, 820], [1280, 800], [1440, 800], [1600, 900]]) {
        await H.p.setViewportSize({ width: w, height: h }); await S.sleep(500);
        const feet = {};
        for (const sc of ["sendstay", "away", "return", "explore"]) {
          await H.p.evaluate(([n]) => window.__arasoScene(n, { arrival: true }), [sc]); await S.sleep(2800);
          feet[sc] = await H.p.evaluate(() => { const e = document.querySelector("#chogHome img"); const b = e?.getBoundingClientRect(); return b && b.width ? b.bottom : null; });
        }
        rows.push(`${w}x${h} ${JSON.stringify(feet)}`);
        for (const sc of ["away", "return", "explore"]) near(feet[sc], feet.sendstay, 1, `${w}x${h} ${sc} foot vs Home`);
      }
      console.log(rows.map((x) => "      " + x).join("\n"));
    });
    await check("B6 whole run: pageerror 0", () => assert.deepEqual(H.errors, []));
  } finally { await H.close(); }
} else console.log("SKIP  Part B (set ARASO_TEST_BROWSER=1)");

console.log(`\nA-827: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
