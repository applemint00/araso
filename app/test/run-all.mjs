// [A-684] Root test entry: `npm test` -> node app/test/run-all.mjs
//
// Runs every app/test/*.mjs (except this file) as its own `node` process and accounts for each one
// explicitly as PASS / SKIP / FAIL. It never edits a suite, never rewrites a pin, and never turns a
// failure into a pass.
//
//   PASS  exit code 0.  If the suite has an `*_NODE_ONLY` switch and the browser part was not requested,
//         the row is tagged "(node-only: browser part skipped inside the suite)" so a partial PASS is
//         never presented as a full one.
//   SKIP  the suite needs a local browser/dev-server (headless Chrome + vite on a local port) and has no
//         NODE_ONLY switch of its own, and browsers were not requested. Not run. Reason printed.
//   FAIL  non-zero exit, spawn error, or timeout.
//
// Env:
//   ARASO_TEST_BROWSER=1   also run the browser/dev-server suites (needs Chrome + local port binding).
//   ARASO_TEST_TIMEOUT_MS  per-suite timeout (default 180000).
// Args: any argument is a substring filter on the file name (e.g. `npm test -- receipt`).
//
// Exit code: 1 if any FAIL, else 0.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.basename(fileURLToPath(import.meta.url));
const WANT_BROWSER = process.env.ARASO_TEST_BROWSER === "1";
const TIMEOUT_MS = Number(process.env.ARASO_TEST_TIMEOUT_MS) > 0 ? Number(process.env.ARASO_TEST_TIMEOUT_MS) : 180000;
const filters = process.argv.slice(2).filter(Boolean);

// A suite needs a browser/dev server when it launches headless Chrome over CDP or starts vite on a port.
const BROWSER_MARKER = /remote-debugging-port|["']--strictPort["']|node_modules\/\.bin\/vite/;
// Suites that already carry their own switch: `A667_NODE_ONLY`, `NODE_ONLY`, ...
const NODE_ONLY_ENV = /process\.env\.([A-Z0-9_]*NODE_ONLY)\b/g;

const files = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".mjs") && f !== SELF)
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)))
  .sort();

const rows = [];
for (const file of files) {
  const src = readFileSync(path.join(TEST_DIR, file), "utf8");
  const switches = [...new Set([...src.matchAll(NODE_ONLY_ENV)].map((m) => m[1]))];
  const needsBrowser = BROWSER_MARKER.test(src);
  const env = { ...process.env };
  let note = "";

  if (needsBrowser && !WANT_BROWSER) {
    if (switches.length === 0) {
      rows.push({ file, status: "SKIP", note: "needs headless Chrome + local dev server (ARASO_TEST_BROWSER=1 to run)" });
      console.log(`SKIP  ${file}  — ${rows[rows.length - 1].note}`);
      continue;
    }
    for (const s of switches) env[s] = "1";
    note = "node-only: browser part skipped inside the suite";
  }

  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(TEST_DIR, file)], {
    cwd: path.resolve(TEST_DIR, "..", ".."),
    env,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (r.error || r.status !== 0) {
    const why = r.error ? (r.error.code === "ETIMEDOUT" ? `timeout after ${TIMEOUT_MS}ms` : String(r.error.message)) : `exit ${r.status}${r.signal ? ` (${r.signal})` : ""}`;
    rows.push({ file, status: "FAIL", note: why, ms });
    console.log(`FAIL  ${file}  — ${why}`);
    const tail = out.trim().split("\n").slice(-12).join("\n");
    if (tail) console.log(tail.split("\n").map((l) => `        ${l}`).join("\n"));
    continue;
  }
  rows.push({ file, status: "PASS", note, ms, partial: note !== "" });
  console.log(`PASS  ${file}${note ? `  (${note})` : ""}  ${ms}ms`);
}

const count = (s) => rows.filter((r) => r.status === s).length;
const partial = rows.filter((r) => r.status === "PASS" && r.partial).length;
console.log("");
console.log(`SUMMARY  files=${rows.length}  PASS=${count("PASS")} (node-only partial=${partial})  SKIP=${count("SKIP")}  FAIL=${count("FAIL")}`);
if (count("SKIP") > 0) {
  console.log("SKIPPED (not run):");
  for (const r of rows.filter((x) => x.status === "SKIP")) console.log(`  - ${r.file}`);
}
if (count("FAIL") > 0) {
  console.log("FAILED:");
  for (const r of rows.filter((x) => x.status === "FAIL")) console.log(`  - ${r.file}: ${r.note}`);
}
process.exit(count("FAIL") > 0 ? 1 : 0);
