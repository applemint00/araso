// [A-819] UI Wave 1 — responsive composition foundation (UI-14 Home / UI-10 Name / UI-17 Return Receipt / UI-22 Second work Piggy / UI-03 Invite).
//   node app/test/a819-responsive-composition-wave1.mjs                        (Part N only, always)
//   ARASO_TEST_BROWSER=1 node app/test/a819-responsive-composition-wave1.mjs   (+ Part B: real browser, a172-local vite on a free port)
//
// Governing rule: A-815 Responsive Composition Rule (94_VISUAL_DIRECTION §A-815): composition switches only at family boundaries,
// fluid inside a family, parent-stage sizing, no per-viewport magic offsets. Review indicator used throughout (NOT an Owner canon
// number): a 1 css-px width change must not move a measured visual size by more than 2 %.
//
// Part N (node): source contracts (new stage-level weights exist and are the ONLY inputs; forbidden surfaces untouched; the older
//   <=640 contracts that other tests pin are still textually present), plus pure-function continuity of the family weights / foot
//   target evaluated in a vm, plus the invite timeline carry on a fake DOM.
// Part B (browser): measured boundary matrix for all five items + representative matrix (390/430/700/1024/1180/1440).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { layoutOracle } from "./helpers/a831-sweep.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const rd = (p) => readFileSync(path.join(REPO, p), "utf8");
const MAIN = rd("app/src/main.js");
const PRET = rd("app/src/piggy-return.js");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
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
const sha = (s) => createHash("sha256").update(s).digest("hex");
const RECEIPTS = path.join(REPO, "_private/ops/receipts/A819_ui_wave1_responsive");

// ═══ Part N ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
await check("N1 read-only files stay byte-identical to the card's BEFORE hash (chog-home.js, return-view.js) — skipped when the private receipt is absent", () => {
  const f = path.join(RECEIPTS, "HASH_BEFORE.txt");
  if (!existsSync(f)) return;
  const before = Object.fromEntries(readFileSync(f, "utf8").trim().split("\n").map((l) => { const [h, p] = l.trim().split(/\s+/); return [p, h]; }));
  // [A-845 RE-PIN] chog-home.js changed only in the tap-cue type size (A-843 item 6, stage-scaled). pre-A-845 baseline: before["app/src/chog-home.js"] (7d1c417f…938f)
  // [A-891 RE-PIN] return-view.js changed only for UI-19 (folder hit, "open the file" text hidden). pre-A-891 baseline: before["app/src/return-view.js"] (c44d2866…4ac6)
  // [A-912 RE-PIN, Cowork-approved] chog-home.js adds settleChogOneLine() + one MutationObserver (one Chog speech line). pre-A-912 baseline: chog-home.js 1c15f704a1f1294ed68d21b796985db17bd423f4a9256b30ea9a154ead9828e3
  // [A-920 RE-PIN] return-view.js adds the Return Chog drop (RETURN_GEOMETRY.chogDrop, mock img_25-27). pre-A-920 baseline: return-view.js c01be5d750dadf0fdc787a02f1ff328205b4818013d3f6df924c435671b47605
  const A845 = { "app/src/chog-home.js": "a9b1702853d2adfd60dac4e748ed185bc878487fe9d3c09975e5675b3c9a2ca8", "app/src/return-view.js": "9e691c94360ba5275393ee7483bd5e994b739f6a5a317aa0ad38cb176f309221" };
  for (const p of ["app/src/chog-home.js", "app/src/return-view.js"]) assert.equal(sha(readFileSync(path.join(REPO, p))), A845[p] ?? before[p], p);
});

await check("N2 one stage-level family weight drives Home: homeNarrowBlend() is the only source of the boost, the foot walk, the overhang fade and the +6px fade", () => {
  const code = strip(MAIN);
  assert.match(code, /const FAMILY_NARROW_MAX_VW = 640;/);
  assert.match(code, /const FAMILY_MID_MIN_VW = 700;/);
  assert.match(strip(fnSrc(MAIN, "homeCharMobileBoost")), /return 1 \+ \(HOME_CHAR_MOBILE_GROUP_BOOST - 1\) \* homeNarrowBlend\(\);/);
  assert.match(strip(fnSrc(MAIN, "homeCharFloorInkOverhangCorrectionPx")), /homeCharMobileBoost\(\) \* homeNarrowBlend\(\)/);
  assert.match(strip(fnSrc(MAIN, "computeHomeFootTargetViewportY")), /narrowTarget - webTarget\) \* narrowWeight/);
  assert.match(strip(fnSrc(MAIN, "homeMidBandNudgeViewportX")), /homeNarrowBlend\(\)/);
  // the old hard step is gone
  assert.equal(/window\.innerWidth <= 640 \? HOME_CHAR_MOBILE_GROUP_BOOST : 1/.test(code), false);
  // HOME_CHAR_SCALE_FLOOR itself is untouched (A-603 .. A-681 contracts pin the literal)
  assert.match(code, /const HOME_CHAR_SCALE_FLOOR = 0\.52;/);
});

await check("N3 every mid-band consumer carries the same stage boost about the shared foot pivot (Home group, Chog-only, Return cluster + canvas, Departure canvas, First Send work canvas) and the Second work canvas joins them (UI-22)", () => {
  const code = strip(MAIN);
  assert.match(strip(fnSrc(MAIN, "applyHomeCharacterScaleFloor")), /scale\(\$\{midK\}\)/);
  assert.match(strip(fnSrc(MAIN, "computeHomeCharScaleFloorPlan")), /midK, midNudgeX/);
  assert.match(strip(fnSrc(MAIN, "applyHomeFloorToChogOnly")), /scale\(\$\{groupK\}\)/);
  assert.match(strip(fnSrc(MAIN, "applyHomeFloorToReturnCluster")), /const k = plan\.applied \? plan\.k : plan\.midK \|\| 1;/);
  assert.match(strip(fnSrc(MAIN, "computeHomeFloorViewportNudge")), /k: plan\.midK \|\| 1/);
  assert.equal(/homeCharMobileBoost/.test(strip(fnSrc(MAIN, "computeHomeFloorViewportNudge"))), false, "pinned by A-681: the viewport-nudge helper never reads the boost itself");
  assert.match(strip(fnSrc(MAIN, "applyHomeFloorToDepartCanvas")), /homeCharMobileBoost\(\)/);
  const i = code.indexOf("function mountSendCardWorkPose(");
  const wp = code.slice(i, code.indexOf("\nfunction ", i + 1));
  assert.match(wp, /clock === "send" && board && s >= HOME_CHAR_SCALE_FLOOR\)/, "the First Send mid-band branch is still there (a656 pin)");
  // pre-A-837 baseline: assert.match(wp, /clock === "second" && board && s >= HOME_CHAR_SCALE_FLOOR\) \{[\s\S]*?computeHomeMidBandDropPx/, "the Second work canvas takes the SAME shared drop (no scene-specific offset)");
  // A-837: the Second work canvas rides the keyframe board (applyDesktopBoardToCanvas) like Home; its legacy mid-band branch is gone.
  assert.equal(/clock === "second" && board/.test(wp), false, "no Second-specific mid-band branch (A-837)");
  assert.match(wp, /applyDesktopBoardToCanvas\(canvas\)/, "the Second work canvas shares the Home board box");
  assert.equal((code.match(/const nudgeViewportX = homeFloorNudgeViewportX\(s\);/g) || []).length, 4, "a681: exactly the 4 floor consumers use the helper");
});

// pre-A-837 baseline (N4): Name read homeNarrowBlend() through nameStageContinuity() (`const u = homeNarrowBlend(vw);`, `nameStageContinuity(board, scale);`, `const composed = nameCompositionFit(scale);`,
// `if (!(vw > FAMILY_NARROW_MAX_VW) || !(u > 0)) return;`). A-837 replaces the NARROW->MID blend by the v10 layout (one rule at every width), so the blend functions are asserted gone.
await check("N4 Name: the A-819 NARROW->MID blend is gone; Name is one v10 layout (nameSceneLayout) with the pinned fitNameScene literals kept", () => {
  const code = strip(MAIN);
  assert.equal(/NAME_WIDE_FAMILY_MIN_VW|nameNarrowWeight/.test(code), false, "no second ramp");
  assert.equal(/nameStageContinuity|nameCompositionFit|const composed/.test(code), false, "A-837: the blend / composition fit are removed");
  assert.match(code, /const scale = Math\.max\(natural, NAME_SCENE_SCALE_FLOOR\);/);
  assert.match(code, /const n = nameSceneLayout\(f\.L\);/);
  const f = strip(fnSrc(MAIN, "nameSceneLayout"));
  assert.equal(/homeNarrowBlend|font-size|fontSize/.test(f), false, "pure layout: no stage-weight read, no typography");
});

// pre-A-837 baseline (N5): the rail contract for <=640 (`homeReturnReceiptRail`, `getReceiptRail: homeReturnReceiptRail,` x2) and the 641..699 blend provider
// (`setReceiptBlendRailProvider(homeReturnReceiptBlendRail);`, piggy-return.js `railFacts.blend` hand-over). A-837 removes both: one provider (returnLayout) at every width.
await check("N5 Return Receipt: the rail + blend hand-over are gone; the Receipt is placed by returnLayout() through the size provider (piggy-return.js keeps the pure receiptRailTarget API)", () => {
  const code = strip(MAIN);
  assert.equal(/homeReturnReceiptRail|homeReturnReceiptBlendRail|receiptPaperAspectForBlend|setReceiptBlendRailProvider/.test(code), false);
  assert.equal((code.match(/fitBoard: returnFitBoard,/g) || []).length, 2);
  assert.match(code, /setReceiptLegacySizeProvider\(\(\) => \{\s*const aspect = receiptPaperAspect\(\);\s*const r = returnLayout\(undefined, aspect > 0 \? aspect : undefined\);/);
  const p = strip(PRET);
  assert.equal(/setReceiptBlendRailProvider|railFacts\.blend|receiptBlendRailProvider/.test(p), false);
  assert.match(p, /export function receiptRailTarget\(rail, view\)/);
  assert.match(p, /const anchor = railTarget \|\| anchorCenter\(\);/, "a681 pin: the anchor line is textually unchanged");
});

await check("N6 Receipt constants the two-tap flow and the rail contract depend on are unchanged (zoom gain, gate Piggy stage, receiptRailTarget export, size scale)", () => {
  const p = strip(PRET);
  for (const keep of [/const READ_ZOOM_GAIN = 0\.18;/, /const PIGGY_GATE_STAGE_Y = 250 \+ 51\.7;/, /const PIGGY_GATE_SIZE = 0\.228;/ /* [A-920 RE-PIN] pre-A-920 baseline: /const PIGGY_GATE_STAGE_Y = 250;/, /const PIGGY_GATE_SIZE = 0\.24;/ */, /export function receiptRailTarget\(rail, view\)/, /const RECEIPT_SIZE_SCALE = 228 \/ 196;/]) assert.match(p, keep);
});

await check("N7 Invite: crossing the 900 boundary carries phase + each layer's animation clock through the re-render; no timer is created/cleared; fitInvite stays self-contained for the a697 vm cut", () => {
  const fit = strip(fnSrc(MAIN, "fitInvite"));
  assert.match(fit, /typeof carryInviteTimelineAcross === "function"\) carryInviteTimelineAcross\(render\);\s*else render\(\);/);
  const carry = strip(fnSrc(MAIN, "carryInviteTimelineAcross"));
  assert.equal(/setTimeout|clearTimeout|inviteTimers|clearInviteTimers/.test(carry), false);
  assert.match(carry, /setInvitePhase\(phase\);/);
  assert.match(carry, /animationDelay = `-\$\{Math\.round\(elapsed\[i\]\)\}ms`/);
});

await check("N8 Invite behavior on a fake DOM: in-flight phase is re-entered with each layer rewound by its elapsed time; 'closed' is left alone; layers without animation get no delay", () => {
  const mkBoard = (phase, clocks) => {
    const layer = (sel) => ({ _sel: sel, style: { animation: clocks[sel] != null ? "x" : "" }, getAnimations: () => (clocks[sel] != null ? [{ currentTime: clocks[sel] }] : []) });
    const layers = Object.fromEntries([".invite__env", ".invite__egg", ".invite__burst"].map((s) => [s, layer(s)]));
    return { dataset: { phase }, layers, querySelector: (s) => layers[s] || null };
  };
  const run = (phase, clocks) => {
    let current = mkBoard(phase, clocks);
    const calls = [];
    const ctx = {
      document: { querySelector: (s) => (s === ".invite" ? current : null) },
      setInvitePhase: (ph) => { calls.push(ph); current.layers[".invite__env"].style.animation = "env"; current.layers[".invite__egg"].style.animation = "egg"; current.layers[".invite__burst"].style.animation = "none"; },
      Number, Math,
    };
    vm.createContext(ctx);
    vm.runInContext(fnSrc(MAIN, "carryInviteTimelineAcross"), ctx);
    const rendered = [];
    ctx.carryInviteTimelineAcross(() => { rendered.push(1); current = mkBoard("closed", {}); });
    return { calls, rendered, layers: current.layers };
  };
  const a = run("peek1", { ".invite__env": 192.4, ".invite__egg": 80 });
  assert.deepEqual(a.calls, ["peek1"]); assert.equal(a.rendered.length, 1);
  assert.equal(a.layers[".invite__env"].style.animationDelay, "-192ms");
  assert.equal(a.layers[".invite__egg"].style.animationDelay, "-80ms");
  assert.equal(a.layers[".invite__burst"].style.animationDelay, undefined, "no animation on that layer -> no delay");
  const b = run("closed", {});
  assert.deepEqual(b.calls, []); assert.equal(b.rendered.length, 1);
});

await check("N9 family weights are bounded and continuous: boost / foot / stage weight change < 2 % per css px anywhere; exact identity outside the gap", () => {
  const ctx = { window: { innerWidth: 400 }, HOME_CHAR_MOBILE_GROUP_BOOST: 1.5, Math };
  vm.createContext(ctx);
  const src = [
    MAIN.match(/const FAMILY_NARROW_MAX_VW = 640;/)[0], MAIN.match(/const FAMILY_MID_MIN_VW = 700;/)[0],
    fnSrc(MAIN, "homeNarrowBlend"), fnSrc(MAIN, "homeCharMobileBoost"),
    "globalThis.__f = { b: (vw) => { window.innerWidth = vw; return homeCharMobileBoost(); }, u: (vw) => homeNarrowBlend(vw) };",
  ].join("\n");
  vm.runInContext(src, ctx);
  const { b, u } = ctx.__f;
  assert.equal(b(320), 1.5); assert.equal(b(640), 1.5); assert.equal(b(700), 1); assert.equal(b(1440), 1);
  assert.equal(u(640), 1); assert.equal(u(700), 0); assert.equal(u(1280), 0); assert.equal(u(1440), 0);
  for (let w = 600; w < 1500; w += 1) {
    assert.ok(Math.abs(b(w + 1) / b(w) - 1) < 0.02, `boost step at ${w}`);
    assert.ok(b(w + 1) <= b(w) + 1e-12, `boost never grows with width at ${w}`);
    assert.ok(u(w + 1) <= u(w) + 1e-12);
  }
});

await check("N10 bottom-anchor target is continuous across 640/641 and identical to the previous rule on both sides of the gap (vm, --mobile-bottom-safe 20)", () => {
  const ctx = { window: { innerWidth: 400, innerHeight: 800 }, HOME_BOARD_W: 1256, HOME_BOARD_H: 772, HOME_FLOOR: 648, HOME_CHAR_BOTTOM_ANCHOR_GAP_PX: 22, resolveCssLengthVarPx: () => 20, Math };
  vm.createContext(ctx);
  vm.runInContext([
    MAIN.match(/const FAMILY_NARROW_MAX_VW = 640;/)[0], MAIN.match(/const FAMILY_MID_MIN_VW = 700;/)[0], fnSrc(MAIN, "homeNarrowBlend"),
    MAIN.match(/const HOME_FOOT_REF_VW = 1440;/)[0], MAIN.match(/const HOME_FOOT_REF_VH = 900;/)[0], fnSrc(MAIN, "computeHomeFootNormalizedRatio"),
    "const HOME_FOOT_NORMALIZED_RATIO = computeHomeFootNormalizedRatio();", fnSrc(MAIN, "computeHomeFootTargetViewportY"),
    "globalThis.__t = (vw, vh) => { window.innerWidth = vw; return computeHomeFootTargetViewportY(vh); }; globalThis.__r = HOME_FOOT_NORMALIZED_RATIO;",
  ].join("\n"), ctx);
  const T = ctx.__t, R = ctx.__r;
  for (const vh of [600, 755, 805, 900]) {
    assert.equal(T(640, vh), Math.max(R * vh, vh - 42), `narrow identity @${vh}`);
    assert.equal(T(700, vh), Math.min(R * vh, vh - 42), `web identity @${vh}`);
    assert.equal(T(1440, vh), Math.min(R * vh, vh - 42));
    assert.ok(Math.abs(T(641, vh) - T(640, vh)) <= 2, `640 -> 641 foot step ${T(641, vh) - T(640, vh)} @${vh}`);
    for (let w = 640; w < 700; w += 1) assert.ok(Math.abs(T(w + 1, vh) - T(w, vh)) < 2, `foot step @${w}x${vh}`);
  }
  assert.ok(Math.abs(R - 0.8341) < 0.001);
});

await check("N11 forbidden surfaces: the new code touches no money/auth/permission/grant/relayer/mainnet/Gift/typography/copy surface", () => {
  const names = ["homeNarrowBlend", "homeCharMobileBoost", "homeMidBandNudgeViewportX", "carryInviteTimelineAcross", "nameSceneLayout", "returnLayout"]; // pre-A-837 baseline: + homeNarrowFootTargetViewportY, nameStageContinuity, homeReturnReceiptBlendRail, receiptPaperAspectForBlend (removed)
  const body = names.map((n) => strip(fnSrc(MAIN, n))).join("\n");
  assert.equal(/requestPrf|activateSigningSession|requestMoneyPermission|sendTransaction|writeContract|signMessage|navigator\.credentials|localStorage|fetch\(|relayer|grant|mainnet|gift/i.test(body), false);
  assert.equal(/textContent|innerHTML|fontSize|font-size/.test(body), false, "no copy / typography write");
  assert.equal(/setTimeout|setInterval|requestAnimationFrame|animation(Duration|Delay)?\s*=\s*["'`](?!-)/.test(body.replace(/animationDelay = `-/g, "")), false, "no motion retiming");
});

console.log(`\nPart N: ${pass}/${pass + fail} PASS`);

// ═══ Part B ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
if (process.env.ARASO_TEST_BROWSER !== "1") {
  console.log("SKIP  Part B - set ARASO_TEST_BROWSER=1 (headless Chrome + local port)");
  process.exit(fail ? 1 : 0);
}
const A = await import("./helpers/a819-browser.mjs");
const oracle = (await import("./helpers/a837-sweep.mjs")).sceneOracle(MAIN); // [A-837] pure v10 scene layouts evaluated in a vm
const pct = (a, b) => Math.abs(b / a - 1) * 100;
const within2 = (a, b, what) => assert.ok(pct(a, b) <= 2, `${what}: ${a} -> ${b} = ${pct(a, b).toFixed(2)} % > 2 % per css px`);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);
// slack: the Chog <img> boxes carry a transparent crop margin (the existing <=640 sibling box already starts at x=-2.3 / ends 18.9px below its foot)
const inside = (r, vw, vh, what, slack = 0.5) => assert.ok(r && r.l >= -slack && r.t >= -slack && r.r <= vw + slack && r.b <= vh + slack, `${what} outside viewport ${vw}x${vh}: ${JSON.stringify(r)}`);

let H = await A.launchSeeded();
try {
  // ── UI-14 Home ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const home = {};
  const home1 = async (w, h) => (home[`${w}x${h}`] ??= await A.measureHome(H, w, h, { paper: h !== 600 }));
  for (const h of [755, 805]) {
    await check(`B-UI14 [${h}] 639/640/641: Piggy + Chog size and the shared foot are continuous (<=2 %/px, foot <=3 px), Chog:Piggy hierarchy unchanged, A-786 paper unchanged`, async () => {
      const a = await home1(639, h), b = await home1(640, h), c = await home1(641, h);
      for (const [x, y] of [[a, b], [b, c]]) {
        within2(x.piggy.w, y.piggy.w, `Piggy width ${x.vw}->${y.vw}`); within2(x.piggy.h, y.piggy.h, "Piggy height");
        within2(x.chog.w, y.chog.w, "Chog width");
        near(x.piggy.footY, y.piggy.footY, 3, "Piggy foot"); near(x.chog.footY, y.chog.footY, 3, "Chog foot");
        near(x.piggy.cx, y.piggy.cx, 3, "Piggy x anchor");
        near(x.chogToPiggyH, y.chogToPiggyH, 0.02, "Chog:Piggy hierarchy");
        near(x.stage.t, y.stage.t, 4, "Character-stage top");
      }
      assert.ok(b.paper && c.paper, "Home paper opens");
      near(b.paper.w, c.paper.w, 0.6, "A-786 Home Paper width"); near(b.paper.h, c.paper.h, 0.6, "A-786 Home Paper height");
    });
  }
  await check("B-UI14 [755/805] 653/654: the floor->mid-band switch is continuous too (size <=2 %, foot <=3 px, x anchor <=3 px)", async () => {
    for (const h of [755, 805]) {
      const a = await home1(653, h), b = await home1(654, h);
      within2(a.piggy.w, b.piggy.w, "Piggy width 653->654"); near(a.piggy.footY, b.piggy.footY, 3, "foot"); near(a.piggy.cx, b.piggy.cx, 3, "x anchor"); near(a.chog.footY, b.chog.footY, 3, "Chog foot");
    }
  });
  await check("B-UI14 [755] 640 -> 700 walk: no step >2 %/px in Piggy size, none >3 px/px in foot, MID class edge (700) equals the previous canon (foot = 0.834 vh, Piggy width = natural scale)", async () => {
    const ws = [640, 645, 650, 653, 654, 660, 670, 680, 690, 700];
    const rows = [];
    for (const w of ws) rows.push(await home1(w, 755));
    for (let i = 1; i < rows.length; i += 1) {
      const dw = rows[i].vw - rows[i - 1].vw;
      assert.ok(pct(rows[i - 1].piggy.w, rows[i].piggy.w) / dw <= 2, `size slope ${rows[i - 1].vw}->${rows[i].vw}`);
      assert.ok(Math.abs(rows[i].piggy.footY - rows[i - 1].piggy.footY) / dw <= 3, `foot slope ${rows[i - 1].vw}->${rows[i].vw}`);
      // [A-831 RE-PIN] A-829 keyframes: the stage WIDENS with the viewport (211 -> 321 over 390..810) instead of releasing a phone boost, so Piggy grows smoothly (slope <= 2 %/px above) and
      // follows the rule at every sampled width. pre-A-831 baseline: assert.ok(rows[i].piggy.w <= rows[i - 1].piggy.w + 0.5, "Piggy never grows while the viewport widens through the gap");
      const KLw = layoutOracle(MAIN)(rows[i].vw, 755); near(rows[i].piggy.w, 150 * KLw.S, 1, `Piggy width follows the keyframe stage at ${rows[i].vw}`);
    }
    const e = rows[rows.length - 1];
    // [A-831 RE-PIN] pre-A-831 baseline: near(e.piggy.footY, 0.8341 * 755, 2, "700 foot keeps the 1440-canon ratio"); near(e.piggy.w, 150 * 0.4991 * 0 + (700 / 1256) * 150, 4, "700 Piggy width = natural scale * seat width")
    near(e.piggy.footY, layoutOracle(MAIN)(700, 755).floorY, 2, "700 foot = vh - bottom margin (keyframe)");
    near(e.piggy.w, 150 * layoutOracle(MAIN)(700, 755).S, 4, "700 Piggy width = keyframe group scale * seat width");
  });
  await check("B-UI14 representative matrix: Piggy + Chog fully inside the viewport, hierarchy 1.03 +/- 0.03, no overflow, 1440 canon foot unchanged", async () => {
    for (const [w, h] of A.REPRESENTATIVE) {
      const r = await home1(w, h);
      inside(r.piggy, w, h, `${w}x${h} Piggy`); inside(r.chog, w, h, `${w}x${h} Chog`, 20);
      near(r.chogToPiggyH, 1.03, 0.03, `${w}x${h} hierarchy`);
      if (w === 1440) near(r.piggy.footY, layoutOracle(MAIN)(1440, 900).floorY, 1.5, "1440x900 keyframe foot (vh - 8 %)"); // [A-831 RE-PIN] pre-A-831 baseline: near(r.piggy.footY, 750.7, 1.5, "1440x900 canon foot")
    }
  });

  // ── UI-10 Name ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const name = {};
  const name1 = async (w, h) => (name[`${w}x${h}`] ??= await A.measureName(H, w, h));
  for (const h of [805, 600]) {
    await check(`B-UI10 [${h}] 639/640/641: board scale, card, Chog size + foot and the composition footprint are continuous; the peek rig is present on both sides`, async () => {
      const a = await name1(639, h), b = await name1(640, h), c = await name1(641, h);
      for (const [x, y] of [[a, b], [b, c]]) {
        within2(x.card.w, y.card.w, `card width ${x.vw}->${y.vw}`); within2(x.card.h, y.card.h, "card height");
        assert.ok(pct(x.chog.h, y.chog.h) <= 2.5, `Chog height ${x.chog.h} -> ${y.chog.h} = ${pct(x.chog.h, y.chog.h).toFixed(2)} % (geometric blend over the 60 px NARROW->MID gap, 3.36x box ratio => 2.04 %/px by construction; documented >2 %)`); near(x.chogFootY, y.chogFootY, 3, "Chog foot");
        near(x.card.t, y.card.t, 4, "card top");
        assert.ok(x.piggy && y.piggy, "Name Piggy peek rig measurable"); within2(x.piggy.w, y.piggy.w, "peek Piggy width");
        within2(x.footprint.w, y.footprint.w, "composition footprint width"); within2(x.footprint.h, y.footprint.h, "composition footprint height");
        assert.ok(Math.abs(x.chog.w / x.chog.h - y.chog.w / y.chog.h) < 0.12, "Chog aspect only differs by the two assets' own crop");
      }
    });
  }
  await check("B-UI10 [805] 640 -> 700 walk: card width <=2 %/px, Chog height <=2.5 %/px (geometric blend ~2.04 %/px + board-scale drift: the two families' Chog boxes differ 3.4x, documented >2 %), Chog foot <=6 px/px, ends on the unchanged web composition", async () => {
    const ws = [640, 641, 650, 660, 670, 680, 690, 699, 700];
    const rows = [];
    for (const w of ws) rows.push(await name1(w, 805));
    for (let i = 1; i < rows.length; i += 1) {
      const dw = rows[i].vw - rows[i - 1].vw;
      assert.ok(pct(rows[i - 1].card.w, rows[i].card.w) / dw <= 2, `card slope ${rows[i - 1].vw}->${rows[i].vw}`);
      assert.ok(pct(rows[i - 1].chog.h, rows[i].chog.h) / dw <= 2.5, `Chog height slope ${rows[i - 1].vw}->${rows[i].vw}: ${pct(rows[i - 1].chog.h, rows[i].chog.h) / dw} %/px`);
      assert.ok(Math.abs(rows[i].chogFootY - rows[i - 1].chogFootY) / dw <= 6, `Chog foot slope ${rows[i - 1].vw}->${rows[i].vw}`);
    }
  });
  // pre-A-837 baseline (a744 frozen web record): 700x900 card 251.56 / Chog w 56.88 / board scale 0.54688; 1280x805 scale 1, card 460; 1440x900 scale 1.125, card 517.5, Chog w 117.
  // A-837: Name is the v10 layout (card = min(1.55 HomeCard, 0.9 inner), Chog at the Home Chog scale), so the expected values come from nameSceneLayout (vm oracle).
  await check("B-UI10 [A-837] Name at every width follows the v10 layout oracle: card width, board scale and Chog width = nameSceneLayout", async () => {
    for (const [w, h] of [[700, 900], [1280, 805], [1440, 900]]) {
      const r = await name1(w, h); const L = oracle.L(w, h, 0); const n = oracle.name(L, w, h);
      near(r.card.w, n.cardW, 1, `${w}x${h} card`); near(r.board.scale, n.sc, 0.003, `${w}x${h} board scale`); near(r.chog.w, n.chogG * 138.79, 1.5, `${w}x${h} Chog width`);
    }
  });
  await check("B-UI10 representative matrix: card + Chog inside the viewport at 390/430/700/1024/1180/1440", async () => {
    for (const [w, h] of A.REPRESENTATIVE) {
      const r = await name1(w, h);
      inside(r.card, w, h, `${w}x${h} card`); inside(r.chog, w, h, `${w}x${h} Chog`, 20);
    }
  });

  // ── UI-17 Return Receipt ────────────────────────────────────────────────────────────────────────────────────────────
  const ret = {};
  const ret1 = async (w, h) => (ret[`${w}x${h}`] ??= await A.measureReturn(H, w, h));
  for (const h of [808, 600]) {
    await check(`B-UI17 [${h}] 639/640/641: delivered Receipt paper height (and width where width-limited) is continuous (<=2 %/px), no overflow, still delivered + two-tap gate present`, async () => {
      const a = await ret1(639, h), b = await ret1(640, h), c = await ret1(641, h);
      for (const x of [a, b, c]) { assert.equal(x.delivered, true, `${x.vw} delivered`); assert.equal(x.overflow, false, `${x.vw} overflow`); }
      for (const [x, y] of [[a, b], [b, c]]) {
        // The LIMITING dimension of the paper box (width at 808, height at 600) is continuous <=2 %/px. The other follows the paper's own
        // NATURAL aspect, which steps at 640/641 because style.css @media (max-width:640) .receiptPaper__row/__date 15px/14px vs 13px/12px
        // re-flows the 196px sheet (natural height 244 -> 228 = -6.6 %). Typography is out of scope here (Wave 3 UI-13): bounded, not hidden.
        // A-837: kept as the original (pre-A-837 baseline): at 808 the width is the controlled quantity (0.91 x HomeCard); at 600 the read-paper clearance above Piggy's head (returnLayout) limits the HEIGHT.
        const lim = h === 808 ? "w" : "h", other = h === 808 ? "h" : "w";
        within2(x.paper[lim], y.paper[lim], `paper ${lim} ${x.vw}->${y.vw}`);
        assert.ok(pct(x.paper[other], y.paper[other]) <= 8, `paper ${other} ${x.vw}->${y.vw} ${pct(x.paper[other], y.paper[other]).toFixed(2)} % (typography-driven aspect step, bound 8 %)`);
        // the READ paper is stacked on the gap above Piggy's head (bottom-anchored); its top follows its natural height, its bottom edge does not move
        // pre-A-837 baseline: near(x.paper.b, y.paper.b, 8, "paper bottom edge (gap to Piggy head)"); the rail stacked the paper on the gap above Piggy (bottom-anchored).
        // A-837: returnLayout() fixes the paper TOP (portrait: ARASO bottom + 6 % H), so the top edge is the stable one; the height follows the paper's own aspect.
        near(x.paper.t, y.paper.t, 8, "paper top edge (returnLayout)");
      }
      // known, named, out-of-scope: style.css @media (max-width:640) .receiptPaper__row/__date 15px/14px vs 13px/12px (typography; Wave 3 UI-13)
      // [A-845 RE-PIN · Cowork Q1] the Receipt keeps its phone size at every width (A-843 item 5): one value at 640 and 641. pre-A-845 baseline: 12 @641 / 14 @640
      near(c.dateCss, 14, 0, "date css px above 640 = the phone 14px (A-845)"); near(b.dateCss, 14, 0, "date css px at 640 is the existing 14px");
    });
  }
  await check("B-UI17 [808/600] hand-over to the legacy anchor completes by the MID class edge: 700 paper == previous legacy size, 654 and 670 monotone between", async () => {
    const w700 = await ret1(700, 900); /* [A-831 RE-PIN, Cowork Q-C (c)] the delivered Receipt is 0.91 x the Home card width (canon A-835 item 5); pre-A-831 baseline: near(w700.paper.w, 124.23, 1.2, "700x900 legacy paper width (previous baseline)") */ near(w700.paper.w, 0.91 * layoutOracle(MAIN)(700, 900).cardW, 2, "700x900 Receipt paper width = 0.91 x Home card");
    const r641 = await ret1(641, 808); const r670 = await A.measureReturn(H, 670, 808);
    // [A-831 RE-PIN, Cowork Q-C (c)] the Receipt is 0.91 x the Home card width at every width, so it no longer narrows toward the legacy size.
    // pre-A-831 baseline: assert.ok(r641.paper.w >= r670.paper.w - 0.5 && r670.paper.w >= (await ret1(700, 900)).paper.w - 0.5, "paper narrows monotonically 641 -> 670 -> 700");
    // Exact checks (round 3): width = 0.91 x layoutOracle card width (+-2 px) at 641 / 670 / 700, and the 640 -> 641 step <= 1 %.
    for (const [q, vw, vh] of [[r641, 641, 808], [r670, 670, 808], [w700, 700, 900]]) near(q.paper.w, 0.91 * layoutOracle(MAIN)(vw, vh).cardW, 2, `${vw}x${vh} Receipt paper width = 0.91 x Home card`);
    const r640 = await ret1(640, 808);
    assert.ok(pct(r640.paper.w, r641.paper.w) <= 1, `paper width 640->641 step ${pct(r640.paper.w, r641.paper.w).toFixed(2)} % > 1 %`);
    assert.equal(r670.overflow, false);
  });
  await check("B-UI17 representative matrix: Receipt fully inside the viewport at 390/430/700/1024/1180/1440", async () => {
    for (const [w, h] of A.REPRESENTATIVE) { const r = await ret1(w, h); assert.equal(r.delivered, true, `${w}x${h}`); assert.equal(r.overflow, false, `${w}x${h}`); }
  });

  // ── UI-22 Second work Piggy ─────────────────────────────────────────────────────────────────────────────────────────
  await A.seedSecondFixture(H);
  const sec = {};
  const sec1 = async (w, h) => (sec[`${w}x${h}`] ??= await A.measureSecond(H, w, h));
  await check("B-UI22 [755/805] 640/641/653/654 and the web mid-band: the Second work Piggy foot equals the resident seat foot (shared stage baseline), no scene-specific offset", async () => {
    for (const h of [755, 805]) for (const w of [640, 641, 653, 654]) { const r = await sec1(w, h); near(r.footMinusSeatFoot, 0, 1.5, `${w}x${h} work foot - seat foot`); assert.equal(r.seatHidden, true); }
    for (const [w, h] of [[700, 900], [900, 900], [1024, 768], [1180, 820], [1440, 900]]) { const r = await sec1(w, h); near(r.footMinusSeatFoot, 0, 1.5, `${w}x${h} work foot - seat foot`); }
  });
  await check("B-UI22 [755] 640 -> 641 and 653 -> 654: the Second work canvas size and foot are continuous; Second card size preserved (285x364)", async () => {
    for (const [x, y] of [[640, 641], [653, 654]]) {
      const a = await sec1(x, 755), b = await sec1(y, 755);
      within2(a.canvas.w, b.canvas.w, `canvas ${x}->${y}`); near(a.footY, b.footY, 3, "foot"); near(a.pivotX, b.pivotX, 3, "x pivot");
      /* pre-A-837 baseline: near(a.card.w, 285, 0.6, "Second card width"); near(a.card.h, 364, 0.6, "Second card height"); */ { const cw = oracle.L(x, 755, 0).cardW; near(a.card.w, cw, 0.6, "Second card width = 1.0 x Home card (A-835 item 1)"); near(a.card.h, (cw * 364) / 285, 0.6, "Second card height (285:364 aspect)"); }
    }
  });
} finally { await H.close(); }

// ── UI-03 Invite ──────────────────────────────────────────────────────────────────────────────────────────────────────────
H = await A.launchFresh();
try {
  await check("B-UI03 901 -> 899 and 899 -> 901 mid-timeline: the phase is never reset to 'closed', the layer animation clock continues, the artboard family does switch", async () => {
    for (const [from, to, atMs] of [[901, 899, 1500], [899, 901, 2600]]) {
      const r = await A.measureInvitePhaseResize(H, from, to, 800, { atMs, afterMs: [60, 400, 1200] });
      assert.notEqual(r.before.phase, "closed");
      assert.equal(r.after[0].kind, to >= 900 ? "wide" : "mobile");
      const order = ["checking", "success", "peek1", "peek2", "tear", "teared", "exit", "settle", "idle"];
      let last = order.indexOf(r.before.phase);
      for (const s of r.after) {
        assert.notEqual(s.phase, "closed", `${from}->${to} @+${s.sinceResizeMs}ms phase reset`);
        const i = order.indexOf(s.phase); assert.ok(i >= last, `${from}->${to} phase went backwards ${s.phase}`); last = i;
      }
      const b0 = r.before.anims[0], a0 = r.after[0].anims[0];
      if (b0 && a0 && b0.name === a0.name) assert.ok(Number.isFinite(b0.active) && Number.isFinite(a0.active) && a0.active >= b0.active - 80, `${from}->${to} animation restarted: active time ${b0.active} -> ${a0.active}`);
      assert.equal(r.after[0].face && r.after[0].face.w > 0, true, "Face ID control still reachable");
    }
  });
  // pre-A-839 baseline: board + paper inside the viewport at 899/900/901 x 675/800/1000 and the representative sizes (inside(m.board), inside(m.paper)). A-839: the board's art margins are
  // transparent and may overhang the viewport (clipped by .stage--invite, no scroll); the A-724 containment intent is carried by the CONTENT group (hero, Face ID, Chog, burst) staying inside.
  const contentInside = async (w, h) => { const rs = await H.p.evaluate(() => [".invite__hero", "#inviteFaceButton", ".invite__chog", ".invite__chogNative", ".invite__burst"].map((q) => { const e = document.querySelector(q); const r = e && e.getBoundingClientRect(); return r ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; }).filter(Boolean)); assert.ok(rs.length >= 3, "content present"); for (const r of rs) inside(r, w, h, `${w}x${h} invite content`); };
  await check("B-UI03 899/900/901 static: the Invite content group is inside the viewport at 675/800/1000 high (A-724 containment; A-839: board art margins may overhang), brand anchor unchanged by this card", async () => {
    for (const h of [675, 800, 1000]) for (const w of [899, 900, 901]) {
      const m = await A.measureInviteStatic(H, w, h);
      await contentInside(w, h);
      assert.equal(m.kind, w >= 900 ? "wide" : "mobile");
    }
    for (const [w, h] of A.REPRESENTATIVE) { await A.measureInviteStatic(H, w, h); await contentInside(w, h); }
  });
  await check("B-UI03 whole run: pageerror 0", () => assert.deepEqual(H.errors, []));
} finally { await H.close(); }

console.log(`\nA-819: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
