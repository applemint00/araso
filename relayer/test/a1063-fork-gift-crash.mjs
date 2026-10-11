import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openForkGiftJournal, linuxProcessIdentity } from "../src/fork-gift-state.mjs";
const dir = mkdtempSync(path.join(os.tmpdir(), "a1063-crash-"));
const checkpoint = { forkInstanceId: "fork-143-crash", block: 10, snapshotHash: "fixture" };
// Production uses Linux boot_id + /proc starttime. On macOS this test substitutes
// ps starttime, while still creating/killing a REAL process holding BOTH files.
const identity = process.platform === "linux" ? linuxProcessIdentity : (pid) => {
  try { const start = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); if (!start) return null; return start; }
  catch (e) { if (e.status === 1) return null; throw e; }
};
const moduleUrl = new URL("../src/fork-gift-state.mjs", import.meta.url).href;
const source = `import {execFileSync} from 'node:child_process'; import {openForkGiftJournal,linuxProcessIdentity} from ${JSON.stringify(moduleUrl)};
const identity = ${identity.toString()};
await openForkGiftJournal({dir:${JSON.stringify(dir)},checkpoint:${JSON.stringify(checkpoint)},inspect:async()=> 'ok',ownerOptions:{identity}});
process.send({type:'locked'}); setInterval(()=>{},1000);`;
let child;
try {
  child = spawn(process.execPath, ["--input-type=module", "-e", source], { env: { PATH: process.env.PATH }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const ready = await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error("child exited before lock"); })]);
  assert.equal(ready[0].type, "locked");
  await assert.rejects(openForkGiftJournal({ dir, checkpoint, inspect: async () => "ok", ownerOptions: { identity } }), /OWNER_LIVE/);
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  const file = path.join(dir, "gift-sponsor-fork-ledger.json");
  assert.equal(existsSync(`${file}.lock`), true); assert.equal(existsSync(`${file}.owner`), true);
  const recovered = await openForkGiftJournal({ dir, checkpoint, inspect: async () => "ok", ownerOptions: { identity } }); recovered.close();
  assert.equal(existsSync(`${file}.lock`), false); assert.equal(existsSync(`${file}.owner`), false);
  console.log(`PASS a1063 REAL SIGKILL: live-owner refused, stale ledger+owner recovered (${process.platform} identity)`);
} finally { child?.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); }
