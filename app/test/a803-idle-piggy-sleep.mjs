// [A-803] Home idle-Piggy sleep eligibility (Owner correction 2026-10-06). SUPERSEDES A-790's "only the active/main Piggy sleeps" rule.
//   Sleep follows each Piggy's resolved Home behavior: a plain-IDLE Home Piggy may sleep after the 90 s inactivity threshold whether it is
//   single, main (seat) or a companion. A Piggy in another ambient action (watching/drink/listen/sunshine) or a runtime action (WORK/AWAY/RETURN)
//   never sleeps while in it. Wake = the existing reverse-Flop on a meaningful interaction (pointerdown/keydown). Chog untouched.
//   Part N (node, always): eligibility matrix, clock, wiring, assignment stability, Chog byte-identity, bounded geometry constant.
//   Part B (browser, ARASO_TEST_BROWSER=1; dev server via node_modules/.bin/vite in helpers/a803-browser.mjs): single Home sleeps; per-role matrix;
//     WORK exclusion; companion state stability; lying-pose pixel collision vs Chog / other Piggies at 6 viewports; reduced motion.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CHOG = readFileSync(path.join(REPO, "app/src/chog-home.js"), "utf8");
const PM_SRC = readFileSync(path.join(REPO, "app/src/piggy-motion-state.js"), "utf8");
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const fnBody = (src, name) => { const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, `${name} missing`); const j = src.indexOf("\n}\n", i); return src.slice(i, j + 3); };
function fakeTime() {
  let t = 0, id = 0; const q = new Map();
  return { now: () => t, setTimer: (fn, ms) => { id += 1; q.set(id, { at: t + ms, fn }); return id; }, clearTimer: (i) => { q.delete(i); },
    advance(ms) { const end = t + ms; for (;;) { let best = null; for (const [k, v] of q) if (v.at <= end && (!best || v.at < best[1].at)) best = [k, v]; if (!best) break; q.delete(best[0]); t = best[1].at; best[1].fn(); } t = end; } };
}

const M = await import("../src/piggy-motion-state.js");
const S = M.PIGGY_MOTION_STATE;

// ═══ Part N ═════════════════════════════════════════════════════════════════════════════════════════
await check("N1 eligibility matrix by resolved state: only plain IDLE may sleep; every ambient action, flop-sleep itself and WORK/AWAY/RETURN may not", () => {
  assert.equal(M.homeSleepEligible(S.IDLE), true);
  for (const s of [S.WATCHING, S.DRINK, S.LISTEN, S.SUNSHINE, S.WORK, S.AWAY, S.RETURN, S.FLOP_SLEEP, undefined, null, "x"]) assert.equal(M.homeSleepEligible(s), false, String(s));
  assert.deepEqual([...M.HOME_SLEEP_ELIGIBLE_STATES], [S.IDLE]);
  for (const s of M.RUNTIME_MOTION_STATES) assert.equal(M.homeSleepEligible(s), false);
});

await check("N2 eligibility does not depend on role or Piggy count: the pure predicate takes the state only; no seat/companion/count branch in the sleepable decision", () => {
  assert.equal(M.homeSleepEligible.length, 1);
  const body = strip(fnBody(MAIN, "planHomeSleepers"));
  // seat and companions share ONE predicate; the only companion-specific gate is physical room (a clear centered lying footprint)
  assert.equal((body.match(/homeSleepEligible\(/g) || []).length, 2);
  assert.match(strip(MAIN), /const sleepable = planned\.sleepers\.has\(id\) && homeSleepEligible\(projected\.state\);/);
  assert.match(strip(MAIN), /if \(indexedResidents\(\)\.length < 1\) \{ homeActiveSleep\?\.reset\(\); return; \}/, "a single Piggy mounts the layer too");
  assert.equal(/residents\.length\s*[<>=]+\s*2/.test(strip(MAIN).slice(strip(MAIN).indexOf("function mountHomeAmbientResidents"))), false, "no >=2 gate left");
});

await check("N3 a runtime Piggy (WORK/AWAY/RETURN) is dropped from the placed set before sleepers are planned (never a sleeper) - resolvePiggyMotionState gives runtime precedence over any ambient state", () => {
  for (const rt of M.RUNTIME_MOTION_STATES) {
    const r = M.resolvePiggyMotionState({ piggyId: "a", runtime: new Map([["a", rt]]), ambient: new Map([["a", { state: S.IDLE, phaseS: 0 }]]) });
    assert.equal(r.state, rt); assert.equal(M.homeSleepEligible(r.state), false);
  }
  assert.match(strip(fnBody(MAIN, "planHomeAmbient")), /const present = everyone\.filter\(\(id\) => !isRuntimeMotionState\(runtime\.get\(id\)\)\);/);
});

await check("N4 assignment stays stable and never draws sleep: same nonce+ids -> identical states; 4000 seeds x 1..6 Piggies; sleepers = exactly the IDLE-assigned set", () => {
  let idle = 0, other = 0;
  for (let k = 1; k <= 6; k += 1) {
    const ids = Array.from({ length: k }, (_, i) => `p${i}x${k}`);
    for (let s = 0; s < 700; s += 1) {
      const a = M.assignHomeAmbient(ids, `seed-${k}-${s}`), b = M.assignHomeAmbient([...ids].reverse(), `seed-${k}-${s}`);
      for (const id of ids) { assert.deepEqual(a.get(id), b.get(id)); assert.notEqual(a.get(id).state, S.FLOP_SLEEP); if (M.homeSleepEligible(a.get(id).state)) idle += 1; else other += 1; }
    }
  }
  assert.ok(idle > 1000 && other > 1000, `idle ${idle} other ${other}: both populations occur`);
  assert.equal(M.AMBIENT_WEIGHTS[S.FLOP_SLEEP], 5);
});

await check("N5 threshold + wake: one 90 s inactivity clock (89.9 awake / 90.0 asleep), interaction while asleep starts the existing reverse-Flop (piggyWakePhase waking -> awake)", () => {
  assert.equal(M.ACTIVE_SLEEP_AFTER_MS, 90000);
  const f = fakeTime(); const c = M.createActiveSleepClock({ now: f.now, setTimer: f.setTimer, clearTimer: f.clearTimer });
  c.arm(); f.advance(89900); assert.equal(c.snapshot().mode, "awake"); f.advance(100); assert.equal(c.snapshot().mode, "sleeping");
  f.advance(20000); assert.equal(c.interact(), true);
  const s = c.snapshot(); assert.equal(s.mode, "waking");
  assert.equal(M.piggyWakePhase(s.elapsedS, false, s.wakeStartS).phase, "waking");
  f.advance(Math.ceil(M.PIGGY_WAKE.durationS * 1000) + 50); assert.equal(c.snapshot().mode, "awake");
  assert.equal((strip(MAIN).match(/piggyWakePhase\(/g) || []).length, 1, "the ONE existing reverse-Flop path; no new wake art");
});

await check("N6 Chog untouched: chog-home.js byte-identical to the A-790 baseline, SLEEP_IDLE_MS = 60000, no 90 s / sleep-clock symbol", () => {
  // [A-845 RE-PIN] the only change is the tap-cue type size (measureTapCue: stage-scaled CSS size instead of fixed screen px); sleep code untouched.
  // pre-A-845 baseline: 7d1c417fc6885a85ff1b55a42c1f3791b6d0e08cb74fa8d489ac556c7b27938f
  assert.equal(createHash("sha256").update(CHOG).digest("hex"), "1c15f704a1f1294ed68d21b796985db17bd423f4a9256b30ea9a154ead9828e3");
  assert.match(CHOG, /export const SLEEP_IDLE_MS = 60000;/);
  assert.equal(/90000|ACTIVE_SLEEP|createActiveSleepClock|homeSleepEligible/.test(CHOG), false);
});

await check("N7 lying-pose adjustment is bounded + evidence-driven: one angle about the seated foot anchor (0 < angle <= 20 deg, no dx/dy), blended over the existing landing-rest smoothstep (first frame stays the seated idle)", () => {
  const m = MAIN.match(/const AMB_SLEEP_ADJUST = Object\.freeze\(\{ angle: ([\d.]+), dx: (-?[\d.]+), dy: (-?[\d.]+) \}\);/);
  assert.ok(m, "AMB_SLEEP_ADJUST");
  assert.ok(Number(m[1]) > 0 && Number(m[1]) <= 20, `angle ${m[1]}`); assert.equal(Number(m[2]), 0); assert.equal(Number(m[3]), 0);
  assert.match(strip(MAIN), /placeAdjusted\(w\.phase === "awake" \|\| t < 1\.3 \? 0 : t < 3 \? ambSmooth\(\(t - 1\.3\) \/ 1\.7\) : 1\);/);
});

await check("N8 scope: no money/auth/storage/selection path in the sleep wiring or the pure module; dev seams are LOCAL_DEV_ENTRY-gated", () => {
  const body = strip(fnBody(MAIN, "makeSeatSleeper") + fnBody(MAIN, "planHomeSleepers") + fnBody(MAIN, "homeActiveSleepClock"));
  assert.equal(/localStorage|sessionStorage|saveRegistry|requestPrf|sendTransaction|writeContract|signMessage|state\./.test(body), false);
  assert.equal(/localStorage|sessionStorage|document\.|window\./.test(strip(PM_SRC)), false);
  assert.match(strip(MAIN), /const force = LOCAL_DEV_ENTRY \? globalThis\.__a803AmbientForce : null;/);
  assert.match(strip(MAIN), /\(LOCAL_DEV_ENTRY && globalThis\.__a803SleepAdjust\)/);
});

// ═══ Part B ═════════════════════════════════════════════════════════════════════════════════════════
// browser suites bind a local port: the runner classifies this file by the dev-server launch in helpers (node_modules/.bin/vite)
if (process.env.ARASO_TEST_BROWSER !== "1") console.log("SKIP  Part B - set ARASO_TEST_BROWSER=1 (headless Chrome + local port)");
else await runBrowser();
console.log(`\nA-803: ${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);

async function runBrowser() {
  const H = await import("./helpers/a803-browser.mjs");
  if (!H.harnessPresent()) { console.log("SKIP  Part B - local harness absent"); return; }
  const { sleep, SEAT, COMP, phaseOf, sweepSeat } = H;
  const h = await H.launch();
  const p = h.p;
  try {
    // one init script, parameters via localStorage so each scenario can reload with different pins (dev-server-only seams)
    await h.context.addInitScript(() => {
      try { const s = Number(localStorage.getItem("__t803seam")); if (s > 0) globalThis.__a790SleepAfterMs = s; } catch {}
      try { const f = JSON.parse(localStorage.getItem("__t803force") || "null"); if (f) globalThis.__a803AmbientForce = f; } catch {}
    });
    // [A-803 fix diagnostics] window.__arasoSleepPlan (main.js, a172-local dev build only) read for failure messages; never asserted on.
    const sleepPlanJson = async (pg) => { try { return JSON.stringify(await pg.evaluate(() => window.__arasoSleepPlan ?? null)); } catch (e) { return `unreadable: ${e.message}`; } };
    const pin = async (seam, force) => p.evaluate(([s, f]) => { localStorage.setItem("__t803seam", String(s)); if (f) localStorage.setItem("__t803force", JSON.stringify(f)); else localStorage.removeItem("__t803force"); }, [seam, force]);
    const reload = async (w = 1440, hh = 900) => { await p.setViewportSize({ width: w, height: hh }); await p.reload({ waitUntil: "networkidle" }); await sleep(600); await h.unlock(); await h.waitScene(["sendstay"], 9000); };
    const waitPhase = async (sel, want, ms, idx = 0) => { const t0 = Date.now(); let r = null; while (Date.now() - t0 < ms) { r = await phaseOf(p, sel, idx); if (r && r.phase === want) return r; await sleep(150); } return r; };
    const solo = () => p.evaluate(() => { const e = document.querySelector(".homeLiving"); return { n: document.querySelectorAll(".homeLiving").length, vis: e ? getComputedStyle(e).visibility : null, attr: document.querySelector("#homeChar")?.dataset.ambientSeat || null, phase: e?.dataset.sleepPhase || null, motion: e?.dataset.motionState || null }; });

    // ── single Piggy Home ──
    await h.seedSolo();
    await pin(6000, null);
    await reload();
    const before = await solo();
    await check("B1 [single Piggy] the layer mounts for one Piggy; awake it is visible with the approved Idle blink + breath (data-ambient-seat=1, no sleepPhase) [A-841 UI-27]", () => {
      // pre-A-841 baseline: vis "hidden", attr null (awake lone Piggy kept the original #homeChar drawing)
      assert.equal(before.n, 1); assert.equal(before.vis, "visible"); assert.equal(before.attr, "1"); assert.equal(before.phase, null);
    });
    const slept = await waitPhase(".homeLiving", "sleeping", 20000);
    const sOn = await solo();
    await check("B2 [single Piggy] a plain-idle lone Piggy sleeps after the inactivity threshold (6 s dev seam): flop-sleep, phase sleeping, layer shown, #homeChar steps aside", () => {
      assert.ok(slept && slept.phase === "sleeping" && slept.motion === "flop-sleep", JSON.stringify(slept));
      assert.equal(sOn.vis, "visible"); assert.equal(sOn.attr, "1");
    });
    await sleep(12000); // wake reverses from the CURRENT forward time: let it reach deep sleep so the whole reverse-Flop is visible
    await p.mouse.click(8, 8); await sleep(500);
    const wk = await solo();
    await sleep(11500);
    const aw = await solo();
    await check("B3 [single Piggy] wake = existing reverse-Flop on a meaningful interaction (waking), then the layer stays on the awake Idle (visible, attribute kept) [A-841 UI-27]", () => {
      assert.equal(wk.phase, "waking", JSON.stringify(wk));
      // pre-A-841 baseline: aw.vis "hidden", aw.attr null (control handed back to #homeChar)
      assert.equal(aw.vis, "visible", JSON.stringify(aw)); assert.equal(aw.attr, "1"); assert.equal(aw.phase, null);
    });
    await pin(6000, null); await reload();
    await waitPhase(".homeLiving", "sleeping", 20000); await sleep(9000);
    await p.keyboard.press("Shift"); await sleep(500);
    await check("B3b [single Piggy] a keydown also wakes it", async () => { assert.equal((await solo()).phase, "waking"); });
    // WORK exclusion: Explore (WORK runtime) for the lone Piggy never sleeps
    await pin(4000, null); await reload();
    await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true })); await sleep(9000);
    const ex = await p.evaluate(() => ({ sc: document.querySelector("[data-scene]")?.dataset.scene, slept: [...document.querySelectorAll(".homeLiving")].filter((e) => e.dataset.sleepPhase).length, attr: document.querySelector("#homeChar")?.dataset.ambientSeat || null }));
    await check("B4 [WORK] in Explore (WORK runtime) the lone Piggy is not a sleeper after the threshold", () => { assert.equal(ex.slept, 0, JSON.stringify(ex)); assert.equal(ex.attr, null); });

    // ── two Piggies: per-role matrix (pinned states through the dev seam; assignment itself is the product's) ──
    await h.seedMulti();
    const cases = [
      ["idle", "idle", true, true], ["idle", "drink", true, false], ["drink", "idle", false, true], ["listen", "sunshine", false, false],
    ];
    for (const [seat, comp, seatSleeps, compSleeps] of cases) {
      await pin(6000, { seat, companion: comp }); await reload();
      const c0 = await phaseOf(p, COMP);
      const c0attrs = await p.evaluate(() => { const e = document.querySelector('.homeLiving:not([data-seat="1"])'); return e ? { slot: e.dataset.slot, id: e.dataset.piggyId, ph: e.dataset.phase } : null; });
      await sleep(13000);
      const s1 = await phaseOf(p, SEAT), c1 = await phaseOf(p, COMP);
      const c1attrs = await p.evaluate(() => { const e = document.querySelector('.homeLiving:not([data-seat="1"])'); return e ? { slot: e.dataset.slot, id: e.dataset.piggyId, ph: e.dataset.phase } : null; });
      const plan5 = await sleepPlanJson(p); // [A-803 fix diagnostics] failure messages only; assertions unchanged
      await check(`B5 [2 Piggies] seat=${seat} companion=${comp}: seat sleeps=${seatSleeps}, companion sleeps=${compSleeps}; the companion's slot/id/phase assignment is unchanged by the sleep`, () => {
        assert.equal(s1.phase === "sleeping", seatSleeps, JSON.stringify(s1) + " plan=" + plan5);
        assert.equal(c1.phase === "sleeping", compSleeps, JSON.stringify(c1) + " plan=" + plan5);
        if (!compSleeps) assert.notEqual(c1.motion, "flop-sleep");
        if (!seatSleeps) assert.notEqual(s1.motion, "flop-sleep");
        assert.deepEqual(c1attrs, c0attrs); assert.ok(c0);
      });
      if (seatSleeps || compSleeps) {
        await p.mouse.click(8, 8); await sleep(500);
        const w1 = await phaseOf(p, SEAT), w2 = await phaseOf(p, COMP);
        const plan6 = await sleepPlanJson(p);
        await check(`B6 [2 Piggies ${seat}/${comp}] one interaction wakes every sleeper with the reverse-Flop; a non-idle Piggy is never touched`, () => {
          if (seatSleeps) assert.equal(w1.phase, "waking", JSON.stringify(w1) + " plan=" + plan6); else assert.equal(w1.phase, null, JSON.stringify(w1) + " plan=" + plan6);
          if (compSleeps) assert.equal(w2.phase, "waking", JSON.stringify(w2) + " plan=" + plan6); else assert.equal(w2.phase, null, JSON.stringify(w2) + " plan=" + plan6);
        });
      }
    }
    // WORK exclusion with 2 Piggies: the scene Piggy in Explore is dropped; no sleeper there
    await pin(4000, { seat: "idle", companion: "idle" }); await reload();
    await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true })); await sleep(9000);
    const ex2 = await p.evaluate(() => ({ seatEntries: document.querySelectorAll('.homeLiving[data-seat="1"]').length, workerSlept: [...document.querySelectorAll('.homeLiving[data-seat="1"]')].filter((e) => e.dataset.sleepPhase).length, restSlept: [...document.querySelectorAll('.homeLiving:not([data-seat="1"])')].filter((e) => e.dataset.sleepPhase === "sleeping").length }));
    const plan7 = await sleepPlanJson(p);
    await check("B7 [WORK] 2 Piggies, Explore: the working scene Piggy is not drawn as a resident and never sleeps; the idle Piggy that is still at Home may", () => {
      assert.equal(ex2.seatEntries, 0, JSON.stringify(ex2) + " plan=" + plan7); assert.equal(ex2.workerSlept, 0, plan7); assert.equal(ex2.restSlept, 1, JSON.stringify(ex2) + " plan=" + plan7);
    });

    // ── geometry: pixel collision of the lying pose at 6 viewports (Chog awake + other Piggy sleeping too) ──
    const VPS = [[390, 844], [430, 932], [700, 900], [1024, 768], [1180, 820], [1440, 900]];
    const sum = {};
    for (const [w, hh] of VPS) {
      await pin(3000, { seat: "idle", companion: "idle" }); await reload(w, hh);
      const r = await sweepSeat(p, { others: COMP, Ts: [1.3, 8, 8.5, 9, 10, 20], waitMs: 30000 });
      sum[`${w}x${hh}`] = r.summary || r;
    }
    await check("B8 [geometry, 6 viewports] lying pose vs Chog: 0 overlapping ink px and >= 2 px clearance over the whole sequence (flop, blanket rise, deep sleep)", () => {
      for (const [k, v] of Object.entries(sum)) { assert.ok(!v.error, `${k} ${v.error}`); assert.equal(v.maxOverlapChogPx, 0, `${k} ${JSON.stringify(v)}`); assert.ok(v.minGapChogPx >= 2, `${k} gap ${v.minGapChogPx}`); }
    });
    await check("B8b [geometry, 6 viewports] a sleeping companion's pose vs Chog: 0 overlapping ink px wherever a companion sleeps", () => {
      for (const [k, v] of Object.entries(sum)) assert.equal(v.maxOverlapOthersChogPx, 0, `${k} ${v.maxOverlapOthersChogPx}`);
    });
    await check("B9 [geometry] two sleeping Piggies: seat pose vs sleeping companion <= 2 px AA-class contact (the 390 px seat/companion contact pre-dates A-803: before = after = 2 px), none elsewhere", () => {
      for (const [k, v] of Object.entries(sum)) assert.ok(v.maxOverlapOthersPx <= 2, `${k} ${v.maxOverlapOthersPx}`);
    });
    // reduced motion
    await p.emulateMedia({ reducedMotion: "reduce" });
    await pin(3000, { seat: "idle", companion: "drink" }); await reload(1440, 900);
    const rs = await waitPhase(SEAT, "sleeping", 20000);
    const a = await p.locator(SEAT).screenshot(); await sleep(2500); const b = await p.locator(SEAT).screenshot();
    await p.mouse.click(8, 8); await sleep(300);
    const rw = await phaseOf(p, SEAT);
    await check("B10 [reduced motion] the sleeper is one stable still pose; a tap makes it awake at once", () => {
      assert.ok(rs && rs.phase === "sleeping", JSON.stringify(rs)); assert.ok(a.equals(b)); assert.equal(rw.phase, null);
    });
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await check("B11 no page errors", () => assert.deepEqual(h.errors, []));
  } finally { await h.close(); }
}
