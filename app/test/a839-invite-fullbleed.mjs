// [A-839] Invite on v10: full-bleed notebook, top-centre tape sticker, content group scale = HomeCard rule, ARASO on the rail, common background pitch (A-835 items 6-8).
//   Part N (pure, node): inviteGroupScale oracle (Cowork U-I1: landscape = 1.125 x HomeCard / 377, portrait = (390/420) x min(HomeCard / 283, fit height)), 1 px sweeps, source + CSS guards,
//   the a734 byte-pinned Invite markup / render / openInvite / setInvitePhase / mountInviteChog / arasoBrandMarkup unchanged vs the pre-copy.
//   Part B (browser, ARASO_TEST_BROWSER=1): no box edge at any width/height sample, tape on the viewport top edge at the horizontal centre, group scale = rule, hole column at 0.8 x margin,
//   common background pitch in every scene, ARASO rail, phase carry across the 900 switch.
import {responsiveFrame} from "../src/responsive-layout.js";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { layoutOracle } from "./helpers/a831-sweep.mjs";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const rd = (p) => readFileSync(path.join(REPO, p), "utf8");
const MAIN = rd("app/src/main.js");
const CSS = rd("app/src/style.css");
const PRE = existsSync(privatePath("ops/receipts/A839_invite_fullbleed/pre/main.js")) ? readFileSync(privatePath("ops/receipts/A839_invite_fullbleed/pre/main.js"), "utf8") : null; // [A-888] public-clone guard (null → N3 SKIPs)
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); pass += 1; } catch (e) { console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0].slice(0, 400)}`); fail += 1; }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);
const cutFn = (src, name) => { const i = src.indexOf(`function ${name}(`); if (i < 0) return null; let d = 0, st = false; for (let j = src.indexOf("{", i); j < src.length; j += 1) { if (src[j] === "{") { d += 1; st = true; } else if (src[j] === "}") { d -= 1; if (st && d === 0) return src.slice(i, j + 1); } } return null; };

const L = layoutOracle(MAIN);
const ctx = vm.createContext({ Math, responsiveFrame, homeKeyframeLayout:L, INVITE_WIDE_MIN:700, hkClamp:(v,a,b)=>Math.min(b,Math.max(a,v)) });
vm.runInContext([MAIN.match(/const INVITE_WIDE_ART_SCALE = [^;]+;/)[0], MAIN.match(/const INVITE_PHONE_ART_SCALE = [^;]+;/)[0], MAIN.match(/const INVITE_CONTENT_W = [^;]+;/)[0], MAIN.match(/const INVITE_CONTENT_H = [^;]+;/)[0], MAIN.match(/const INVITE_GROUP_K = [^;]+;/)[0], MAIN.match(/const INVITE_OFFSET_X = [^;]+;/)[0], MAIN.match(/const INVITE_OFFSET_Y = [^;]+;/)[0], cutFn(MAIN, "hkKey"), cutFn(MAIN, "inviteGroupScale"), "globalThis.__s = inviteGroupScale;"].join("\n"), ctx);
const scaleAt = (w, h) => ctx.__s(w >= 700 ? "wide" : "mobile", L(w, h, 0), w, h);
// [A-920 RE-PIN] the rule carries the mock keyframe factor [0.927, 0.927, 1] at 390 / 810 / 1440 (held outside). pre-A-920 baseline: no factor
const qA920 = (w) => (w <= 390 ? 0.927 : w <= 810 ? 0.927 : w <= 1440 ? 0.927 + ((1 - 0.927) * (w - 810)) / 630 : 1);
const ruleAt = (w, h) => { const c = L(w, h, 0).cardW; return qA920(w) * (w >= 900 ? (1.125 * c) / 377 : (390 / 420) * Math.min(c / 283, h / 780)); };

await check("N1 Owner A-1140 HomeCard-ratio Invite envelopes and retained 1440 scale", () => {
  for (const w of [861,1000,1100]) near(scaleAt(w,800) * 553.267 / (1.125 * 376.5 / 377),553.3 * L(w,800,0).cardW / 376.5,2,`${w} envelope`);
  near(scaleAt(390,844) / ruleAt(390,844),1,.01,'390 phone ratio');
  near(scaleAt(1440,900) / ruleAt(1440,900),1,.01,'1440 retained ratio');
  near(scaleAt(1440, 900), 1.125, 0.0015 * 1.125, "1440x900 vs today's board scale");
  near(scaleAt(390, 844), 0.927 * (390 / 420) * (282.32 / 283), 0.005, "390x844 phone"); /* [A-920 RE-PIN] pre-A-920 baseline: (390 / 420) * (282.32 / 283) */
});
await check("N2 no scale step in a 1 px width sweep including the 700 artboard switch", () => {
  const sw = [];
  for (const h of [600, 800, 900, 1080]) {
    for (let w = 360; w < 1920; w += 1) {
      const a = scaleAt(w, h), b = scaleAt(w + 1, h);
      if (w === 699) sw.push(`${h}: 699 ${a.toFixed(4)} -> 700 ${b.toFixed(4)}`);
      assert.ok(Math.abs(b - a) / a <= 0.01, `${w}->${w + 1} @h${h}: ${a} -> ${b}`);
    }
  }
  console.log(`INFO  arrangement switch (699 -> 700): ${sw.join(" | ")}`);
});
if (!PRE) console.log("SKIP  N3 — private pre-copy absent (public checkout)"); else // [A-888] public-clone guard
await check("N3 source: a734 byte-pinned Invite markup + render / openInvite / setInvitePhase / mountInviteChog / arasoBrandMarkup / carryInviteTimelineAcross are byte-identical to the pre-copy", () => {
  for (const f of ["inviteHero", "inviteFace", "inviteHoles", "inviteMobile", "inviteWide", "renderReceived", "openInvite", "setInvitePhase", "render", "mountInviteChog", "arasoBrandMarkup", "carryInviteTimelineAcross"]) {
    // pre-A-912 baseline: b = cutFn(PRE, f). [A-912 re-pin, Cowork-approved] A-912 removes the mobile Invite line `it's safe. only you can open it.`; it is removed from the pre-copy side only.
    const a = cutFn(MAIN, f), b = cutFn(PRE, f)?.replace("        <p class=\"invite__copy\">it's safe. only you can open it.</p>\n", ""); assert.ok(a && b, `${f} present`); assert.equal(a, b, `${f} byte-identical`);
  }
  const fi = strip(cutFn(MAIN, "fitInvite"));
  assert.match(fi, /typeof carryInviteTimelineAcross === "function"\) carryInviteTimelineAcross\(render\);\s*else render\(\);/);
  assert.match(fi, /board\.style\.transform = `scale\(\$\{scale\}\)`;/);
  assert.match(MAIN, /window\.addEventListener\("resize", debouncedHomeResizeListener\(fitInvite\)\);/);
});
await check("N4 CSS: no dark outer box, paper has no ground, body notebook not hidden, corner hidden, tape + holes + ARASO rules, final 640 block last", () => {
  const nc = strip(CSS);
  assert.equal(/#050505/.test(nc), false, "no #050505 anywhere");
  assert.match(nc, /\.invite \{[^}]*overflow: visible;[^}]*background: transparent;/);
  assert.equal(/body:has\(\.stage--invite\)/.test(nc), false);
  assert.match(nc, /\.invite__corner \{\s*display: none;/); assert.match(nc, /\.invite__cornerBack \{\s*display: none;/);
  assert.match(nc, /\.invite__hole \{ display: none; \}/);
  assert.match(nc, /\.invite--wide \.invite__tape \{\s*left: 336px;/);
  assert.match(nc, /\.stage--invite \.arasoBrand \{\s*left: var\(--hlM, 140px\);/);
  assert.equal((nc.match(/@media \(max-width: 1279px\) \{\s*\.stage--invite \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\}/g) || []).length, 1, "a697/a724 containment rule exactly once");
  assert.ok(CSS.endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}\n"));
});
// pre-A-891 baseline: endsWith corner line (v[v.length - 1] === the A-839 corner line). Re-pinned per Cowork answer (A-891, OUTBOX "질문 · A-839 test N5"):
// 94 contains the A-839 corner line and everything after it is later dated newest-wins sections (additions only).
if (!existsSync(privatePath("STUDY/94_VISUAL_DIRECTION.md"))) console.log("SKIP  N5 — private design canon absent (public checkout)"); else // [A-888] public-clone guard
await check("N5 94_VISUAL_DIRECTION.md contains the A-839 corner line; everything after it is later dated newest-wins sections (append-only)", () => {
  const v = readFileSync(privatePath("STUDY/94_VISUAL_DIRECTION.md"), "utf8").trimEnd().split("\n");
  const corner = "[A-839] Invite: yellow folded corner removed (Owner 2026-10-06).";
  const at = v.lastIndexOf(corner);
  assert.ok(at >= 0, "A-839 corner line present");
  assert.equal(v.indexOf(corner), at, "A-839 corner line exactly once");
  const after = v.slice(at + 1);
  const firstNonEmpty = after.find((l) => l.trim() !== "");
  if (firstNonEmpty !== undefined) {
    assert.match(firstNonEmpty, /^## \[\d{4}-\d{2}-\d{2}[^\]]*\]/, "text after the corner line starts with a dated section heading");
    const heads = after.filter((l) => /^## /.test(l));
    assert.ok(heads.length >= 1, "at least one dated section after the corner line");
    for (const hd of heads) {
      const m = hd.match(/^## \[(\d{4}-\d{2}-\d{2})[^\]]*\]/);
      assert.ok(m, `dated heading: ${hd}`);
      assert.ok(m[1] >= "2026-10-06", `later dated than the A-839 corner line (2026-10-06): ${hd}`);
      assert.match(hd, /newest-wins/i, `newest-wins section: ${hd}`);
    }
  }
});
console.log(`\nPart N: ${pass}/${pass + fail} PASS`);
if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  Part B - set ARASO_TEST_BROWSER=1 (headless Chrome + local port)"); process.exit(fail ? 1 : 0); }

// ── Part B ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const { launch, sleep } = await import("./helpers/a803-browser.mjs");
const H = await launch();
const TAPE_PAD = { mobile: 30.5, wide: 23.8 }; // opaque tape margin inside the <img> box (board px), measured from tape@2x.png
const decode = (b64, pts) => H.p.evaluate(async ([b, ps]) => { const img = new Image(); img.src = "data:image/png;base64," + b; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return ps.map(([x, y]) => Array.from(g.getImageData(Math.max(0, Math.min(img.width - 1, Math.round(x))), Math.max(0, Math.min(img.height - 1, Math.round(y))), 1, 1).data.slice(0, 3))); }, [b64, pts]);
async function openInvite(w, h) {
  await H.p.setViewportSize({ width: w, height: h });
  await H.p.goto(H.BASE, { waitUntil: "networkidle" });
  await H.p.waitForSelector(".invite", { timeout: 15000 });
  await sleep(1400);
  return H.p.evaluate(() => {
    const b = document.querySelector(".invite"); const r = (s) => { const e = document.querySelector(s); const q = e && e.getBoundingClientRect(); return q ? { l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height } : null; };
    const cs = getComputedStyle(b);
    return { vw: innerWidth, vh: innerHeight, kind: b.dataset.kind, s: parseFloat(cs.getPropertyValue("--invS")), off: parseFloat(cs.getPropertyValue("--invHoleOff")) || 0, board: r(".invite"), tape: r(".invite__tape"), holes: r(".invite__holes"), brand: r(".arasoBrand"), brandFont: parseFloat(getComputedStyle(document.querySelector(".arasoBrand")).fontSize), boardBg: cs.backgroundColor, paperBg: getComputedStyle(document.querySelector(".invite__paper")).backgroundColor, corner: document.querySelector(".invite__corner") ? getComputedStyle(document.querySelector(".invite__corner")).display : "none", bodySize: getComputedStyle(document.body).backgroundSize, scrollW: document.documentElement.scrollWidth, holeBg: getComputedStyle(document.querySelector(".invite__holes")).backgroundImage };
  });
}
const SIZES = [];
for (const h of [600, 800, 900, 1080]) for (const w of [360, 390, 640, 699, 700, 701, 810, 899, 900, 901, 1100, 1280, 1440, 1920]) SIZES.push([w, h]);
let infoOverlap = []; const containment = [];
for (const [w, h] of SIZES) {
  let m; try { m = await openInvite(w, h); } catch (e) { await check(`B0 [${w}x${h}] Invite reachable`, () => { throw e; }); continue; }
  const l = L(w, h, 0);
  await check(`B1 [${w}x${h}] no box edge: board + paper are transparent, the border strips and the four former board/paper edges show the notebook ground only`, async () => {
    assert.equal(m.boardBg, "rgba(0, 0, 0, 0)"); assert.equal(m.paperBg, "rgba(0, 0, 0, 0)"); assert.equal(m.corner, "none", "yellow folded corner hidden");
    const shot = (await H.p.screenshot()).toString("base64");
    const bl = m.board.l, br = m.board.r, bt = m.board.t, bb = m.board.b;
    const pts = [[2, h / 2], [w - 3, h / 2], [w / 2 + 330, 2], [w / 2, h - 3], [bl - 3, h * 0.55], [bl + 3, h * 0.55], [br - 3, h * 0.55], [br + 3, h * 0.55], [w * 0.5 + 340, bt - 3], [w * 0.5 + 340, bt + 3], [w * 0.7, bb + 3], [w * 0.7, bb - 3]];
    const px = await decode(shot, pts);
    for (const [i, c] of px.entries()) assert.ok(c[0] >= 20 && c[0] <= 40 && Math.abs(c[0] - c[1]) <= 2 && Math.abs(c[1] - c[2]) <= 2, `ground sample ${i} ${JSON.stringify(pts[i].map(Math.round))} = ${c} (must be #161616 or a notebook line, never #050505)`);
  });
  await check(`B2 [${w}x${h}] tape sticker: the opaque tape touches the viewport top edge at the horizontal centre (first opaque tape pixel of the centre column <= 4 px: the art edge is feathered) and is centred horizontally (+-1.5)`, async () => {
    near((m.tape.l + m.tape.r) / 2, w / 2, 3, "tape centre x (the -2deg bbox centre drifts <= (h/2) sin 2deg = 1.8 px about the top-centre origin)");
    const shot = (await H.p.screenshot({ clip: { x: Math.max(0, Math.round(w / 2) - 1), y: 0, width: 3, height: Math.min(120, h) } })).toString("base64");
    const first = await H.p.evaluate(async (b) => { const img = new Image(); img.src = "data:image/png;base64," + b; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); for (let y = 0; y < img.height; y += 1) { const d = g.getImageData(1, y, 1, 1).data; if (d[0] > 120 && d[1] > 90 && d[2] < 110 && d[0] - d[2] > 60) return y; } return -1; }, shot);
    assert.ok(first >= 0 && first <= 4, `first gold pixel at y=${first}`);
  });
  await check(`B3 [${w}x${h}] content group scale = rule (+-1 %); ARASO on the rail; hole column at 0.8 x side margin; line pitch = 32 x HomeCard / 282`, () => {
    near(m.s / scaleAt(w, h), 1, 0.01, "group scale vs inviteGroupScale");
    if (w < 700 || w >= 1440) { const guard = Math.min(w / (m.kind === "wide" ? 760 : 380), h / (m.kind === "wide" ? 720 : 768)); const rule = ruleAt(w, h); if (rule <= guard) near(m.s / rule, 1, 0.01, "group scale vs the A-835 rule"); else { near(m.s / guard, 1, 0.01, "content-containment guard (A-724) binds"); containment.push(`${w}x${h} rule ${rule.toFixed(3)} -> ${m.s.toFixed(3)}`); } }
    near(m.brand.l, l.M, 0.6, "ARASO left"); near(m.brandFont, l.asFont, 0.1, "ARASO font"); near(m.brand.t, l.asTop, 1.5, "ARASO top");
    near((m.holes.l + m.holes.r) / 2, 0.8 * l.M, 1.5, "hole column centre");
    near(parseFloat(m.bodySize.split(" ")[1]), (32 * l.cardW) / 282, 0.05, "body line pitch"); assert.ok(m.scrollW <= w, `no horizontal overflow ${m.scrollW} > ${w}`);
    // information: does a hole circle touch the ARASO box? (A-835 UI: hole column 0.8 M vs ARASO on M)
    const D = (m.kind === "wide" ? 16 : 13) * m.s, pitch = (m.kind === "wide" ? 60 : 47) * m.s;
    for (let y = m.holes.t + m.off * m.s + pitch / 2 - pitch; y < h; y += pitch) { if (y + D / 2 >= m.brand.t && y - D / 2 <= m.brand.b && m.holes.r >= m.brand.l) infoOverlap.push(`${w}x${h} hole@${y.toFixed(0)}`); }
  });
}
console.log(`INFO  containment guard binds (rule scale -> applied): ${containment.length ? containment.join(", ") : "never"}`);
console.log(`INFO  hole circles touching the ARASO box: ${infoOverlap.length ? infoOverlap.join(", ") : "none"}`);
assert.equal(infoOverlap.length, 0, "no hole circle touches the ARASO box (inviteHolePhase)");
await check("B4 [every scene] the body notebook pitch is 32 x HomeCard / 282 (Home, Name, Second, Return) - one common background", async () => {
  const S = await import("./helpers/a819-browser.mjs");
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const l = L(w, h, 0); const pitch = (32 * l.cardW) / 282;
    const pitchOf = () => H.p.evaluate(() => parseFloat(getComputedStyle(document.body).backgroundSize.split(" ")[1]));
    await S.loadHomeAt(H, w, h, { settle: false });
    near(await pitchOf(), pitch, 0.05, `${w} Home`);
    for (const sc of [["name", { resumed: true }], ["explore", { secondJourneyPreview: true }], ["return", { arrival: true }]]) { await H.p.evaluate(([n, o]) => window.__arasoScene(n, o), sc); await sleep(1500); near(await pitchOf(), pitch, 0.05, `${w} ${sc[0]}`); }
  }
});
await check("B5 Invite phase survives the 700 arrangement switch (a819 B-UI03 carries it; here: the artboard family switches and the page keeps rendering)", async () => {
  await H.p.setViewportSize({ width: 701, height: 800 }); await H.p.goto(H.BASE, { waitUntil: "networkidle" }); await H.p.waitForSelector(".invite"); await sleep(900);
  const k1 = await H.p.evaluate(() => document.querySelector(".invite").dataset.kind);
  await H.p.setViewportSize({ width: 699, height: 800 }); await sleep(600);
  const k2 = await H.p.evaluate(() => document.querySelector(".invite")?.dataset.kind);
  assert.equal(k1, "wide"); assert.equal(k2, "mobile");
});
console.log(`\nA-839: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
