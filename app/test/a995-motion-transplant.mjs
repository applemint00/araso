import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { a995EyeOffset, A995_EYE_MAX, A995_EYE_RANGE, A995_TOUCH_HOLD_MS } from "../src/a995-eye-look.js";

const rd = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const MAIN = rd("app/src/main.js");
const CSS = rd("app/src/style.css");
const SCREENS = rd("app/src/a911-screens.js");
const EYES = rd("app/src/a995-eye-look.js");

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}: ${error.message}`); }
}

await check("① Sleep-strength breath only: x .0091 / y .026, existing 4.4 s and reduced-motion stop", () => {
  assert.match(MAIN, /const AMB_BREATH_S = 4\.4;/);
  assert.match(MAIN, /1 - 0\.0091 \* b/);
  assert.match(MAIN, /1 \+ 0\.026 \* b/);
  assert.match(MAIN, /if \(reduced\) \{ if \(el\.style\.transform\) el\.style\.transform = ""; return; \}/);
  assert.match(MAIN, /const AMB_BLINK_MS = 3200;/);
  assert.match(MAIN, /transform: "scaleY\(\.08\)"/);
});

await check("② A-766 constants and capped vector math", () => {
  assert.equal(A995_EYE_MAX, 10);
  assert.equal(A995_EYE_RANGE, 60);
  assert.equal(A995_TOUCH_HOLD_MS, 400);
  assert.deepEqual(a995EyeOffset({ x: 0, y: 0 }, 30), { x: 0, y: 0 });
  assert.deepEqual(a995EyeOffset({ x: 1, y: 0 }, 30), { x: 5, y: 0 });
  assert.deepEqual(a995EyeOffset({ x: 0.01, y: 0 }, 30), { x: 5, y: 0 });
  assert.deepEqual(a995EyeOffset({ x: 60, y: 0 }, 60), { x: 10, y: 0 });
  assert.deepEqual(a995EyeOffset({ x: 600, y: 0 }, 600), { x: 10, y: 0 });
  const diagonal = a995EyeOffset({ x: 60, y: 60 }, 60);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 10) < 1e-9);
});

await check("② current Gift markup only gets eye hooks; card actions/copy stay in the existing builder", () => {
  assert.equal((SCREENS.match(/data-a995-gift-eye=/g) || []).length, 2);
  assert.match(SCREENS, /data-a995-gift-eye="front"/);
  assert.match(SCREENS, /piggy_face\.svg" alt="" data-a995-gift-eye="back"/);
  assert.match(EYES, /querySelectorAll\('#eye_L, #eye_R, \.eye'\)/);
  assert.match(EYES, /getScreenCTM/);
  assert.match(EYES, /pointermove/);
  assert.match(EYES, /pointerdown/);
  assert.match(EYES, /pointercancel/);
  assert.match(EYES, /eyes\.length !== 2/);
  assert.match(EYES, /setTimeout\(reset, A995_TOUCH_HOLD_MS\)/);
  assert.doesNotMatch(EYES, /deviceorientation/i);
});

await check("②/③ 120 ms ease-out and reduced-motion still", () => {
  assert.match(CSS, /\.a911-screen\[data-a911="gift"\] \.a995-eye[\s\S]*?transition: transform 120ms ease-out;/);
  assert.match(CSS, /prefers-reduced-motion: reduce[\s\S]*?\.testerIntro__face \.a995-eye[\s\S]*?transform: translate\(0, 0\) scaleY\(1\);/);
});

await check("③ intro keeps 3.2 s blink, registers its existing eyes, then reopens before leave", () => {
  assert.match(MAIN, /const TESTER_INTRO_BLINK_MS = 3200;/);
  assert.match(MAIN, /registerA995InlineFace\(face\)/);
  assert.match(MAIN, /classList\.remove\("is-closed"\), TESTER_INTRO_BLINK_MS - 120/);
  assert.match(CSS, /scaleY\(0\.08\)/);
  assert.match(CSS, /scaleY\(1\)/);
});

if (failures) process.exitCode = 1;
else console.log("A-995 implemented-scope checks complete");
