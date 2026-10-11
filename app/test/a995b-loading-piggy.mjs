import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  A995_MOUTH_FOLLOW,
  A995B_BLINK_MS,
  A995B_CYCLE_MS,
  A995B_EYE_RADIUS,
  a995bLoadingOffset,
} from "../src/a995b-loading-piggy.js";

const rd = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");
const bytes = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url));
const MAIN = rd("app/src/main.js");
const CSS = rd("app/src/style.css");
const LOADER = rd("app/src/a995b-loading-piggy.js");
const SVG = rd("app/public/motion/a995b-loading-piggy.svg");

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}: ${error.message}`); }
}

await check("approved preview constants and one-cycle path", () => {
  assert.equal(A995_MOUTH_FOLLOW, 0.5);
  assert.equal(A995B_EYE_RADIUS, 22);
  assert.equal(A995B_CYCLE_MS, 3600);
  assert.equal(A995B_BLINK_MS, 3200);
  assert.deepEqual(a995bLoadingOffset(0), { x: 0, y: 0 });
  assert.ok(Math.hypot(...Object.values(a995bLoadingOffset(400))) === 0);
  const fullRadius = a995bLoadingOffset(650);
  assert.ok(Math.abs(Math.hypot(fullRadius.x, fullRadius.y) - 22) < 1e-9);
  const bottom = a995bLoadingOffset(1200);
  assert.ok(Math.abs(bottom.x) < 1e-9 && Math.abs(bottom.y - 22) < 1e-9);
  assert.deepEqual(a995bLoadingOffset(2000), { x: 0, y: 0 });
  assert.deepEqual(a995bLoadingOffset(1200, true), { x: 0, y: 0 });
});

await check("approved no-arm dark Piggy is byte-identical and keeps two eyes", () => {
  assert.equal(createHash("sha256").update(bytes("app/public/motion/a995b-loading-piggy.svg")).digest("hex"), "e55b7f60f1a748fdd939bf89d9a668bb05acaaf73a7d120cb5adf0afe2ea8851");
  assert.match(SVG, /viewBox="110 -30 780 780"/);
  assert.match(SVG, /translate\(0 110\) rotate\(-7 500 420\)/);
  assert.equal((SVG.match(/class="eye"/g) || []).length, 2);
});

await check("PWA-only bridge mounts in the first boot task without Checking/auth copy", () => {
  assert.equal((MAIN.match(/mountA995bLoadingPiggy\(\)/g) || []).length, 1);
  assert.match(MAIN, /render\(\);\nstartTesterIntro\(\);\n\/\/ \[A-995-b\][\s\S]*?mountA995bLoadingPiggy\(\);/);
  assert.match(LOADER, /display-mode: standalone/);
  assert.doesNotMatch(LOADER, /["'`]Checking|["'`]Try again|loginCheckingMarkup\(|renderAppLock\(|data-chog-invite=/);
});

await check("390 splash geometry, blink reopen, and reduced-motion still are pinned", () => {
  assert.match(CSS, /top: 26\.6587677725%; \/\* 225 \/ 844/);
  assert.match(CSS, /width: 51\.2820512821vw; \/\* 200 \/ 390/);
  assert.match(LOADER, /svg\.style\.background = "#151515";/);
  assert.match(LOADER, /90%, 100% \{ transform: scaleY\(1\); \} 94% \{ transform: scaleY\(\.08\); \}/);
  assert.match(LOADER, /reduce \? "\.eye \{ animation: none; transform: scaleY\(1\); \}"/);
  assert.match(CSS, /prefers-reduced-motion: reduce[\s\S]*?a995bLoading__face object \{ visibility: hidden; \}/);
});

await check("Checking and failure authentication remain the existing Chog paths", () => {
  assert.match(MAIN, /function loginCheckingMarkup\(phase\)[\s\S]*?chogInviteMarkup\(\)/);
  assert.match(MAIN, /function renderAppLock\(\)[\s\S]*?mountInviteChog\(\)/);
  assert.match(MAIN, /const failed = state\.appLock\.phase === "failed";[\s\S]*?failed\s*\? renderAuthCard\(/);
});

if (process.env.ARASO_TEST_BROWSER === "1") {
  const { launch, sleep } = await import("./helpers/a803-browser.mjs");
  const out = path.resolve(process.argv[2] || "A995b_390_frames");
  mkdirSync(out, { recursive: true });
  let H;
  await check("390 browser: eye/mouth ratio, blink reopen, Chog handoff, short recording", async () => {
    try {
      H = await launch();
      await H.seedSolo("Honeybun");
      await H.p.setViewportSize({ width: 390, height: 844 });
      await H.p.goto(`${H.BASE}?a995b-loading=1`, { waitUntil: "domcontentloaded" });
      await H.p.waitForFunction(() => document.querySelector(".a995bLoading object")?.contentDocument?.querySelector(".a995b-pk-mouth"), null, { timeout: 8000 });

      const samples = [];
      for (let i = 0; i < 30; i += 1) {
        const file = path.join(out, `a995b_390_${String(i).padStart(2, "0")}.png`);
        await H.p.screenshot({ path: file });
        samples.push(await H.p.evaluate(() => {
          const overlay = document.querySelector(".a995bLoading");
          const object = overlay?.querySelector("object");
          const doc = object?.contentDocument;
          const eyeGroup = doc?.querySelector(".a995b-pk-eyes");
          const mouthGroup = doc?.querySelector(".a995b-pk-mouth");
          const eye = doc?.querySelector("path.eye");
          const box = overlay?.querySelector(".a995bLoading__face")?.getBoundingClientRect();
          return {
            overlay: !!overlay,
            text: overlay?.innerText || "",
            eyeTransform: eyeGroup?.getAttribute("transform") || "",
            mouthTransform: mouthGroup?.getAttribute("transform") || "",
            eyeCss: eye ? getComputedStyle(eye).transform : "",
            box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
          };
        }));
        await sleep(95);
      }

      const moving = samples.find((sample) => {
        const m = sample.eyeTransform.match(/translate\(([-.\deE]+) ([-.\deE]+)\)/);
        return m && Math.hypot(Number(m[1]), Number(m[2])) > 5;
      });
      assert.ok(moving, "eye group moved");
      const eye = moving.eyeTransform.match(/translate\(([-.\deE]+) ([-.\deE]+)\)/).slice(1).map(Number);
      const mouth = moving.mouthTransform.match(/translate\(([-.\deE]+) ([-.\deE]+)\)/).slice(1).map(Number);
      assert.ok(Math.abs(mouth[0] - eye[0] * 0.5) < 1e-9);
      assert.ok(Math.abs(mouth[1] - eye[1] * 0.5) < 1e-9);
      assert.ok(samples.every((sample) => sample.text === ""));
      const box = samples.find((sample) => sample.box)?.box;
      assert.ok(box && Math.abs(box.width - 200) < 0.2 && Math.abs(box.height - 200) < 0.2);
      assert.ok(box && Math.abs(box.x - 95) < 0.2 && Math.abs(box.y - 125) < 0.5);
      assert.ok(samples.some((sample) => /matrix\([^,]+, 0, 0, 0\.\d+/.test(sample.eyeCss)), "blink closed sample exists");
      assert.ok(samples.some((sample, index) => index > 20 && /matrix\([^,]+, 0, 0, 1/.test(sample.eyeCss)), "eyes reopen after blink");
      await H.p.waitForFunction(() => !document.querySelector(".a995bLoading"), null, { timeout: 6000 });
      assert.equal(await H.p.locator(".stage--loginCheck [data-chog-invite]").count(), 1);
      assert.deepEqual(H.errors, []);
      writeFileSync(path.join(out, "measurements.json"), `${JSON.stringify(samples, null, 2)}\n`);
    } finally {
      await H?.close();
    }
  });

  await check("390 reduced-motion: approved static splash only", async () => {
    try {
      H = await launch();
      await H.seedSolo("Honeybun");
      await H.p.setViewportSize({ width: 390, height: 844 });
      await H.p.emulateMedia({ reducedMotion: "reduce" });
      await H.p.goto(`${H.BASE}?a995b-loading=1`, { waitUntil: "domcontentloaded" });
      await H.p.waitForSelector(".a995bLoading");
      const result = await H.p.evaluate(() => ({
        objectVisibility: getComputedStyle(document.querySelector(".a995bLoading object")).visibility,
        text: document.querySelector(".a995bLoading").innerText,
      }));
      assert.deepEqual(result, { objectVisibility: "hidden", text: "" });
      await H.p.screenshot({ path: path.join(out, "a995b_390_reduced.png") });
      assert.deepEqual(H.errors, []);
    } finally {
      await H?.close();
    }
  });
}

if (failures) process.exitCode = 1;
else console.log("A-995-b implemented-scope checks complete");
