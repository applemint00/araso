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
//   ARASO_TEST_TIMEOUT_MS  per-suite timeout. Default 180000 (node mode), 600000 when ARASO_TEST_BROWSER=1.
//
// Each suite runs in its own process group. On timeout the whole group is killed (SIGTERM, then SIGKILL),
// and the group is swept again after the suite exits, so a vite/Chrome grandchild a suite leaked can
// never survive into the next suite (port collisions).
// Args: any argument is a substring filter on the file name (e.g. `npm test -- receipt`).
//
// Exit code: 1 if any FAIL, else 0.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.basename(fileURLToPath(import.meta.url));
const WANT_BROWSER = process.env.ARASO_TEST_BROWSER === "1";
// setTimeout treats delays above 2^31-1 ms as 1 ms, so clamp the override.
const TIMEOUT_MS = Number(process.env.ARASO_TEST_TIMEOUT_MS) > 0 ? Math.min(Number(process.env.ARASO_TEST_TIMEOUT_MS), 2 ** 31 - 1) : WANT_BROWSER ? 600000 : 180000;
const KILL_GRACE_MS = 2000;
const filters = process.argv.slice(2).filter(Boolean);

// A suite needs a browser/dev server when it launches headless Chrome over CDP or starts vite on a port.
const BROWSER_MARKER = /remote-debugging-port|["']--strictPort["']|node_modules\/\.bin\/vite/;
// Suites that already carry their own switch: `A667_NODE_ONLY`, `NODE_ONLY`, ...
const NODE_ONLY_ENV = /process\.env\.([A-Z0-9_]*NODE_ONLY)\b/g;

const files = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".mjs") && f !== SELF)
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)))
  .sort();

// [A-895 P-C / L9] The three relayer gift-gas suites (node only: no port bind, no network, no keys) run in `npm test` too.
// They live under relayer/test, so they are listed explicitly (the other relayer suites bind a port or are launch-gate checks
// run by `npm run test:security`). A row name is the repo-relative path so it cannot be confused with an app/test file.
const RELAYER_TEST_DIR = path.resolve(TEST_DIR, "..", "..", "relayer", "test");
export const RELAYER_SUITES = Object.freeze(["gift-gas-ledger.mjs", "gift-gas-service.mjs", "gift-gas-route.mjs", "gift-sponsor-service.mjs", "gift-sponsor-reconcile.mjs", "gift-sponsor-preflight.mjs", "gift-sponsor-vercel.mjs"]); // [A-906] + sponsor service; [A-913] + reconcile / preflight / vercel (pre-A-913 baseline: ends at gift-sponsor-service.mjs)
// If relayer/test does not exist at all (this runner copied into an isolated harness tree, e.g. run-all-process-cleanup.mjs) there is
// nothing to list. In the real repo the directory exists, so a missing listed suite is a readFileSync error = a hard failure, never a skip.
// [L-1] The only exception is the isolated harness copy (run-all-process-cleanup.mjs), recognised by its temp-dir name; anywhere else a
// missing relayer/test directory is a hard failure, never a silent skip.
const ISOLATED_HARNESS_COPY = path.basename(path.resolve(TEST_DIR, "..", "..")).startsWith("araso-runall-");
if (!existsSync(RELAYER_TEST_DIR) && !ISOLATED_HARNESS_COPY) {
  console.log("FAIL  relayer/test directory is missing — the three relayer gift-gas suites cannot run");
  process.exit(1);
}
const relayerFiles = (existsSync(RELAYER_TEST_DIR) ? RELAYER_SUITES : [])
  .map((f) => `relayer/test/${f}`)
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)));
const abs = (f) => (f.startsWith("relayer/test/") ? path.join(RELAYER_TEST_DIR, f.slice("relayer/test/".length)) : path.join(TEST_DIR, f));

// Run one suite in its own process group. Resolves { status, signal, error, out, timedOut }.
function runSuite(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [abs(file)], {
      cwd: path.resolve(TEST_DIR, "..", ".."),
      env,
      detached: true, // new process group; pgid === child.pid
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let size = 0;
    const onData = (d) => { size += d.length; chunks.push(d); while (size > 64 * 1024 * 1024 && chunks.length > 1) size -= chunks.shift().length; };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const killGroup = (sig) => { try { process.kill(-child.pid, sig); } catch {} };
    let timedOut = false, spawnError = null, settled = false, graceTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      graceTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
      graceTimer.unref();
    }, TIMEOUT_MS);
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer); // never signal a pgid that may be reused after exit
      killGroup("SIGKILL"); // sweep leaked grandchildren (vite, Chrome) after exit
      resolve({ status, signal, error: spawnError, timedOut, out: Buffer.concat(chunks).toString("utf8") });
    };
    child.on("error", (e) => { spawnError = e; finish(null, null); });
    child.on("close", (status, signal) => finish(status, signal));
  });
}

const rows = [];
for (const file of [...files, ...relayerFiles]) {
  const src = readFileSync(abs(file), "utf8");
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
  const r = await runSuite(file, env);
  const ms = Date.now() - started;
  const out = r.out;
  if (r.timedOut || r.error || r.status !== 0) {
    const why = r.timedOut ? `timeout after ${TIMEOUT_MS}ms` : r.error ? String(r.error.message) : `exit ${r.status}${r.signal ? ` (${r.signal})` : ""}`;
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
  for (const r of rows.filter((x) => x.status === "SKIP")) console.log(`  - ${r.file}: ${r.note}`);
}
if (count("FAIL") > 0) {
  console.log("FAILED:");
  for (const r of rows.filter((x) => x.status === "FAIL")) console.log(`  - ${r.file}: ${r.note}`);
}
process.exit(count("FAIL") > 0 ? 1 : 0);
