// [A-904] Browser: one-time honey-jar guide after Second.  ARASO_TEST_BROWSER=1 node app/test/a904-post-second-guide-browser.mjs [outDir]
// Skipped unless ARASO_TEST_BROWSER=1. Checks: not before Second · drop on the first Home · twinkle after the quiet beat · stops forever on the first jar tap ·
// max 3 Home entries · reduced motion = still glow (no animation) · frames 390 / 1440. Nothing is sent; no non-local request.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a904 browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }
const { launch, sleep, REPO } = await import("./helpers/a803-browser.mjs");
const OUT = path.resolve(process.argv[2] || path.join(REPO, "_private/ops/receipts/A904_post_second_guide/browser"));
mkdirSync(OUT, { recursive: true });
const KEY = "araso.a904JarGuide";
const failures = [];
const facts = {};
const must = (c, m) => { if (!c) { failures.push(m); console.log(`ASSERT FAIL  ${m}`); } };

const H = await launch();
const { p } = H;
const read = () => p.evaluate((k) => {
  const j = document.querySelector("#a905Jar");
  const af = j ? getComputedStyle(j, "::after") : null;
  return { jar: !!j, attr: j?.getAttribute("data-a904") ?? null, key: localStorage.getItem(k), afterAnim: af?.animationName ?? null, afterOpacity: af?.opacity ?? null, afterBg: af?.backgroundImage ?? null, afterPE: af?.pointerEvents ?? null, imgAnim: j ? getComputedStyle(j.querySelector(".a905-jar__img")).animationName : null, w: j?.getBoundingClientRect().width ?? 0, h: j?.getBoundingClientRect().height ?? 0 };
}, KEY);
const waitJar = async (ms = 12000) => { for (let t0 = Date.now(); Date.now() - t0 < ms;) { if ((await read()).jar) return true; await sleep(200); } return false; };
async function enter(size) { await H.atWidth(size[0], size[1]); await waitJar(); await sleep(300); }

try {
  await H.seedSolo("Honeybun");
  await p.evaluate((k) => { localStorage.removeItem(k); localStorage.removeItem("araso.secondJourneyClosed"); }, KEY);
  await enter([390, 844]);
  let r = await read();
  facts.beforeSecond = r;
  must(!r.jar && r.attr === null && r.key === null, "before Second: no jar, no guide, nothing stored");

  // Second complete: first Home entry -> drop, then twinkle after the quiet beat (8 s)
  await p.evaluate(() => localStorage.setItem("araso.secondJourneyClosed", "1"));
  await enter([390, 844]);
  r = await read();
  facts.entry1 = r;
  must(r.jar && r.attr === "drop" && r.key === "1", `entry 1: jar drops in and the entry is counted (attr=${r.attr} key=${r.key})`);
  must(r.imgAnim === "a904Drop", `entry 1: drop animation on the jar art (${r.imgAnim})`);
  await sleep(9000);
  r = await read();
  facts.entry1Lit = r;
  must(r.attr === "twinkle", `after the quiet beat: twinkle (${r.attr})`);
  must(r.afterAnim === "a904Twinkle", `twinkle uses the loop (${r.afterAnim})`);
  must(/burst@2x\.png/.test(r.afterBg || ""), "twinkle art = existing burst@2x.png");
  must(r.afterPE === "none", "burst takes no pointer");
  must(r.w >= 44 && r.h >= 44, `tap box unchanged (>= 44): ${r.w}x${r.h}`);
  await p.screenshot({ path: path.join(OUT, "twinkle_390.png") });

  // Chog stays quiet: no "tap me!" cue for this guide
  must((await p.locator(".chogHome__tapCue").count()) === 0, "no Chog tap me cue");

  // first jar tap: done forever
  await H.mustTap("#a905Jar", "jar");
  await sleep(900);
  r = await read();
  facts.afterTap = r;
  must(r.key === "done", `first jar tap stores done (${r.key})`);
  await enter([390, 844]);
  r = await read();
  must(r.jar && r.attr === null && r.key === "done", `after done: jar plain on the next Home (${r.attr}/${r.key})`);

  // max 3 Home entries (no tap), then quiet
  await p.evaluate((k) => localStorage.removeItem(k), KEY);
  for (let i = 1; i <= 4; i += 1) {
    await enter([i === 2 ? 1440 : 390, i === 2 ? 900 : 844]);
    r = await read();
    facts[`max_entry${i}`] = r;
    if (i <= 3) { await sleep(9000); r = await read(); must(r.attr === "twinkle" && r.key === String(i), `max-3: entry ${i} guided (attr=${r.attr} key=${r.key})`); }
    else { await sleep(9000); r = await read(); must(r.attr === null && r.key === "3", `max-3: entry 4 quiet (attr=${r.attr} key=${r.key})`); }
    if (i === 2) await p.screenshot({ path: path.join(OUT, "twinkle_1440.png") });
  }

  // reduced motion: still glow only, no animation
  await p.evaluate((k) => localStorage.removeItem(k), KEY);
  await p.emulateMedia({ reducedMotion: "reduce" });
  await enter([390, 844]);
  await sleep(9000);
  r = await read();
  facts.reduced = r;
  must(r.attr === "twinkle", `reduced: guide still shows (${r.attr})`);
  must(r.afterAnim === "none" && r.imgAnim === "none", `reduced: no twinkle / drop motion (${r.afterAnim}/${r.imgAnim})`);
  must(Number(r.afterOpacity) > 0 && Number(r.afterOpacity) < 0.6, `reduced: faint still glow (${r.afterOpacity})`);
  await p.screenshot({ path: path.join(OUT, "reduced_390.png") });
  await p.emulateMedia({ reducedMotion: "no-preference" });
} catch (e) {
  failures.push(`run: ${String((e && e.stack) || e).slice(0, 500)}`);
  console.log("ERROR", failures[failures.length - 1]);
} finally {
  writeFileSync(path.join(OUT, "frames.json"), JSON.stringify({ errors: H.errors, failures, facts }, null, 2));
  await H.close?.();
}
console.log(`a904 browser: failures=${failures.length} pageErrors=${H.errors.length}`);
process.exit(failures.length ? 1 : 0);
