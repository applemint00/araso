// Proves run-all.mjs kills a suite's whole process group (grandchildren included) on timeout and after exit.
// No browser needed: it copies run-all.mjs next to fake suites in a temp dir and runs it there.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(path.join(os.tmpdir(), "araso-runall-"));
const dir = path.join(root, "app", "test");
mkdirSync(dir, { recursive: true });
copyFileSync(path.join(here, "run-all.mjs"), path.join(dir, "run-all.mjs"));

const spawnGrandchild = (pidFile) => `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const g = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
`;
const pidHang = path.join(root, "hang.pid");
const pidLeak = path.join(root, "leak.pid");
writeFileSync(path.join(dir, "fake-hang.mjs"), spawnGrandchild(pidHang) + `setInterval(() => {}, 1000);\n`);
writeFileSync(path.join(dir, "fake-leak.mjs"), spawnGrandchild(pidLeak) + `setTimeout(() => process.exit(0), 300);\n`);
writeFileSync(path.join(dir, "fake-pass.mjs"), `console.log("ok");\n`);
writeFileSync(path.join(dir, "fake-fail.mjs"), `process.exit(3);\n`);
writeFileSync(path.join(dir, "fake-skip.mjs"), `// remote-debugging-` + `port\nprocess.exit(0);\n`);

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`); if (!ok) failed++; };

const started = Date.now();
const r = spawnSync(process.execPath, [path.join(dir, "run-all.mjs")], {
  env: { ...process.env, ARASO_TEST_TIMEOUT_MS: "1500", ARASO_TEST_BROWSER: "" },
  encoding: "utf8",
  timeout: 60000,
});
const out = `${r.stdout}${r.stderr}`;
await sleep(500);

check("runner exits 1 (a FAIL is present)", r.status === 1, `status=${r.status}\n${out}`);
check("hanging suite reported as timeout FAIL", /FAIL  fake-hang\.mjs  — timeout after 1500ms/.test(out), out);
check("hang took about the timeout, not forever", Date.now() - started < 30000);
check("exit-3 suite reported FAIL", /FAIL  fake-fail\.mjs  — exit 3/.test(out), out);
check("clean suite PASS", /PASS  fake-pass\.mjs/.test(out), out);
check("leaky suite PASS (exit 0 is not reclassified)", /PASS  fake-leak\.mjs/.test(out), out);
check("browser suite SKIP with reason in final list", /SKIPPED \(not run\):\n  - fake-skip\.mjs: needs headless Chrome/.test(out), out);
check("SUMMARY counts", /files=5  PASS=2 \(node-only partial=0\)  SKIP=1  FAIL=2/.test(out), out);
check("grandchild of timed-out suite is dead", existsSync(pidHang) && !alive(Number(readFileSync(pidHang, "utf8"))));
check("grandchild leaked by exited suite is dead", existsSync(pidLeak) && !alive(Number(readFileSync(pidLeak, "utf8"))));

for (const f of [pidHang, pidLeak]) { try { process.kill(Number(readFileSync(f, "utf8")), "SIGKILL"); } catch {} }
rmSync(root, { recursive: true, force: true });
if (failed) { console.log(`run-all-runner: ${failed} FAILED`); process.exit(1); }
console.log("run-all-runner: PASS");
