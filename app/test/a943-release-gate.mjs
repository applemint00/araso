// [A-943] Release gate (VITE_ARASO_RELEASE_LEVEL). Node only, no network.
// Level: unset / empty / unreadable = 1 (fail closed) · vite dev server (DEV true) without a value = 2 (the test harness mode) · an explicit value wins.
// Level 1 closes every entry after the First Journey; level 2 opens them. main.js asks releaseAllows() at exactly the listed lines and nowhere else.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { RELEASE_FEATURES, RELEASE_LEVEL, journeyFeatureOpen, releaseAllows, resolveReleaseLevel } from "../src/release-gate.js";

let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const main = readFileSync(path.join(SRC, "main.js"), "utf8");
const FEATURES = ["second", "afterSecond", "gift"];

// ── level ──
check("no env at all (node: import.meta.env undefined) → level 1", () => { assert.equal(RELEASE_LEVEL, 1); assert.equal(resolveReleaseLevel(undefined), 1); assert.equal(resolveReleaseLevel(null), 1); });
check("production build without the value (DEV false) → 1", () => { assert.equal(resolveReleaseLevel({ DEV: false, PROD: true, MODE: "production" }), 1); });
check("production build, empty / blank value → 1", () => { for (const v of ["", "  "]) assert.equal(resolveReleaseLevel({ DEV: false, VITE_ARASO_RELEASE_LEVEL: v }), 1); });
check("unreadable value → 1 even on the dev server", () => { for (const v of ["0", "-1", "two", "2.5", "1e3", "02", "true"]) assert.equal(resolveReleaseLevel({ DEV: true, VITE_ARASO_RELEASE_LEVEL: v }), 1, v); });
check("dev server (DEV true) without a value → 2 (test harness default)", () => { assert.equal(resolveReleaseLevel({ DEV: true, MODE: "a172-local" }), 2); assert.equal(resolveReleaseLevel({ DEV: true, MODE: "development" }), 2); });
check("DEV must be exactly true (\"true\" string does not count)", () => { assert.equal(resolveReleaseLevel({ DEV: "true" }), 1); });
check("explicit value wins in both directions", () => {
  assert.equal(resolveReleaseLevel({ DEV: false, VITE_ARASO_RELEASE_LEVEL: "2" }), 2);
  assert.equal(resolveReleaseLevel({ DEV: false, VITE_ARASO_RELEASE_LEVEL: " 3 " }), 3);
  assert.equal(resolveReleaseLevel({ DEV: true, VITE_ARASO_RELEASE_LEVEL: "1" }), 1);
});

// ── allows ──
check("features = exactly second · afterSecond · gift, each needs level 2", () => { assert.deepEqual(Object.keys(RELEASE_FEATURES).sort(), [...FEATURES].sort()); for (const f of FEATURES) assert.equal(RELEASE_FEATURES[f], 2); assert.ok(Object.isFrozen(RELEASE_FEATURES)); });
check("level 1 → every entry closed", () => { for (const f of FEATURES) assert.equal(releaseAllows(f, 1), false, f); });
check("level 2 and above → every entry open", () => { for (const lv of [2, 3]) for (const f of FEATURES) assert.equal(releaseAllows(f, lv), true, `${f}@${lv}`); });
check("default level (this process = 1) → closed", () => { for (const f of FEATURES) assert.equal(releaseAllows(f), false, f); });
check("unknown feature / bad level → closed", () => {
  for (const f of ["", "explore", "toString", "__proto__", "constructor", undefined]) assert.equal(releaseAllows(f, 9), false, String(f));
  for (const lv of [NaN, "2", null, 2.5]) assert.equal(releaseAllows("second", lv), false, String(lv));
});

// ── main.js: one helper, two marked blocks (boot · Second entries), original bodies untouched ──
const span = (a, b) => { const i = main.indexOf(a), j = main.indexOf(b); assert.ok(i > 0 && j > i, a); assert.equal(main.indexOf(a, i + 1), -1, `one ${a}`); return [i, j + b.length]; };
const [bootS, bootE] = span("// ── [A-943] Release gate · boot", "// ── [A-943] end boot ──");
const [secS, secE] = span("// ── [A-943] Release gate · Second entries", "// ── [A-943] end Second entries ──");
const boot = main.slice(bootS, bootE), sec = main.slice(secS, secE);
// [A-948 RE-PIN] main.js asks journeyFeatureOpen(feature, { level, profile }) at the same 4 places. pre-A-948: /releaseAllows\("([A-Za-z]+)"\)/g
const calls = [...main.matchAll(/journeyFeatureOpen\("([A-Za-z]+)", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\)/g)].map((m) => m[1]);
check("main.js imports releaseAllows from ./release-gate.js only", () => { assert.match(main, /^import \{ releaseAllows \} from "\.\/release-gate\.js";/m); });
check("gate calls remain in declared release blocks plus opt-in A1172 bell", () => {
  // [A-948 RE-PIN] the gate call is journeyFeatureOpen; pre-A-948: releaseAllows(
  // [A-966 RE-PIN] the one [A-966] fork Gift block asks journeyFeatureOpen("forkGift") (release-gate.js names it for exactly this); it is cut here and pinned below.
  const outside = (main.slice(0, secS) + main.slice(secE, bootS) + main.slice(bootE)).replace(/^\/\/ ── \[A-966\] Gift on the shared fork[\s\S]*?^\/\/ ── \[A-966\] end Gift on the shared fork ──\n/m, "").replace(/^\/\/ ── \[A-974\] Fork app entry[\s\S]*?^\/\/ ── \[A-974\] end fork app entry ──\n/m, "") /* [A-974 re-pin] the one [A-974] fork entry block (journeyFeatureOpen "second" ×1, pinned below); pre-A-974: no cut */.replace(/^import \{ releaseAllows \}.*$/m, "").replace(/^import \{ storedJourney \}.*$/m, "").replace(/\/\/[^\n]*/g, "");
  assert.equal(/(releaseAllows|journeyFeatureOpen)\(/.test(outside.replace(/function a1172BellEnabled\(\) \{[\s\S]*?\n\}/, "")), false);
  assert.match(main, /function a1172BellEnabled\(\) \{[\s\S]*?VITE_ARASO_TEST_REPEAT_BELL === "1"[\s\S]*?onForkProfile\(CHAIN_PROFILE\)[\s\S]*?journeyFeatureOpen\("second"/);
});
// [A-966 RE-PIN] + forkGift ×1 inside the [A-966] block. pre-A-966: ["afterSecond", "gift", "second", "second"]
check("gate calls = afterSecond ×1 · forkGift ×1 ([A-966] block) · gift ×1 · second ×2 + second ×1 ([A-974] block) + opt-in bell ×1" /* [A-974 re-pin] pre-A-974 title: … second ×2 (nothing else) */, () => {
  assert.deepEqual(calls.sort(), ["afterSecond", "forkGift", "gift", "second", "second", "second", "second"]); // [A-974 re-pin] + second ×1 in the [A-974] block. pre-A-974: ["afterSecond", "forkGift", "gift", "second", "second"]
  const blk974 = main.match(/^\/\/ ── \[A-974\] Fork app entry[\s\S]*?^\/\/ ── \[A-974\] end fork app entry ──\n/m)?.[0] || ""; // [A-974 re-pin]
  assert.equal([...blk974.matchAll(/journeyFeatureOpen\(/g)].length, 1); // [A-974 re-pin]
  assert.match(blk974, /journeyFeatureOpen\("second", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\)/); // [A-974 re-pin]
  const blk = main.match(/^\/\/ ── \[A-966\] Gift on the shared fork[\s\S]*?^\/\/ ── \[A-966\] end Gift on the shared fork ──\n/m)?.[0] || "";
  assert.equal([...blk.matchAll(/journeyFeatureOpen\(/g)].length, 1);
  assert.match(blk, /journeyFeatureOpen\("forkGift", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\)/);
});
check("the build value is read only in release-gate.js", () => { assert.equal(/env\??\.VITE_ARASO_RELEASE_LEVEL/.test(main), false); });
check("boot block: stored Second-done mark dropped and Gift link released below level 2", () => {
  // [A-948 RE-PIN] pre-A-948: if (!releaseAllows("afterSecond")) … / if (!releaseAllows("gift")) …
  assert.match(boot, /^if \(!journeyFeatureOpen\("afterSecond", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\)\) state\.secondJourneyCompletedOnce = false;/m);
  assert.match(boot, /^if \(!journeyFeatureOpen\("gift", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\)\) pendingGiftClaim = null;/m);
});
check("boot block runs after the Gift link read and before offerGiftPaperAtBoot / the first render", () => {
  const read = main.indexOf("const pendingRead = readClaimFragment(location.href);");
  const offer = main.indexOf("if (offerGiftPaperAtBoot()) homeLifeLeft");
  const first = main.indexOf("\nrender();\nstartTesterIntro();");
  assert.ok(read > 0 && read < bootS && bootE < offer && offer < first);
});
check("Second-entry block wraps openSecondJourneyExplore and a891ArmPostFileQuietHome behind \"second\"", () => {
  // [A-948 RE-PIN] pre-A-948: releaseAllows("second") in both wrappers
  assert.match(sec, /openSecondJourneyExplore = \(\.\.\.args\) => \(journeyFeatureOpen\("second", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\) \? a943BaseOpenSecondJourneyExplore\(\.\.\.args\) : undefined\);/);
  assert.match(sec, /a891ArmPostFileQuietHome = \(\.\.\.args\) => \{\n\s+if \(journeyFeatureOpen\("second", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\)\) return a943BaseArmPostFileQuietHome\(\.\.\.args\);/);
});
check("Second-entry block sits after both declarations and before the first render", () => {
  for (const n of ["openSecondJourneyExplore", "a891ArmPostFileQuietHome", "a891HomeChogTap"]) { const i = main.indexOf(`function ${n}(`); assert.ok(i > 0 && i < secS, n); }
  assert.ok(main.indexOf("let a891CueChog") < secS && secE < main.indexOf("\nrender();\nstartTesterIntro();"));
});

// ── behaviour of the blocks (vm over their real text) ──
// [A-948 RE-PIN] the blocks call journeyFeatureOpen(f, { level, profile }); the vm passes the level and a profile (fork unless told). pre-A-948: releaseAllows: (f) => releaseAllows(f, level)
const runBlocks = (level, profile = { id: "monad-fork", status: "active" }) => {
  const log = [];
  const ctx = {
    journeyFeatureOpen: (f, o) => journeyFeatureOpen(f, { ...o, level }), RELEASE_LEVEL: level, CHAIN_PROFILE: profile,
    registerJourneySessionDisposer: () => {}, endActiveSession: () => {},
    state: { secondJourneyCompletedOnce: true },
    pendingGiftClaim: { giftId: "g", token: "t" },
    a891CueChog: "chog",
    openSecondJourneyExplore: () => { log.push("explore"); return "opened"; },
    a891ArmPostFileQuietHome: () => { log.push("arm"); return "armed"; },
  };
  vm.createContext(ctx);
  vm.runInContext(`${sec}\n${boot}`, ctx); // the names above are context globals, so the wrappers replace them as in the module
  return { ctx, log, explore: ctx.openSecondJourneyExplore(), arm: ctx.a891ArmPostFileQuietHome() };
};
check("vm level 1: Second-done false · Gift link null · Explore and the cue not called", () => {
  const r = runBlocks(1);
  assert.equal(r.ctx.state.secondJourneyCompletedOnce, false); assert.equal(r.ctx.pendingGiftClaim, null);
  assert.deepEqual(r.log, []); assert.equal(r.explore, undefined); assert.equal(r.arm, undefined); assert.equal(r.ctx.a891CueChog, null);
});
check("[A-948] vm level 2 on the TESTNET profile: Second closed (root \"/\" never opens the old Second UI) · Gift link kept (level only)", () => {
  const r = runBlocks(2, { id: "monad-testnet", status: "active" });
  assert.equal(r.ctx.state.secondJourneyCompletedOnce, false); assert.deepEqual(r.ctx.pendingGiftClaim, { giftId: "g", token: "t" });
  assert.deepEqual(r.log, []); assert.equal(r.explore, undefined); assert.equal(r.arm, undefined);
});
check("vm level 2 on the fork profile: nothing changed · both originals called through", () => {
  const r = runBlocks(2);
  assert.equal(r.ctx.state.secondJourneyCompletedOnce, true); assert.deepEqual(r.ctx.pendingGiftClaim, { giftId: "g", token: "t" });
  assert.deepEqual(r.log, ["explore", "arm"]); assert.equal(r.explore, "opened"); assert.equal(r.arm, "armed");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
