import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import path from "node:path";
import { getAddress } from "viem";
import { forkGiftReadyMessage } from "../src/fork-gift-worker.mjs";

// Public address fixtures only; production reuses the runtime signer, never derives another key.
const lower = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const checksum = getAddress(lower);
for (const address of [lower, checksum]) {
  const ready = forkGiftReadyMessage(address);
  assert.deepEqual(Object.keys(ready).sort(), ["sponsor", "type"]);
  assert.deepEqual(ready, { type: "fork-gift-ready", sponsor: checksum });
}
const badChecksum = checksum.replace("E", "e");
assert.notEqual(badChecksum, checksum);
const invalid = [undefined, null, {}, [], 1, "", "0x", lower.slice(0, -1), lower + "0", " " + lower, lower + "\n", badChecksum, "0x" + "gg".repeat(20), "0x" + "ab".repeat(32)];
for (const value of invalid) assert.throws(() => forkGiftReadyMessage(value), /^Error: FORK_SPONSOR_ADDRESS_INVALID$/);
const worker = readFileSync(new URL("../src/fork-gift-worker.mjs", import.meta.url), "utf8");
assert.match(worker, /const readyMessage = forkGiftReadyMessage\(runtime\.sponsor\.address\);/);
assert.ok(worker.indexOf("const readyMessage =") < worker.indexOf("const controller = createForkGiftController", worker.indexOf("export async function startForkGiftWorker")));
assert.match(worker, /process\.send\?\.\(readyMessage\)/);
assert.doesNotMatch(worker, /privateKeyToAccount|generatePrivateKey/);
console.log("PASS worker address: valid/checksum normalization, exact IPC keys, malformed/checksum/type rejection before listen, no new key derivation");

const privateBase = process.env.ARASO_PRIVATE_BASE;
if (!privateBase) throw new Error("ARASO_PRIVATE_BASE_REQUIRED_FOR_PARENT_CHECK");
const entry = readFileSync(path.join(privateBase, "ops/harness/a981-railway-image/entry.mjs"), "utf8");
const scrubStart = entry.indexOf("const INTERNAL_HOSTPORT =");
const scrubEnd = entry.indexOf("\nconst SERVER =", scrubStart);
assert.ok(scrubStart >= 0 && scrubEnd > scrubStart);
const scrubbers = vm.runInNewContext(entry.slice(scrubStart, scrubEnd) + ";({ scrub, scrubLog })");
const publicHash = "0x" + "ab".repeat(32);
assert.equal(scrubbers.scrubLog(`block=${publicHash} sponsor=${checksum}`), `block=[digest-redacted] sponsor=${checksum}`);
assert.equal(scrubbers.scrub(JSON.stringify({ result: publicHash })), JSON.stringify({ result: publicHash }));
assert.match(entry, /const body = scrub\(Buffer\.concat\(chunks\)\.toString\("utf8"\)\)/);
const start = entry.indexOf("function startGift(instanceId) {");
const end = entry.indexOf("\nconst guard = spawn(", start);
assert.ok(start >= 0 && end > start);
function parentProbe() {
  const child = new EventEmitter(), logs = [], launches = [];
  const context = vm.createContext({ forkGiftReadyMessage, process: { execPath: "node" }, log: (s) => logs.push(s),
    giftEnv: { GIFT_SPONSOR_FORK_PRIVATE_KEY: "fixture" }, giftWorker: null, giftReady: false, giftDrained: false, stopping: false,
    spawn: (...args) => { launches.push(args); return child; } });
  vm.runInContext(entry.slice(start, end) + '\nstartGift("fixture-instance");', context);
  assert.deepEqual(Array.from(launches[0][2].stdio), ["ignore", "ignore", "ignore", "ipc"]);
  assert.equal(context.giftEnv, null);
  return { child, logs, context };
}
for (const value of invalid) {
  const { child, logs, context } = parentProbe();
  child.emit("message", { type: "fork-gift-ready", sponsor: value });
  assert.equal(context.giftReady, false);
  assert.deepEqual(logs, ["fork Gift OFF needsHuman"]);
}
{
  const { child, logs, context } = parentProbe();
  const ready = forkGiftReadyMessage(lower);
  child.emit("message", { ...ready, env: "fixture", privateKey: "fixture" });
  child.emit("message", ready);
  assert.equal(context.giftReady, true);
  assert.deepEqual(logs, [`fork Gift ready sponsor=${checksum}`]);
  child.emit("message", { type: "fork-gift-ready", sponsor: "invalid" });
  assert.equal(context.giftReady, false);
  assert.equal(logs.at(-1), "fork Gift OFF needsHuman");
}
{
  const { child, logs, context } = parentProbe(); context.stopping = true;
  child.emit("message", forkGiftReadyMessage(lower));
  assert.equal(context.giftReady, false); assert.equal(logs.length, 0);
}
console.log("PASS actual parent callback: independent validation, OFF on bad address, normalized address only, duplicate log suppressed, stopped host ignores ready, worker stdio unchanged, log hash redaction preserves RPC hashes");

if (process.argv.includes("--docker")) {
  const name = "araso-sponsor-address-probe";
  const docker = (args) => spawnSync("docker", args, { encoding: "utf8", timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
  const before = docker(["ps", "-aq", "--filter", `name=^/${name}$`]);
  assert.equal(before.status, 0); assert.equal(before.stdout.trim(), "");
  let result;
  try {
    result = docker(["run", "--rm", "--init", "--name", name, "--platform", "linux/amd64", "--entrypoint", "node",
      "araso-fork:a1073-address", "--input-type=module", "--eval", `(${imageProbe.toString()})()`]);
    // Only fixed PASS/FAIL lines from the in-container verifier; no raw entry output or errors.
    for (const line of result.stdout.split("\n")) if (/^(PASS|FAIL) image probe [a-zA-Z0-9 =,;_-]+$/.test(line)) console.log(line);
    assert.equal(result.status, 0, "IMAGE_PROBE_FAILED_OR_TIMEOUT");
  } finally {
    const still = docker(["ps", "-aq", "--filter", `name=^/${name}$`]);
    if (still.status === 0 && still.stdout.trim()) docker(["stop", "-t", "2", name]);
    const after = docker(["ps", "-aq", "--filter", `name=^/${name}$`]);
    assert.equal(after.status, 0); assert.equal(after.stdout.trim(), "", "PROBE_CONTAINER_REMAINS");
  }
  console.log("PASS image probe residual_containers=0 host_mounts=0 published_ports=0 tx=0");
}

async function imageProbe() {
  const assert = (await import("node:assert/strict")).default;
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { setTimeout: sleep } = await import("node:timers/promises");
  const fs = await import("node:fs");
  const token = "public-local-fixture-admin-token-not-a-secret";
  // Known, non-secret scalar-one fixture. No random keys, persistence or real funding.
  const key = "0x" + "0".repeat(63) + "1";
  const expected = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
  const base = { PATH: process.env.PATH, STATE_DIR: "/data", ADMIN_TOKEN: token, PUBLIC_ALLOWED_ORIGINS: "https://arasoo.vercel.app", ANVIL_HISTORY: "full" };
  let entry = null, output = "", current = "", phase = "initial_start";
  const until = async (check) => { const end = Date.now() + 90000; while (Date.now() < end) { if (entry.exitCode !== null) throw Error("ENTRY_EXIT"); if (check()) return; await sleep(200); } throw Error("TIMEOUT"); };
  const start = async (env) => {
    current = ""; entry = spawn(process.execPath, ["/srv/a981/entry.mjs"], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const collect = (d) => { output += String(d); current += String(d); };
    entry.stdout.on("data", collect); entry.stderr.on("data", collect);
    await until(() => current.includes("A949_READY "));
  };
  const stop = async () => {
    const child = entry; if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit"); child.kill("SIGTERM");
    let timer; try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("STOP_TIMEOUT")), 20000); })]); }
    finally { clearTimeout(timer); }
    entry = null;
  };
  try {
    assert.equal(process.getuid(), 1000);
    await start(base);
    phase = "checkpoint";
    // Same local-only reopen and checkpoint sequence as the provisioning rehearsal.
    for (const route of ["/admin/guard/reopen", "/admin/state/snapshot"]) {
      const response = await fetch("http://127.0.0.1:18550" + route, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ note: "disposable address-log fixture" }), signal: AbortSignal.timeout(20000) });
      assert.equal(response.status, 200);
    }
    assert.ok(fs.existsSync("/data/fork-state.json")); await stop();
    phase = "worker_start";
    await start({ ...base, GIFT_SPONSOR_FORK_PRIVATE_KEY: key, GIFT_SPONSOR_FORK_ESCROW_ADDRESS: "0x" + "12".repeat(20),
      GIFT_SPONSOR_FORK_GAS_UNITS: "120000,400000,120000,250000", GIFT_SPONSOR_FORK_GAS_BUFFER_BPS: "2000", GIFT_SPONSOR_FORK_LEASE_SECONDS: "120",
      GIFT_SPONSOR_FORK_RECONCILE_MS: "60000", GIFT_SPONSOR_FORK_REQUESTS_PER_MINUTE: "20" });
    await until(() => { if (current.includes("fork Gift OFF needsHuman")) throw Error("WORKER_OFF"); return current.includes("fork Gift ready sponsor="); });
    phase = "verify_logs";
    await stop();
    const lines = output.split("\n").filter((l) => l.includes("fork Gift ready sponsor="));
    assert.equal(lines.length, 1); assert.ok(lines[0].endsWith(`fork Gift ready sponsor=${expected}`));
    assert.equal(/[a-fA-F0-9]{64}/.test(output), false);
    assert.equal(output.includes(key), false); assert.equal(output.includes(token), false);
    assert.equal(output.includes("GIFT_SPONSOR_FORK_"), false);
    assert.equal(/PRIVATE_KEY|process\.env|GAS_UNITS|120000,400000,120000,250000/.test(output), false);
    console.log("PASS image probe actual_entry_worker_ready=1 address_lines=1 hex64=0 key=0 env_dump=0 tx=0");
  } catch (error) {
    console.log(`FAIL image probe phase=${phase} guard_ready=${Number(current.includes("A949_READY "))} worker_off=${Number(current.includes("fork Gift OFF needsHuman"))}`); process.exitCode = 1;
    // Whitelisted diagnostics only; never dump captured logs or arbitrary error text.
    for (const marker of ["EADDRINUSE", "REFUSED", "state", "restore", "snapshot", "checkpoint", "upstream", "TIMEOUT", "ENTRY_EXIT", "WORKER_OFF", "STOP_TIMEOUT"]) {
      if (current.includes(marker) || error?.message === marker) console.log(`FAIL image probe diagnostic=${marker}`);
    }
  } finally {
    if (entry && entry.exitCode === null && entry.signalCode === null) { try { process.kill(-entry.pid, "SIGKILL"); } catch {} }
  }
}
