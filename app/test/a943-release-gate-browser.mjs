// [A-943] Release gate in a real browser (390x844, headless Chrome + vite dev server, ARASO_TEST_BROWSER=1).
// Level 1 (VITE_ARASO_RELEASE_LEVEL=1): invite → hatch → name (real screens, virtual authenticator) → seeded First receipt → DEV return jump →
// tap through → filed → Home settles; then ≥ 12 s on Home: no "tap me!" cue, no Explore, no honey jar (even with a stored "Second done" mark),
// no Second bell, no + Piggy. Level 2 control (same steps, no stored mark): the cue appears → the probe can see what level 1 must not show.
// Output: $TMPDIR/araso-a943-release-gate-browser (A943_OUT overrides; the card run writes receipts/A943_release_gate/browser).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { testOutDir } from "./helpers/test-out.mjs";

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a943 browser — set ARASO_TEST_BROWSER=1 (headless Chrome + local port)"); process.exit(0); }
const { launch, sleep } = await import("./helpers/a803-browser.mjs");
const OUT = testOutDir("a943-release-gate-browser", process.env.A943_OUT);
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const results = {};
const QUIET_MS = 12000; // the post-file quiet Home is ~8 s before the cue (A-891 POST_FILE_QUIET_HOME_MS); 12 s leaves margin

async function run(level, { storedSecondDone }) {
  process.env.VITE_ARASO_RELEASE_LEVEL = String(level); // read by vite when launch() spawns it (env: { ...process.env, ... })
  const B = await launch();
  const { p } = B;
  const seen = { scenes: [], cue: false, explore: false, jar: false, bell: false, plusPiggy: false };
  try {
    await p.setViewportSize({ width: 390, height: 844 });
    await B.seedSolo("Honeybun");
    await p.evaluate((done) => {
      const a = localStorage.getItem("araso.address");
      const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a943f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa943-dep", redeemTxHash: "0xa943-red", grantTxHash: "0xa943-grant", status: "success", at: Date.parse("2026-10-10T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` };
      localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1");
      localStorage.removeItem("araso.secondIntroSeen"); localStorage.removeItem("araso.resultMotionSeen");
      if (done) localStorage.setItem("araso.secondJourneyClosed", "1"); else localStorage.removeItem("araso.secondJourneyClosed");
    }, storedSecondDone);
    await p.reload({ waitUntil: "networkidle" }); await sleep(600); await B.unlock();
    await p.evaluate(() => {
      const R = { scenes: [], cue: false, explore: false, jar: false, bell: false, plusPiggy: false }; window.__a943 = R;
      const vis = (s) => [...document.querySelectorAll(s)].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden"; });
      const tick = () => {
        const sc = document.querySelector("[data-scene]")?.dataset.scene || null;
        if (R.scenes[R.scenes.length - 1] !== sc) R.scenes.push(sc);
        if (sc === "explore" || sc === "secondAway" || sc === "secondReturn") R.explore = true;
        if (document.querySelector(".chogHome__tapCue")) R.cue = true;
        if (document.querySelector("#a905Jar, .a905-jarLayer")) R.jar = true;
        if (document.querySelector("#secondHomeBell")) R.bell = true;
        if (vis(".homePlusPiggyTab")) R.plusPiggy = true;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // the end of the First Journey: return (arrival) → tap through → filed → Home
    await p.evaluate(() => window.__arasoScene("return", { arrival: true }));
    for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
      const v = await p.evaluate(() => ({ open: !!document.getElementById("returnOpen") && !document.getElementById("returnOpen").hidden, tap: (() => { const e = document.getElementById("returnTap"); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; })() }));
      if (v.open) break;
      if (v.tap) { await B.realClick("#returnTap"); await sleep(1200); continue; }
      await sleep(150);
    }
    const home = await B.waitScene(["sendstay"], 8000);
    await sleep(QUIET_MS);
    Object.assign(seen, await p.evaluate(() => window.__a943));
    seen.home = home;
    seen.finalScene = await B.scene();
    seen.errors = B.errors.slice();
    await p.screenshot({ path: path.join(OUT, `level${level}_home_390.png`) });
  } finally {
    await B.close();
  }
  return seen;
}

const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };

const l1 = await run(1, { storedSecondDone: true });
results.level1 = l1;
await check("level 1: First Journey reaches Home and stays there", () => { assert.equal(l1.home, "sendstay"); assert.equal(l1.finalScene, "sendstay"); });
await check("level 1: no \"tap me!\" cue · no Explore / Second scene", () => { assert.equal(l1.cue, false); assert.equal(l1.explore, false, JSON.stringify(l1.scenes)); });
await check("level 1: no honey jar even with a stored Second-done mark · no Second bell · no + Piggy", () => { assert.equal(l1.jar, false); assert.equal(l1.bell, false); assert.equal(l1.plusPiggy, false); });
await check("level 1: no page errors", () => { assert.deepEqual(l1.errors, []); });

const l2 = await run(2, { storedSecondDone: false });
results.level2 = l2;
await check("level 2 control: same steps → the cue appears (today's behaviour; the probe can see it)", () => { assert.equal(l2.home, "sendstay"); assert.equal(l2.cue, true); });

writeFileSync(path.join(OUT, "result.json"), JSON.stringify({ pass, fail, results }, null, 2));
console.log(`\n${pass} passed, ${fail} failed · out ${OUT}`);
process.exit(fail ? 1 : 0);
