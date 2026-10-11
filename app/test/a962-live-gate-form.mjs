// [A-962] Live-gate form judge pin (no source change: PREMISE_CONFLICT, see receipt). Two forms exist and both are strict-equality:
// Kintsu `!== true` passes its live check only on exactly true; Euler / Upshift / Kuru / shMON / revoke `!== false` (fork-only gates)
// pass only on exactly false. undefined / "true" / 1 are refused "live_execution_disabled" by every gate, and no gate ever allows.
// Node only, no network, no tx.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as KI from "../src/mainnet-job-kintsu.js";
import * as EU from "../src/mainnet-job-euler.js";
import * as UP from "../src/mainnet-job-upshift.js";
import * as KU from "../src/mainnet-job-kuru.js";
import * as SH from "../src/mainnet-job-shmon.js";
import * as RV from "../src/mainnet-job-revoke.js";
globalThis.fetch = async () => { throw new Error("A-962 test: network forbidden"); };
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));

const BASE = { id: "monad-mainnet", status: "active", numericChainId: 143, scope: "monad-mainnet", usdc: { symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 } };
const forkExec = { kind: "local_fork", chainId: 143, forkBlock: 110746900, send: () => {}, receipt: () => {} };
const piggy = { id: "p", address: "0x0e1aF437Cc134921dedA89ADaDe025f655b5B8e4" };
const EXECUTORS = [
  { file: "mainnet-job-kintsu.js", jobId: KI.KINTSU_JOB_ID, gate: KI.kintsuExecutionGate, step: "deposit", passOn: true },
  { passOn: false, file: "mainnet-job-euler.js", jobId: EU.EULER_JOB_ID, gate: EU.eulerExecutionGate, step: "approve" },
  { passOn: false, file: "mainnet-job-upshift.js", jobId: UP.UPSHIFT_JOB_ID, gate: UP.upshiftExecutionGate, step: "approve" },
  { passOn: false, file: "mainnet-job-kuru.js", jobId: KU.KURU_JOB_ID, gate: KU.kuruExecutionGate, step: "buyMon" },
  { passOn: false, file: "mainnet-job-shmon.js", jobId: SH.SHMON_JOB_ID, gate: SH.shmonExecutionGate, step: "deposit" },
  { passOn: false, file: "mainnet-job-revoke.js", jobId: RV.REVOKE_JOB_ID, gate: RV.revokeExecutionGate, step: "revoke" },
];
const INPUTS = [["true", true], ["false", false], ["undefined", undefined], ['"true"', "true"], ["1", 1]];

for (const ex of EXECUTORS) {
  check(`${ex.file}: job id + gate exported`, () => { assert.equal(typeof ex.jobId, "string"); assert.equal(typeof ex.gate, "function"); });
  for (const [label, value] of INPUTS) {
    const passes = value === ex.passOn;
    check(`${ex.file}: liveExecution=${label} → live check ${passes ? "passed" : "refused"}, never allowed`, () => {
      const profile = { ...BASE, jobId: ex.jobId, liveExecution: value };
      if (value === undefined) delete profile.liveExecution;
      const g = ex.gate({ profile, piggy, executor: forkExec, step: ex.step });
      assert.equal(g.allowed, false);
      assert.equal(g.liveExecution, false);
      assert.equal(g.executionPermission, false);
      if (passes) assert.notEqual(g.reason, "live_execution_disabled", `exactly ${ex.passOn} passes this live check (got ${g.reason})`);
      else assert.equal(g.reason, "live_execution_disabled");
      if (typeof value !== "boolean") assert.equal(g.reason, "live_execution_disabled"); // non-boolean never coerced, either form
    });
  }
  check(`${ex.file}: source live gate is strict \`!== ${ex.passOn}\` (one line, no loose truthiness check)`, () => {
    const src = readFileSync(path.join(HERE, "..", "src", ex.file), "utf8");
    assert.equal((src.match(/profile\.liveExecution !==? (true|false)\) return refuse\("live_execution_disabled"\)/g) || []).length, 1);
    assert.equal((src.match(new RegExp(`profile\\.liveExecution !== ${ex.passOn}\\) return refuse\\("live_execution_disabled"\\)`, "g")) || []).length, 1);
    assert.equal(/if \(!?profile\.liveExecution\)/.test(src), false);
  });
}

console.log(`\nA-962 live gate form: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
