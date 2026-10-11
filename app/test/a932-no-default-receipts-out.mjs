// [A-932 guard · Owner 2026-10-10 "다음에 이런사고 안나게만 부탁해"] No test under app/test may WRITE into $ARASO_PRIVATE_BASE/ops/receipts by default.
// A file is flagged when it (a) has a write call (writeFileSync / mkdirSync / copyFileSync / screenshot({ path ...)) and (b) assigns an output-looking
// name (OUT, OUT_DIR, outDir, RAW_DIR, RECEIPT, RECEIPTS, out) to a receipts path, or defaults a function parameter to one. Read-only references
// (pre copies, raw inputs, BEFORE files) are not flagged. Output must go through helpers/test-out.mjs testOutDir(name, explicitOut).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath, PRIVATE_DIR } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)
const DIR = path.dirname(fileURLToPath(import.meta.url));
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith(".mjs")) files.push(p); } };
walk(DIR);
const WRITE = /writeFileSync|mkdirSync|copyFileSync|screenshot\(\s*\{\s*path/;
// [A-1033] a receipts path is now either "<private dir>/ops/receipts" or privatePath("ops/receipts…") (helpers/private-base.mjs) — both are flagged.
const RECEIPTS_PATH = `(?:${PRIVATE_DIR}\\/|privatePath\\(\\s*["'\`])ops\\/receipts`;
const OUT_ASSIGN = new RegExp(`\\b(?:const|let|var)\\s+(?:OUT|OUT_DIR|outDir|RAW_DIR|RECEIPTS?|out)\\s*=[^;\\n]*${RECEIPTS_PATH}`);
const PARAM_DEFAULT = new RegExp(`\\(\\s*(?:outDir|out|dir|OUT)\\s*=\\s*[^)]*${RECEIPTS_PATH}`);
const bad = [];
for (const f of files) {
  if (f.endsWith("a932-no-default-receipts-out.mjs")) continue;
  const src = readFileSync(f, "utf8");
  if (!WRITE.test(src)) continue;
  src.split("\n").forEach((line, i) => {
    if (line.trimStart().startsWith("//")) return;
    if (OUT_ASSIGN.test(line) || PARAM_DEFAULT.test(line)) bad.push(`${path.relative(DIR, f)}:${i + 1}`);
  });
}
try { assert.deepEqual(bad, []); console.log(`PASS  no test writes into the private receipts dir by default (${files.length} files scanned)`); }
catch { console.log(`FAIL  default receipts output found (use helpers/test-out.mjs testOutDir):\n      ${bad.join("\n      ")}`); process.exit(1); }
