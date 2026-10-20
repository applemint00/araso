// [A-1435 · 10-20 고아 vite 40 (OUTBOX 29183)] a test that dies mid-run (SIGTERM · SIGINT) must not leave the vite that
// helpers/a803-browser.mjs launch() spawned: a child node calls launch(), the vite it spawned is found, the child is sent SIGTERM, and that
// vite must be gone. The normal close() path and the A803_BASE_URL reuse path (no server spawned) are not touched by the guard.
// Any vite this test finds still alive at the end is killed here, so a failing run leaves nothing behind either.
//   ARASO_PRIVATE_BASE=<private dir> node app/test/a1435-helper-no-orphan.mjs
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { harnessPresent } from "./helpers/a803-browser.mjs";

if (!harnessPresent()) { console.log("SKIP  a1435 helper no orphan — playwright lives in the private harness (public checkout)"); process.exit(0); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const children = (pid) => { try { return execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number); } catch { return []; } };
const command = (pid) => { try { return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim(); } catch { return ""; } };
let pass = 0, fail = 0;
const check = (ok, label) => { if (ok) { pass += 1; console.log(`PASS  ${label}`); } else { fail += 1; console.log(`FAIL  ${label}`); } };

const dir = mkdtempSync(path.join(tmpdir(), "a1435-"));
const childFile = path.join(dir, "child.mjs");
writeFileSync(childFile, `import { launch } from ${JSON.stringify(pathToFileURL(path.join(HERE, "helpers/a803-browser.mjs")).href)};\nawait launch();\nconsole.log("READY " + process.pid);\nsetInterval(() => {}, 1000);\n`);
const env = { ...process.env }; delete env.A803_BASE_URL; delete env.A803_BASE_FORK; // this test needs launch() to spawn its own vite
const child = spawn(process.execPath, [childFile], { env, stdio: ["ignore", "pipe", "pipe"] });
let out = ""; child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
const exited = new Promise((r) => child.once("exit", (code, signal) => r({ code, signal })));
const t0 = Date.now();
while (!/READY \d+/.test(out) && Date.now() - t0 < 60000 && child.exitCode === null) await sleep(100);
const vites = children(child.pid).filter((p) => /node_modules\/\.bin\/vite/.test(command(p)));
check(vites.length === 1, `launch() spawned one vite under the child (${vites.length} · ${out.trim().slice(-120)})`);
child.kill("SIGTERM");
const end = await Promise.race([exited, sleep(10000).then(() => null)]);
await sleep(1500);
const left = vites.filter(alive);
// not judged: Playwright's own SIGTERM handler closes the browser without exiting, so a child with a keep-alive timer can outlive the signal
console.log(`NOTE  the child after SIGTERM: ${end ? `ended · code ${end.code} · signal ${end.signal}` : "still running (Playwright's SIGTERM handler does not exit)"}`);
check(vites.length === 1 && left.length === 0, `no vite left after the child died (${left.length ? `left: ${left.map((p) => `${p} ${command(p).slice(0, 80)}`).join(" | ")}` : "gone"})`);
for (const p of left) { try { process.kill(p, "SIGKILL"); } catch {} }
if (child.exitCode === null && child.signalCode === null) { try { child.kill("SIGKILL"); } catch {} await Promise.race([exited, sleep(3000)]); } // a child still alive is ended here (its pipes would hold this test open)
if (fail) { console.log(`FAIL a1435 helper no orphan (${fail} FAIL / ${pass} PASS)`); process.exit(1); }
console.log(`PASS a1435 helper no orphan (${pass} PASS)`);
process.exit(0);
