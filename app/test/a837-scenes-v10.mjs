// [A-837] Second / Name / Return-delivery on the v10 rules (A-829 + A-835 items 1-5, 8). Part N = pure (node); Part B = browser (ARASO_TEST_BROWSER=1).
//   N: the pure layouts (homeKeyframeLayout / nameSceneLayout / returnLayout evaluated in a vm) equal the canon at 390x844 / 810x1080 / 1440x900, show no step in a
//      1 px sweep 360..1920 (heights 900 and 1080) nor over w/h 0.7-1.3, and the source keeps its pinned literals / removed paths.
//   B: the live DOM equals the oracle (paper widths, character size + feet vs Home, Name Chog on the margin line / floor, Return group shift, ARASO rail).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sceneOracle } from "./helpers/a837-sweep.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const rd = (p) => readFileSync(path.join(REPO, p), "utf8");
const MAIN = rd("app/src/main.js");
const CSS = rd("app/src/style.css");
const PRET = rd("app/src/piggy-return.js");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const O = sceneOracle(MAIN);
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); pass += 1; } catch (e) { console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0].slice(0, 400)}`); fail += 1; }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);
const lay = (w, h) => { const L = O.L(w, h, 0); return { L, n: O.name(L, w, h), r: O.ret(L) }; };
const REF = [[390, 844], [810, 1080], [1440, 900]];

// ── Part N ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
await check("N1 paper widths equal the A-835 rule at 390 / 810 / 1440 (Second 1.0 x HomeCard, Receipt 0.91 x, Name min(1.55 x, 0.9 inner)) +-0.5 px", () => {
  const want = { 390: { second: 282.3, name: 315, rcpt: 256.9 }, 810: { second: 410.7, name: 635.4, rcpt: 373.7 }, 1440: { second: 376.5, name: 583.6, rcpt: 342.6 } };
  for (const [w, h] of REF) {
    const { L, n, r } = lay(w, h);
    near(L.cardW, want[w].second, 0.6, `${w} HomeCard (Second)`);
    near(n.cardW, Math.min(1.55 * L.cardW, 0.9 * (w - 2 * L.M)), 1e-9, `${w} Name rule`);
    near(n.cardW, want[w].name, 0.6, `${w} Name card`);
    near(r.rw, want[w].rcpt, 0.6, `${w} Receipt`);
  }
});
await check("N2 Return portrait cluster: centred between the margins + 0.07 W (centre = W/2 + .07 W: 222 @390, 462 @810), right ink <= W - M; landscape = one centred group; blended with t = posT", () => {
  const a = lay(390, 844), b = lay(810, 1080), c = lay(1440, 900);
  assert.equal(a.L.posT, 0); assert.equal(c.L.posT, 1);
  const cl = (x) => { const w = 218 * x.L.S, left = x.L.stageLeft - 108 * x.L.S + x.r.dxChar; return { left, right: left + w, centre: left + w / 2 }; };
  // pre-A-837 review baseline: near(a.L.stageLeft + a.r.dxChar + a.L.stageW, 327.8, 0.5, "390 right ink") - Cowork's 327.8 is the right edge of a group as wide as the STAGE (211); the group that is on screen in Return is the
  // cluster (Piggy at the gate + Chog, 218 board units = 170 px at 390, mockup 25: 137-307). Both centre on W/2 + .07 W = 222.3; the canon formula x = (W - groupW)/2 + .07 W applied to the cluster gives right ink 307.
  near(cl(a).centre, 195 + 0.07 * 390, 0.5, "390 cluster centre"); near(cl(a).left, 137.2, 0.6, "390 cluster left"); near(cl(a).right, 307.3, 0.6, "390 cluster right");
  near(cl(b).centre, 405 + 0.07 * 810, 0.5, "810 cluster centre");
  assert.ok(cl(a).right <= 390 - a.L.M && cl(b).right <= 810 - b.L.M, "right ink <= W - M");
  near(a.r.rcx, 195, 1e-9, "390 Receipt top-centred"); near(a.r.top, a.L.asBottom + 0.06 * 844, 0.01, "390 Receipt top = ARASO bottom + 6 % H");
  near(b.r.rcx, 405, 1e-9, "810 Receipt top-centred");
  // landscape group: Receipt + gap + cluster centred in the viewport
  const gap = 30 * c.L.k, gl = c.r.rcx - c.r.rw / 2;
  near(gl + (c.r.rw + gap + 218 * c.L.S) / 2, 720 - 11, 0.01, "1440 group centre"); /* [A-920 RE-PIN] the Receipt sits 11 px further left (RET_RCX_SHIFT, mock img_27). pre-A-920 baseline: 720 */ near(cl(c).left, gl + c.r.rw + gap + 11, 0.01, "1440 cluster left"); /* [A-920 RE-PIN] gap +11 (RET_RCX_SHIFT); pre-A-920 baseline: gl + c.r.rw + gap */
  // t blend: a mid aspect sits between the two ends
  const m = lay(800, 800); assert.ok(m.L.posT > 0 && m.L.posT < 1, "posT blends");
});
await check("N2b Return short windows: where the read paper and the cluster share x the read paper (zoom 1.18, bottom = top + 1.09 rh) does not reach Piggy's head at 450 / 500 / 560 / 600 / 640 x 600 and 390x844 / 430x932; 0.91 x HomeCard is untouched on tall windows", () => {
  for (const [w, h] of [[450, 600], [500, 600], [560, 600], [600, 600], [640, 600], [390, 844], [430, 932], [390, 700], [450, 700]]) {
    const { L, r } = lay(w, h); const limit = L.boardTop + L.S * (491.75 - 515 * (150 / 218) + (250 - 46.9846 * 0.24) * (150 / 218));
    const cl = L.stageLeft - 108 * L.S + r.dxChar, share = Math.abs(r.rcx - (cl + 109 * L.S)) < 0.59 * r.rw + 8 + 109 * L.S;
    if (share) assert.ok(r.top + 1.09 * r.rh <= limit + 0.5, `${w}x${h}: read bottom ${(r.top + 1.09 * r.rh).toFixed(1)} vs ${limit.toFixed(1)}`);
    assert.ok(r.top >= L.asBottom - 0.01, `${w}x${h}: paper below ARASO`);
  }
  for (const [w, h] of REF) { const { L, r } = lay(w, h); near(r.rw, 0.91 * L.cardW, 1e-9, `${w}x${h} 0.91 x HomeCard`); }
});
await check("N3 no-step sweep: 1 px widths 360..1920 at h 900 and 1080 - sizes <= 1 %, positions <= max(1 %, 1.6 px); and w/h 0.7-1.3 at h 900 / 1080", () => {
  const keys = { cardW: 1, rw: 1, ncard: 1, rigScale: 1, chogG: 1, nameCardTop: 0, chogLeft: 0, chogBottom: 0, rcx: 0, top: 0, dxChar: 0 };
  const row = (w, h) => { const { L, n, r } = lay(w, h); return { w, h, cardW: L.cardW, rw: r.rw, ncard: n.cardW, rigScale: n.rigG * n.sc, chogG: n.chogG, nameCardTop: n.cardTop, chogLeft: n.chogLeft, chogBottom: n.chogBottom, rcx: r.rcx, top: r.top, dxChar: r.dxChar }; };
  const series = [];
  for (const h of [900, 1080]) { const s = []; for (let w = 360; w <= 1920; w += 1) s.push(row(w, h)); series.push(s); }
  for (const h of [900, 1080]) { const s = []; for (let w = Math.round(0.7 * h); w <= Math.round(1.3 * h); w += 1) s.push(row(w, h)); series.push(s); }
  for (const s of series) for (let i = 1; i < s.length; i += 1) for (const [k, size] of Object.entries(keys)) {
    const a = s[i - 1][k], b = s[i][k], d = Math.abs(b - a);
    const ok = size ? d <= 0.01 * Math.abs(a) + 1e-9 : d <= Math.max(0.01 * Math.abs(a), 1.6);
    assert.ok(ok, `${k} ${s[i - 1].w}->${s[i].w} @h${s[i].h}: ${a.toFixed(3)} -> ${b.toFixed(3)}`);
  }
});
await check("N4 Name peek is visible below ARASO and the card clears the floor: cardTop - peek >= ARASO bottom + 2 % H at 390x844 / 810x1080 / 1440x900 and 1440x600", () => {
  for (const [w, h] of [...REF, [1440, 600]]) {
    const { L, n } = lay(w, h);
    assert.ok(n.cardTop - 147 * (n.rigG * n.sc) >= L.asBottom + 0.02 * h - 0.5, `${w}x${h} peek below ARASO`);
  }
});
await check("N5 source: pinned literals kept, removed paths gone, pinned functions untouched", () => {
  const code = strip(MAIN);
  assert.match(code, /const NAME_SCENE_SCALE_FLOOR = 0\.42;/);
  assert.match(code, /const scale = Math\.max\(natural, NAME_SCENE_SCALE_FLOOR\);/);
  assert.equal(/nameStageContinuity|nameCompositionFit|homeNarrowFootTargetViewportY|homeReturnReceiptBlendRail|receiptPaperAspectForBlend|setReceiptBlendRailProvider|homeReturnReceiptRail|nameScene__chogWeb/.test(code), false);
  assert.equal(/setReceiptBlendRailProvider|railFacts\.blend/.test(strip(PRET)), false);
  assert.ok(/function homeNarrowBlend\(/.test(code) && /function applyOnboardingPhoneFoot\(/.test(code), "Hatch consumers kept");
  assert.equal(/clock === "second" && board/.test(code), false);
  const cut = (name) => { const i = MAIN.indexOf(`function ${name}(`); let d = 0, st = false; for (let j = MAIN.indexOf("{", i); j < MAIN.length; j += 1) { if (MAIN[j] === "{") { d += 1; st = true; } else if (MAIN[j] === "}") { d -= 1; if (st && d === 0) return MAIN.slice(i, j + 1); } } };
  if (existsSync(path.join(REPO, "_private/ops/receipts/A837_scenes_v10/pre/main.js"))) { // [A-888] public-clone guard: only the pre-copy comparison needs the private file
  const PRE = readFileSync(path.join(REPO, "_private/ops/receipts/A837_scenes_v10/pre/main.js"), "utf8");
  const cutPre = (name) => { const i = PRE.indexOf(`function ${name}(`); let d = 0, st = false; for (let j = PRE.indexOf("{", i); j < PRE.length; j += 1) { if (PRE[j] === "{") { d += 1; st = true; } else if (PRE[j] === "}") { d -= 1; if (st && d === 0) return PRE.slice(i, j + 1); } } };
  for (const f of ["arasoBrandMarkup", "render", "mountInviteChog", "setInvitePhase", "openInvite"]) assert.equal(cut(f), cutPre(f), `${f} byte-identical to the A-837 pre-copy (hash-pinned)`);
  } else console.log("SKIP  N5 pre-copy byte-identity — private pre-copy absent (public checkout); the other N5 assertions still run");
  const hf = (f) => createHash("sha256").update(readFileSync(path.join(REPO, f))).digest("hex");
  const before = path.join(REPO, "_private/ops/receipts/A819_ui_wave1_responsive/HASH_BEFORE.txt");
  // [A-845 RE-PIN · Cowork] chog-home.js changed only in the tap-cue type size (A-843 item 6). pre-A-845 baseline: 7d1c417fc6885a85ff1b55a42c1f3791b6d0e08cb74fa8d489ac556c7b27938f (in the A-819 HASH_BEFORE)
  // [A-920 RE-PIN · hash pin → new sha256] return-view.js adds the Return Chog drop (mock img_25-27). pre-A-920 baseline: return-view.js c01be5d750dadf0fdc787a02f1ff328205b4818013d3f6df924c435671b47605
  // [A-891 RE-PIN · hash pin → new sha256] return-view.js changed only for UI-19 (folder hit, "open the file" text hidden). pre-A-891 baseline: t.includes(hf("app/src/return-view.js")) (c44d28669d32c10f2515326b12d6458eb601957febc9d95a3570955ae5004ac6, in the A-819 HASH_BEFORE)
  // [A-912 RE-PIN, Cowork-approved] chog-home.js adds settleChogOneLine() + one MutationObserver. pre-A-912 baseline: chog-home.js 1c15f704a1f1294ed68d21b796985db17bd423f4a9256b30ea9a154ead9828e3
  if (existsSync(before)) { const t = readFileSync(before, "utf8"); for (const f of ["app/src/chog-home.js", "app/src/return-view.js"]) assert.ok(f === "app/src/chog-home.js" ? hf(f) === "a9b1702853d2adfd60dac4e748ed185bc878487fe9d3c09975e5675b3c9a2ca8" : (t.includes("c44d28669d32c10f2515326b12d6458eb601957febc9d95a3570955ae5004ac6") && hf(f) === "9e691c94360ba5275393ee7483bd5e994b739f6a5a317aa0ad38cb176f309221"), `${f} unchanged`); }
  assert.ok(CSS.trimEnd().endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}"), "final 640 block still last");
});

console.log(`\nPart N: ${pass}/${pass + fail} PASS`);
if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  Part B - set ARASO_TEST_BROWSER=1 (headless Chrome + local port)"); process.exit(fail ? 1 : 0); }

// ── Part B ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const S = await import("./helpers/a837-sweep.mjs");
const H = await S.launchSeeded();
try {
  const home = {}, name = {}, second = {}, ret = {};
  for (const [w, h] of [...REF, [1440, 600]]) {
    const k = `${w}x${h}`;
    home[k] = await S.measureHome(H, w, h);
    name[k] = await S.measureName(H, w, h);
    second[k] = await S.measureSecond(H, w, h);
    ret[k] = await S.measureReturn(H, w, h);
  }
  for (const [w, h] of REF) {
    const k = `${w}x${h}`; const { L, n, r } = lay(w, h);
    await check(`B1 [${k}] Second card = 1.0 x HomeCard, centred on the Home card centre; Name card = rule; Receipt = 0.91 x HomeCard (+-0.5 / +-2 px)`, () => {
      near(second[k].anchor.w, L.cardW, 0.6, "Second card width"); near((second[k].anchor.l + second[k].anchor.r) / 2, L.cx, 1, "Second card cx"); near((second[k].anchor.t + second[k].anchor.b) / 2, L.cy, 1, "Second card cy");
      near(name[k].card.w, n.cardW, 0.6, "Name card width");
      near(ret[k].paper.w, r.rw, 2, "Receipt paper width");
    });
    await check(`B2 [${k}] scene-to-scene: Home <-> Second / Return Chog + Piggy size and feet match (<= 1 px); Name Chog = Home Chog scale, feet on the floor line`, () => {
      near(second[k].chog.w, home[k].chog.w, 1, "Second Chog width"); near(second[k].chog.b, home[k].chog.b, 1, "Second Chog foot");
      near(second[k].seat.w, home[k].seat.w, 1, "Second seat width"); near(second[k].seat.b, home[k].seat.b, 1, "Second seat foot");
      near(ret[k].chog.w, home[k].chog.w, 1, "Return Chog width"); near(ret[k].chog.b, home[k].chog.b, 1, "Return Chog foot");
      near(name[k].chog.w, n.chogG * 138.79, 1.5, "Name Chog img width = chogG x crop");
      // pre-review baseline: near(name[k].chogBox.l + 12.2 * n.chogG, ...) - 12.2 was the bright-pixel offset; the black outline is ink too (the mockup box starts at M + .06 W = 207 @1440)
      near(name[k].chogBox.l + 1.9 * n.chogG, L.M + 0.06 * w * L.posT, 1.5, "Name Chog ink left on the margin line (+6 % W x t)");
      near(name[k].chogInk.left, L.M + 0.06 * w * L.posT, 3, "Name Chog ink left (pixels, outline included)"); near(name[k].chogInk.bottom + 1, L.floorY, 2.5, "Name Chog ink bottom on the floor line (pixels)");
    });
    await check(`B3 [${k}] Return group shift = returnLayout dxChar (+-1.5 px); the settled cluster (Piggy at the gate + Chog, caption excluded) is centred where returnLayout says (portrait: W/2 + .07 W, +-12 px)`, async () => {
      near(ret[k].chog.l - home[k].chog.l, r.dxChar, 1.5, "Return Chog x - Home Chog x");
      const c = ret[k].cluster; assert.ok(c, "cluster pixels measured");
      if (w > h) {
        // [A-845 · Cowork (b)] landscape (A-835 item 5): the GROUP (Receipt + gap + character cluster) is centred: group centre ≈ W/2 (+-12; U-R3 measured 721 @1440).
        // pre-A-845: 1440 used the portrait cluster formula (wrong format)
        // [A-845 · Cowork B3 (a)] the group is the LAYOUT box: measured Receipt left .. oracle cluster-box right (cluster left + RET_CLUSTER_W 218 x S). The drawn ink ends
        // ~24 px inside that box at 1440 (Owner-visual residue, RECEIPT), so an ink-right group sits ~12 px left of W/2. pre-B3(a): (Receipt left + cluster INK right) / 2.
        const boxR = L.stageLeft - 108 * L.S + r.dxChar + 218 * L.S;
        near((ret[k].paper.l + boxR) / 2, w / 2, 12 + 11 /* [A-920 RE-PIN] + the 11 px Receipt keyframe shift at 1440; pre-A-920 baseline: 12 */, `landscape group box centre (Receipt left ${ret[k].paper.l} .. cluster box right ${boxR.toFixed(1)}; ink right ${c.right})`);
      } else {
        const want = L.stageLeft - 108 * L.S + r.dxChar + (218 * L.S) / 2;
        near(c.centre, want, 12, `cluster centre (measured ${c.left}-${c.right})`);
        if (L.posT === 0) near(c.centre, w / 2 + 0.07 * w, 12, "portrait cluster centre = W/2 + .07 W");
      }
    });
    await check(`B4 [${k}] ARASO on the rail in Home, Second, Name, Return (left = margin, font = card x .064, top = 2 x font)`, () => {
      for (const m of [home[k], second[k], name[k], ret[k]]) { near(m.brand.l, L.M, 0.6, "ARASO left"); near(m.brandFont, L.asFont, 0.1, "ARASO font"); near(m.brand.t, L.asTop, 1.5, "ARASO top"); }
    });
    await check(`B5 [${k}] identical line breaks: Name card and Second card keep their authored layout box (460 / 285x364 board) at every width`, async () => {
      const q = await H.p.evaluate(() => ({ nameW: document.querySelector(".nameCard")?.offsetWidth ?? null }));
      assert.ok(q.nameW === null || q.nameW === 460, `nameCard layout width ${q.nameW}`);
    });
  }
  { // [A-845 · Cowork (b)] the second landscape size: same group-centre rule as 1440x900 (measured above with the other scenes)
    const k = "1440x600"; const { L, r } = lay(1440, 600);
    await check(`B3 [${k}] Return group shift = returnLayout dxChar (+-1.5 px); landscape group (Receipt + gap + cluster) centred at W/2 (+-12 px)`, () => {
      near(ret[k].chog.l - home[k].chog.l, r.dxChar, 1.5, "Return Chog x - Home Chog x");
      const c = ret[k].cluster; assert.ok(c, "cluster pixels measured");
      // [A-845 · Cowork B3 (a)] layout group box: measured Receipt left .. oracle cluster-box right. pre-B3(a): (Receipt left + cluster INK right) / 2
      const boxR = L.stageLeft - 108 * L.S + r.dxChar + 218 * L.S;
      near((ret[k].paper.l + boxR) / 2, 1440 / 2, 12, `landscape group box centre (Receipt left ${ret[k].paper.l} .. cluster box right ${boxR.toFixed(1)}; ink right ${c.right})`);
    });
  }
  await check("B6 Name: no clipping at 600-tall windows - card and Chog inside the viewport, peek below ARASO", () => {
    const m = name["1440x600"]; const { L, n } = lay(1440, 600);
    assert.ok(m.card.t >= L.asBottom && m.card.b <= 600, `card ${JSON.stringify(m.card)}`);
    near(m.card.t, n.cardTop, 1, "card top"); assert.ok(m.chog.b <= 600 + 1, "Chog inside");
    near(m.scrollW, 1440, 0.5, "no horizontal overflow");
  });
  // Name arrival frame: the peek head rises above the card top by NAME_PEEK_VISIBLE x rig scale, below ARASO
  // Name arrival (first-hatch frame, settled 6.5 s): the Piggy peek is painted above the card top, below ARASO
  await check("B7 Name arrival: the Piggy peek is IN VIEW (>= 3000 ink pixels in the 140 px above the card top) at 390 / 810 / 1440 and the 1440x600 window, below ARASO, at the Home Piggy scale", async () => {
    for (const [w, h] of [[390, 844], [810, 1080], [1440, 900], [1440, 600]]) {
      const m = await S.measureName(H, w, h, { arrival: true }); const { L, n } = lay(w, h);
      assert.ok(m.peekPx >= 3000, `${w}x${h} peek pixels ${m.peekPx}`);
      near(m.card.t, n.cardTop, 1.5, `${w}x${h} card top`);
      assert.ok(m.card.t - 147 * (n.rigG * n.sc) >= m.brand.b - 0.5, `${w}x${h} peek head below ARASO`);
    }
  });
} finally { await H.close?.(); }
console.log(`\nA-837: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
