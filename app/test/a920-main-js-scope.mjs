// [A-920] Node-only scope pin: main.js differs from the pre-A-920 copy ONLY inside nameSceneLayout / fitNameScene / inviteGroupScale / returnLayout and the eight A-920 keyframe const lines
// (Cowork 2026-10-08 20:42 + 20:55: "0 other main.js lines"). Skips when the private pre copy is absent (public clone).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { hasPre, restorePreA920, A920_PRE } from "./helpers/a920-restore.mjs";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
if (!hasPre()) { console.log("SKIP  a920 main.js scope (no _private pre copy)"); process.exit(0); }
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const pre = readFileSync(A920_PRE, "utf8");
let fail = 0;
const check = (n, f) => { try { f(); console.log(`PASS  ${n}`); } catch (e) { console.log(`FAIL  ${n}\n      ${String(e.message).split("\n")[0].slice(0, 300)}`); fail += 1; } };
check("pre-A-920 copy = the BASE main.js (sha 94726fcc...)", () => assert.equal(createHash("sha256").update(pre).digest("hex"), "94726fcc98e3b8ca94d4682a94bea56aacea0a9f87c94b31c8c8d5ae56b1fcc2"));
// [A-918 RE-PIN · A-923 merge] pre-A-918 baseline: restorePreA920(MAIN) == pre (the BASE main.js). A-918 merged first (A-923 order) adds one [A-905] block change;
// the expected text is now the BASE + A-918 copy (receipts/A923_closeout_plan/pre/app_src_main.post-A918.js, sha pinned below).
const POST918 = path.join(REPO, "_private/ops/receipts/A923_closeout_plan/pre/app_src_main.post-A918.js");
const post918 = readFileSync(POST918, "utf8");
check("post-A-918 copy = BASE + A-918 (sha 47d062ac...)", () => assert.equal(createHash("sha256").update(post918).digest("hex"), "47d062ac16fa6c28de2850d97aa0a5797ef108542f9c4272b13cd7334ef06ecf"));
check("main.js outside the four A-920 functions and eight const lines == pre-A-920 + A-918 (0 other lines)", () => assert.equal(restorePreA920(MAIN.replace(/^\/\/ ── \[A-960\] invite link → first grant\.[\s\S]*?^\/\/ ── \[A-960\] end invite link → first grant ──\n\n?/m, "").replace(/^\/\/ ── \[A-966\] Gift on the shared fork[\s\S]*?^\/\/ ── \[A-966\] end Gift on the shared fork ──\n/m, "").replace(/^\/\/ ── \[A-974\] Fork app entry[\s\S]*?^\/\/ ── \[A-974\] end fork app entry ──\n/m, "") /* [A-974 re-pin] the one [A-974] fork entry block is cut too; pre-A-974: no third cut */ /* [A-960 re-pin] cut the one [A-960] invite block first; pre-A-960: MAIN · [A-966 re-pin] the one [A-966] fork Gift block is cut too; pre-A-966: no second cut */), post918));
check("every changed function carries an [A-920] marker comment", () => { assert.ok((MAIN.match(/\[A-920/g) || []).length >= 8); });
process.exit(fail ? 1 : 0);
