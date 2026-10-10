// [A-905] Honey jar: gate, safe-slot placement, arrival bump, reduced motion. Node only, no network (live calls 0).
// pre-A-911 baseline: honey-jar.js (JAR_HOME_SCENES, jarGate(secondAway) === false) and the a905Gate() text pinned here are unchanged. [A-911] widens the main.js gate to secondAway by reassigning a905Gate (the jar is back on secondAway per card A); see a911-own-screens.mjs G1.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-905 test: network forbidden"); };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = (f) => readFileSync(path.join(HERE, "..", "src", f), "utf8");
const J = await import("../src/honey-jar.js");
const M = await import("../src/piggy-motion-state.js");
let pass = 0, fail = 0;
const check = async (n, fn) => { try { await fn(); pass++; console.log(`PASS  ${n}`); } catch (e) { fail++; console.log(`FAIL  ${n}\n      ${String(e.message).split("\n")[0]}`); } };
const R = M.rect;
const anchors = (vw = 1440) => ({ vw, safe: R(16, 16, vw - 16, 884), chog: R(900, 300, 1100, 500), foot: R(500, 100, 880, 600), paper: R(500, 100, 800, 560), brand: R(20, 20, 120, 60), name: R(300, 700, 420, 730), seatImg: R(250, 500, 450, 700) });

await check("J1 gate: only after Second complete and only on a Home scene; no Piggy input exists", () => {
  assert.equal(J.jarGate({ secondJourneyCompletedOnce: false, scene: "sendstay" }), false);
  assert.equal(J.jarGate({ secondJourneyCompletedOnce: true, scene: "sendstay" }), true);
  assert.equal(J.jarGate({ secondJourneyCompletedOnce: true, scene: "explore" }), false);
  assert.equal(J.jarGate({ secondJourneyCompletedOnce: true, scene: "name" }), false);
});
await check("J2 away-only Home still shows the jar (away scenes pass the gate; gate has no Piggy state)", () => {
  assert.equal(J.jarGate({ secondJourneyCompletedOnce: true, scene: "away" }), true);
  assert.equal(J.jarGate({ secondJourneyCompletedOnce: true, scene: "secondAway" }), false, "secondAway: the Second card owns the paper slot (cardClaimed), the paper cannot open");
  assert.equal(J.jarGate.length <= 1, true);
  // [A-918 RE-PIN · A-923 merge] pre-A-918 baseline: planJarSlot({ seatImg: null }) returned a slot from the free-space scan. A-918 E (Owner "같은 자리"): Away passes the
  // invisible seat box (main.js a918SeatBoxFromBoard) as seatImg; no seat box = no jar (fallback 0).
  assert.equal(J.planJarSlot({ anchors: { ...anchors(), seatImg: null, name: null } }), null, "no seat box = no jar (scan removed)");
  const slot = J.planJarSlot({ anchors: { ...anchors(), seatImg: R(250, 500, 450, 700), name: null } });
  assert.ok(slot && slot.spot === "mock", "away: the invisible seat box gives the same mock spot");
});
// pre-A-918 baseline: J3 asserted the free-cell safe-slot (seat-right / seat-left / scan) clearing Chog / footprint / paper / names / brand / occupied, and J4 "no spot that fits = no jar".
// A-918: with a seat Piggy the jar has ONE spot from the seat art box (ratio of the mock); no blockers, no fallback. Full proof = a918-honey-jar-spot-browser.mjs.
await check("J3 [A-918] one fixed mock spot from the seat art box, same ratio at every width, deterministic", () => {
  let last = null;
  for (const vw of [390, 810, 1440]) {
    const a = anchors(vw); a.seatImg = R(vw / 2, 600, vw / 2 + vw / 4, 600 + vw / 4 * 1.044);
    const s1 = J.planJarSlot({ anchors: a }); const s2 = J.planJarSlot({ anchors: a });
    assert.ok(s1); assert.deepEqual(s1, s2); assert.equal(s1.spot, "mock");
    const w = a.seatImg.r - a.seatImg.x, h = a.seatImg.b - a.seatImg.y;
    const rel = { cx: (s1.x + s1.w / 2 - a.seatImg.x) / w, bottom: (s1.y + s1.h - a.seatImg.y) / h, size: s1.w / w };
    assert.ok(Math.abs(rel.cx - J.JAR_MOCK_CX) < 1e-9 && Math.abs(rel.bottom - J.JAR_MOCK_BOTTOM) < 1e-9 && Math.abs(rel.size - J.JAR_MOCK_W) < 1e-9);
    if (last) assert.ok(Math.abs(rel.cx - last.cx) < 1e-9);
    last = rel;
  }
});
await check("J4 [A-918] no seat box = no jar (scan removed, fallback 0)", () => {
  const a = anchors(); a.foot = R(0, 0, 1440, 900); a.seatImg = null;
  assert.equal(J.planJarSlot({ anchors: a }), null);
});
await check("J5 markup matches the class contract (honey before img, vars, no text, no aria copy)", () => {
  const h = J.honeyJarLayerMarkup({ x: 10, y: 20 });
  assert.ok(h.indexOf("a905-jar__fill") < h.indexOf("a905-jar__img"));
  assert.ok(h.includes("--a905JarX:10px") && h.includes("--a905JarY:20px") && h.includes('src="/card/honey-jar.svg"'));
  assert.ok(h.includes('aria-label="money"')); assert.equal(J.JAR_ARIA_LABEL, "money");
  assert.equal(h.replace(/<[^>]*>/g, "").trim(), "", "no visible text");
  assert.equal(h.includes("data-bump"), false);
});
await check("J6 arrival bump only on confirmed real events, once per evidence id", () => {
  let n = 0; const a = J.createJarArrivals({ onBump: () => { n++; } });
  const bad = [null, {}, { kind: "deposit_confirmed" }, { kind: "deposit_confirmed", confirmed: false, creditsTarget: true, evidenceId: "x" }, { kind: "deposit_confirmed", confirmed: true, creditsTarget: false, evidenceId: "x" },
    { kind: "deposit_confirmed", confirmed: true, creditsTarget: true }, { kind: "return_receipt", confirmed: true, hasValue: false, evidenceId: "r" }, { kind: "gift_received", confirmed: true, claimed: false, evidenceId: "g" }, { kind: "pending", confirmed: true, evidenceId: "z" }, { kind: "idle", confirmed: true, evidenceId: "z" }];
  for (const b of bad) assert.equal(a.offer(b), false);
  assert.equal(n, 0);
  assert.equal(a.offer({ kind: "deposit_confirmed", confirmed: true, creditsTarget: true, evidenceId: "0xa" }), true);
  assert.equal(a.offer({ kind: "deposit_confirmed", confirmed: true, creditsTarget: true, evidenceId: "0xa" }), false);
  assert.equal(a.offer({ kind: "return_receipt", confirmed: true, hasValue: true, evidenceId: "r1" }), true);
  assert.equal(a.offer({ kind: "gift_received", confirmed: true, claimed: true, evidenceId: "g1" }), true);
  assert.equal(n, 3);
});
await check("J7 bump sets data-bump, removes it on animationend; reduced motion = static", () => {
  const mk = () => { const attrs = new Map(); const ls = {}; const img = { addEventListener: (t, f) => { ls[t] = f; }, removeEventListener: (t) => { delete ls[t]; } };
    return { attrs, ls, offsetWidth: 1, removeAttribute: (k) => attrs.delete(k), setAttribute: (k, v) => attrs.set(k, v), querySelector: () => img }; };
  const b = mk(); const timers = { setTimeout: () => 1, clearTimeout: () => {} };
  assert.equal(J.bumpJarElement(b, { reduced: false, timers }), true); assert.equal(b.attrs.get("data-bump"), "1");
  b.ls.animationend(); assert.equal(b.attrs.has("data-bump"), false);
  const r = mk(); assert.equal(J.bumpJarElement(r, { reduced: true, timers }), false); assert.equal(r.attrs.has("data-bump"), false);
});
await check("J8 main.js wiring: [A-905] block uses // comments only, jar never reads Piggy state for its gate, deposit is the only wired arrival, no fetch", () => {
  const m = SRC("main.js"); const i = m.indexOf("// ── [A-905] Honey jar"); const j = m.indexOf("// ── [A-905] end ──");
  assert.ok(i > 0 && j > i); const b = m.slice(i, j);
  assert.equal(b.includes("/*"), false); assert.equal(/\bfetch\(/.test(b), false);
  assert.ok(/function a905Gate\(\) \{\s*return jarGate\(\{ secondJourneyCompletedOnce: state\.secondJourneyCompletedOnce === true, scene: state\.scene \}\);\s*\}/.test(b));
  assert.equal((m.match(/a905OfferArrival\(\{/g) || []).length, 1);
  assert.ok(m.includes('kind: "deposit_confirmed", confirmed: true, creditsTarget: true'));
});
await check("J9 live calls 0", () => assert.equal(fetchCalls, 0));
await check("J10 queued arrival: an unmounted jar queues a confirmed arrival, mount plays it once; reduced/none never queue forever", () => {
  let mounted = false; let n = 0;
  const a = J.createJarArrivals({ onBump: () => { if (!mounted) return false; n++; return true; } });
  assert.equal(a.offer({ kind: "deposit_confirmed", confirmed: true, creditsTarget: true, evidenceId: "q1" }), true);
  assert.equal(a.pendingCount, 1); assert.equal(n, 0); assert.equal(a.flush(), false, "still unmounted");
  assert.equal(a.offer({ kind: "deposit_confirmed", confirmed: true, creditsTarget: true, evidenceId: "q1" }), false, "no duplicate queue");
  mounted = true; assert.equal(a.flush(), true); assert.equal(n, 1); assert.equal(a.pendingCount, 0); assert.equal(a.flush(), false);
  assert.equal(a.offer({ kind: "deposit_confirmed", confirmed: true, creditsTarget: true, evidenceId: "q1" }), false, "played = seen");
  assert.equal(a.offer({ kind: "deposit_confirmed", confirmed: false, creditsTarget: true, evidenceId: "q2" }), false);
  assert.equal(a.pendingCount, 0, "unconfirmed is never queued");
});
await check("J11 z-order: jar layer sits inside #homeBoard before #chogHome (above the seat Piggy, below Chog / Paper / bubble), z-index auto, living layer z0 outside", () => {
  const m = SRC("main.js"); const css = SRC("style.css");
  assert.ok(m.includes('if (chogEl) board.insertBefore(layer, chogEl); else board.append(layer);'));
  const blk = css.slice(css.indexOf("html .a905-jarLayer {"), css.indexOf("html .a905-jar {"));
  assert.ok(/z-index: auto;/.test(blk) && !/z-index:\s*\d/.test(blk.replace(/\/\*[\s\S]*?\*\//g, "")));
  assert.ok(/\.homeLivingLayer \{[^}]*z-index: 0;/.test(css) && /\.homeBoard \{[^}]*z-index: 1;/.test(css));
  // DOM order inside the board: seat Piggy markup comes before Chog markup, the jar is inserted between them
  const hc = m.slice(m.indexOf("function homeCharacter(name)"), m.indexOf("function chogHomeMarkupForExplore"));
  assert.ok(hc.indexOf('id="homeChar"') < hc.indexOf("chogHomeMarkupForExplore()"));
});
await check("J12 jar min tap is expressed in board-local px (scaled), mount keeps the same-spot jar, drop falls into the jar", () => {
  const h = J.honeyJarLayerMarkup({ x: 1, y: 2, size: 96, minTap: 88 });
  // pre-A-918 baseline: assert.ok(h.includes("min-width:88px") && h.includes("min-height:88px")) (the art grew with the floor). A-918: the tap box is --a905Tap around the art.
  assert.ok(h.includes("--a905Tap:88px"));
  const css = SRC("style.css");
  assert.ok(css.includes("translateY(340%)"), "drop travels into the jar body");
  assert.ok(SRC("main.js").includes("same spot: keep the mounted jar"));
  assert.ok(css.includes("@media not all and (prefers-reduced-motion: no-preference)"));
});
console.log(`\n${pass}/${pass + fail} PASS`); process.exit(fail ? 1 : 0);
