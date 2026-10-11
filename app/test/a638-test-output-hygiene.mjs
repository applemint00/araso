// [A-638 (reissue of A-637)] TEST OUTPUT HYGIENE — static regression guard.
//   node app/test/a638-test-output-hygiene.mjs [path-to-test-file]
//
// multi-piggy-browser-reopen.mjs used to hard-code OUT_DIR to the historical A-552 phase1
// receipt evidence directory, so every ordinary/full-suite run overwrote that evidence.
// This guard proves (from source) that the general regression test now writes its runtime
// screenshots/results only to a unique per-run OS temp directory and never into any
// `$ARASO_PRIVATE_BASE/ops/receipts/**` path. No browser, no Vite, no writes.
//
// The optional argv[2] lets a reviewer point the same checks at another copy of the file
// (e.g. the pre-repair copy, which must FAIL).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRIVATE_DIR } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "multi-piggy-browser-reopen.mjs");
const src = readFileSync(target, "utf8");
const lines = src.split("\n");
// Code lines only: drop whole-line `//` comments (the file's header cites a receipts path as
// method provenance; that is prose, not an output destination).
const codeLines = lines.filter((l) => !/^\s*\/\//.test(l));
const code = codeLines.join("\n");

let pass = 0;
let fail = 0;
function check(label, cond) {
  if (cond) pass += 1;
  else fail += 1;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}

console.log(`target: ${target}`);

// 1. The historical A-552 evidence path is gone entirely (code and comments).
check(
  "no `A552_pre_design_hardening_close/phase1/evidence` reference anywhere",
  !src.includes("A552_pre_design_hardening_close/phase1/evidence"),
);

// 2. No code line names any receipts path.
check("no code line contains `<private dir>/ops/receipts`", !code.includes(`${PRIVATE_DIR}/ops/receipts`));
check("no code line contains `receipts/`", !/receipts\//.test(code));

// 3. OUT_DIR is derived from mkdtempSync under the OS temp dir (TMPDIR || os.tmpdir()).
const outDecl = code.match(/const\s+OUT_DIR\s*=\s*([^;]+);/);
check("exactly one `const OUT_DIR = ...;` declaration", (code.match(/const\s+OUT_DIR\s*=/g) || []).length === 1 && !!outDecl);
const outInit = outDecl ? outDecl[1] : "";
check("OUT_DIR initializer calls mkdtempSync(", /^\s*mkdtempSync\(/.test(outInit));
check("OUT_DIR initializer roots at process.env.TMPDIR || tmpdir()", /process\.env\.TMPDIR\s*\|\|\s*tmpdir\(\)/.test(outInit));
check("OUT_DIR initializer does not reference REPO_ROOT/APP_DIR/__dirname", !/REPO_ROOT|APP_DIR|__dirname/.test(outInit));
check("mkdtempSync and tmpdir are imported", /import\s*\{[^}]*\bmkdtempSync\b[^}]*\}\s*from\s*"node:fs"/.test(code) && /import\s*\{[^}]*\btmpdir\b[^}]*\}\s*from\s*"node:os"/.test(code));
check("OUT_DIR is never reassigned", !/\bOUT_DIR\s*=[^=]/.test(code.replace(/const\s+OUT_DIR\s*=/, "")));
check("the temp output path is logged", /console\.log\(`[^`]*\$\{OUT_DIR\}/.test(code));

// 4. Every runtime artifact (7 screenshots + results.json) is written under OUT_DIR.
const shotCalls = code.match(/\.screenshot\(([^)]*)\)/g) || [];
const shotUnderOut = shotCalls.filter((c) => /\.screenshot\(\s*path\.join\(\s*OUT_DIR\s*,/.test(c));
check(`all screenshot() calls write under OUT_DIR (${shotUnderOut.length}/${shotCalls.length}, expect 7)`, shotCalls.length === 7 && shotUnderOut.length === 7);
check(
  "results.json is written under OUT_DIR",
  /writeFileSync\(\s*path\.join\(\s*OUT_DIR\s*,\s*"results\.json"\s*\)/.test(code),
);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — pass ${pass} · fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
