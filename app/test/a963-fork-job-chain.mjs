// [A-963] Fork Job chain check: the fork profile declares its parent chain (forkOf 143, table-owned); chainMatchesExecutor lets an
// executor that says 143 act under the fork profile, and nothing else changes: 143 / 10143 profile bytes and executorRefusal answers are
// identical to the pre-change code · a forged forkOf (other profile, string, inherited, changed value) is refused · evidence stays on the
// real chain (a fork read/tx = 31337143; a 143-tagged read under the fork profile is refused) · every gate still ends allowed:false.
// Node only, no network, no tx.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as CP from "../src/chain-profile.js";
import { executorRefusal } from "../src/mainnet-job-common.js";
import { LANE_FORK_EVIDENCE } from "../src/mainnet-job-aave.js";
import { advanceLaneIntent } from "../src/mainnet-job-lane.js";
import { aaveEvidenceProblem } from "../src/second-execution-adapter.js";
import * as EU from "../src/mainnet-job-euler.js";
import * as UP from "../src/mainnet-job-upshift.js";
import * as SM from "../src/mainnet-job-shmon.js";
import * as KU from "../src/mainnet-job-kuru.js";
import * as RV from "../src/mainnet-job-revoke.js";
import * as NV from "../src/mainnet-job-neverland.js";
import * as CV from "../src/mainnet-job-curvance.js";
import * as LP from "../src/mainnet-job-lp.js";
import * as KT from "../src/mainnet-job-kintsu.js";
import * as AB from "../src/mainnet-job-abil.js";
import { FORK_CHAIN_ID } from "../src/funding-context.js";

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-963 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const sha = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex");

const PIGGY = { id: "piggy-1", address: "0xA98d88b97c59194f5DB518bE07A4DB23AEc0BE31" };
const FORK = CP.resolveChainProfile("monad-fork", { rpcUrl: "https://lab-fork.invalid", forkInstanceId: "a963" });
const MAINNET = CP.resolveChainProfile("monad-mainnet");
const TESTNET = CP.resolveChainProfile("monad-testnet");
const TESTNET_DEFAULT = CP.resolveChainProfile(undefined);
const EXEC = (chainId) => ({ kind: "local_fork", chainId, forkBlock: 110746900, send: () => { throw new Error("never"); }, receipt: () => { throw new Error("never"); } });
// The pre-A-963 rule, verbatim (mainnet-job-common.js:68 before this card).
const oldRefusal = (profile, executor) => {
  if (!executor || typeof executor.send !== "function" || typeof executor.receipt !== "function") return "no_executor";
  if (executor.kind !== "local_fork") return "live_execution_disabled";
  if (executor.chainId !== profile.numericChainId || !Number.isInteger(executor.forkBlock)) return "executor_chain_mismatch";
  return null;
};

// The 10 Jobs (Kuru swap + limit share one module) + the two other executor modules, with each one's recorded evidence chain id.
const JOBS = [
  ["aave", null, null, null, LANE_FORK_EVIDENCE],
  ["neverland", NV.neverlandExecutionGate, NV.NEVERLAND_JOB_ID, NV, NV.NEVERLAND_FORK_EVIDENCE, "NEVERLAND"],
  ["curvance", CV.curvanceExecutionGate, CV.CURVANCE_JOB_ID, CV, CV.CURVANCE_FORK_EVIDENCE, "CURVANCE"],
  ["shmon", SM.shmonExecutionGate, SM.SHMON_JOB_ID, SM, SM.SHMON_FORK_EVIDENCE, "SHMON"],
  ["euler", EU.eulerExecutionGate, EU.EULER_JOB_ID, EU, EU.EULER_FORK_EVIDENCE, "EULER"],
  ["kuru", KU.kuruExecutionGate, KU.KURU_JOB_ID, KU, KU.KURU_FORK_EVIDENCE, "KURU"],
  ["revoke", RV.revokeExecutionGate, RV.REVOKE_JOB_ID, RV, RV.REVOKE_FORK_EVIDENCE, "REVOKE"],
  ["lp", LP.lpExecutionGate, LP.LP_JOB_ID, LP, LP.LP_FORK_EVIDENCE, "LP"],
  ["upshift", UP.upshiftExecutionGate, UP.UPSHIFT_JOB_ID, UP, UP.UPSHIFT_FORK_EVIDENCE, "UPSHIFT"],
  ["kintsu", KT.kintsuExecutionGate, KT.KINTSU_JOB_ID, KT, KT.KINTSU_FORK_EVIDENCE, "KINTSU"],
  ["abil", AB.abilExecutionGate, AB.ABIL_JOB_ID, AB, AB.ABIL_FORK_EVIDENCE, "ABIL"],
];
const provenStep = (mod, P) => {
  const steps = mod[`${P}_STEPS`];
  const unproven = mod[`${P}_UNPROVEN_STEPS`] || [];
  return steps ? Object.keys(steps).find((k) => !unproven.includes(k)) : undefined;
};

await check("fork profile: forkOf 143 (number, own, frozen); 143 / 10143 / blocked profiles carry no forkOf", () => {
  assert.equal(FORK.numericChainId, FORK_CHAIN_ID);
  assert.equal(FORK.numericChainId, 31337143);
  assert.ok(Object.prototype.hasOwnProperty.call(FORK, "forkOf"));
  assert.equal(FORK.forkOf, 143);
  assert.ok(Object.isFrozen(FORK));
  for (const p of [MAINNET, TESTNET, TESTNET_DEFAULT, CP.resolveChainProfile("nope")]) assert.equal("forkOf" in p, false, p.id);
});

await check("143 / 10143 profile bytes identical to the pre-change code (sha256 pins from HASH_BEFORE)", () => {
  assert.equal(sha(MAINNET), "6434aa5858b9df6deae400d2cc519c0f14cf4cf56150330e1564a971e73770ef");
  assert.equal(sha(TESTNET), "5ad5e560f1bf37092370f70d4f10f1bc43a612d96802ed3fec58dc21241253f4");
  assert.equal(sha(TESTNET_DEFAULT), "7fc524c88611d7821c9fff4e82405b196dd0310e4afa4987e2b11e340954d8cc");
});

await check("chainMatchesExecutor: same chain or the fork's table forkOf only", () => {
  const m = CP.chainMatchesExecutor;
  assert.equal(m(FORK, 31337143), true);
  assert.equal(m(FORK, 143), true);
  for (const x of [10143, 1, 0, -143, 143.5, "143", 143n, null, undefined, NaN]) assert.equal(m(FORK, x), false, String(x));
  assert.equal(m(MAINNET, 143), true);
  assert.equal(m(TESTNET, 10143), true);
  for (const x of [31337143, 10143, "143"]) assert.equal(m(MAINNET, x), false, String(x));
  for (const x of [143, 31337143]) assert.equal(m(TESTNET, x), false, String(x));
  for (const p of [null, undefined, "monad-fork", 143]) assert.equal(m(p, 143), false, String(p));
});

await check("forged forkOf refused: attached to another profile · string · inherited (__proto__) · changed value · fork with a changed id/chain", () => {
  const m = CP.chainMatchesExecutor;
  assert.equal(m({ ...TESTNET, forkOf: 143 }, 143), false, "testnet + forkOf 143");
  assert.equal(m({ ...MAINNET, forkOf: 10143 }, 10143), false, "mainnet + forkOf 10143");
  assert.equal(m({ ...MAINNET, forkOf: 31337143 }, 31337143), false, "mainnet + forkOf fork id");
  assert.equal(m({ ...FORK, forkOf: "143" }, 143), false, "string forkOf");
  assert.equal(m({ ...FORK, forkOf: 10143 }, 10143), false, "changed forkOf");
  assert.equal(m({ ...FORK, forkOf: 143n }, 143), false, "bigint forkOf");
  const { forkOf, ...rest } = FORK;
  assert.equal(m(rest, 143), false, "no forkOf");
  assert.equal(m(Object.assign(Object.create({ forkOf: 143 }), rest), 143), false, "inherited forkOf");
  assert.equal(m(JSON.parse(`{"__proto__":{"forkOf":143},${JSON.stringify(rest).slice(1)}`), 143), false, "JSON __proto__ forkOf");
  assert.equal(m({ ...FORK, id: "__proto__" }, 143), false, "id __proto__");
  assert.equal(m({ ...FORK, numericChainId: 143 }, 31337143), false, "fork with chain swapped");
  assert.equal(m({ ...FORK, status: CP.CHAIN_PROFILE_STATUS.BLOCKED }, 143), false, "blocked fork");
  assert.equal(m(CP.resolveChainProfile("monad-fork"), 143), false, "fork without its config = blocked");
});

await check("executorRefusal: 143 / 10143 / blocked answers identical to the pre-change rule over an executor matrix", () => {
  const execs = [null, {}, { ...EXEC(143), kind: "live" }, EXEC(143), EXEC(10143), EXEC(31337143), EXEC("143"), EXEC(null), { ...EXEC(143), forkBlock: "1" }, { ...EXEC(10143), forkBlock: 1.5 }];
  const blocked = CP.resolveChainProfile("x");
  for (const p of [MAINNET, TESTNET, TESTNET_DEFAULT, blocked, { ...MAINNET, forkOf: 10143 }, { ...TESTNET, forkOf: 143 }]) {
    for (const e of execs) assert.equal(executorRefusal(p, e), oldRefusal(p, e), `${p.id}/${e && e.chainId}`);
  }
});

await check("fork profile: an executor on 143 (each Job's evidence chain) or on 31337143 passes the executor check; 10143 / forged does not", () => {
  for (const [name, , , , ev] of JOBS) {
    assert.equal(ev.chainId, 143, name);
    assert.equal(CP.chainMatchesExecutor(FORK, ev.chainId), true, name);
    assert.equal(executorRefusal(FORK, EXEC(ev.chainId)), null, name);
  }
  assert.equal(executorRefusal(FORK, EXEC(31337143)), null);
  assert.equal(executorRefusal(FORK, EXEC(10143)), "executor_chain_mismatch");
  assert.equal(executorRefusal(FORK, { ...EXEC(143), forkBlock: "110746900" }), "executor_chain_mismatch");
  assert.equal(executorRefusal({ ...FORK, forkOf: "143" }, EXEC(143)), "executor_chain_mismatch");
  assert.equal(executorRefusal(FORK, { ...EXEC(143), kind: "live" }), "live_execution_disabled");
});

await check("gates (fork profile named for each Job, executor 143): past the chain check, still allowed:false · liveExecution:false · no permission", () => {
  for (const [name, gate, jobId, mod, , P] of JOBS) {
    if (!gate) continue;
    const step = provenStep(mod, P);
    const named = { ...FORK, jobId };
    for (const chainId of [143, 31337143]) {
      const g = gate({ profile: named, piggy: PIGGY, executor: EXEC(chainId), step });
      assert.deepEqual([g.allowed, g.liveExecution, g.executionPermission], [false, false, false], `${name}/${chainId}`);
      assert.notEqual(g.reason, "executor_chain_mismatch", `${name}/${chainId}: ${g.reason}`);
    }
    const bad = gate({ profile: named, piggy: PIGGY, executor: EXEC(10143), step });
    assert.equal(bad.allowed, false, name);
    // a gate that stops before the executor check (Kintsu: live_execution_disabled first) answers its own reason; the rest = chain mismatch
    if (!/^profile_|asset_not_in_profile|unknown_step|unproven_step|live_execution_disabled/.test(bad.reason)) assert.equal(bad.reason, "executor_chain_mismatch", name);
    const live = gate({ profile: { ...named, liveExecution: true }, piggy: PIGGY, executor: EXEC(143), step });
    assert.deepEqual([live.allowed, live.executionPermission], [false, false], name);
  }
  // Kintsu looks at the executor only on a (forged) liveExecution:true profile: 143 passes the chain line and still ends not wired.
  const kt = { ...FORK, jobId: KT.KINTSU_JOB_ID, liveExecution: true };
  assert.equal(KT.kintsuExecutionGate({ profile: kt, piggy: PIGGY, executor: EXEC(143), step: "deposit" }).reason, "kintsu_lane_not_wired");
  assert.equal(KT.kintsuExecutionGate({ profile: kt, piggy: PIGGY, executor: EXEC(10143), step: "deposit" }).reason, "executor_chain_mismatch");
});

await check("aave lane on the fork: still refused at the lane profile (143-only), not at the chain", async () => {
  const r = await advanceLaneIntent({ profile: FORK, piggy: PIGGY, intent: {}, preview: null, executor: EXEC(143), storage: null, nowIso: "2026-10-10T00:00:00Z" });
  assert.deepEqual([r.status, r.reason], ["blocked", "profile_not_mainnet_lane"]);
});

await check("evidence chain stays the real chain: under the fork profile only a 31337143 read passes the chain line; a 143-tagged read = evidence_chain_mismatch", () => {
  const intent = { before: { block: 1 }, steps: {}, amountRaw: "1" };
  const read = (chainId) => ({ chainId, block: 10, source: "rpc@10", observedAt: "2026-10-10T00:00:00Z" });
  const args = (profile, chainId) => ({ read: read(chainId), profile, intent, step: "approve", maxReadAgeMs: 60000, nowMs: Date.parse("2026-10-10T00:00:01Z") });
  assert.equal(aaveEvidenceProblem(args(FORK, 143)), "evidence_chain_mismatch");
  assert.equal(aaveEvidenceProblem(args(FORK, "31337143")), "evidence_chain_mismatch");
  assert.notEqual(aaveEvidenceProblem(args(FORK, 31337143)), "evidence_chain_mismatch");
  assert.equal(aaveEvidenceProblem(args(MAINNET, 31337143)), "evidence_chain_mismatch");
  assert.notEqual(aaveEvidenceProblem(args(MAINNET, 143)), "evidence_chain_mismatch");
});

// Permission requests: their chain line lives in each executor file (outside this card). Observed, not pinned: whatever the line
// answers, a request issues no permission.
await check("permission requests on the fork: issue nothing (observed reasons printed)", () => {
  const seen = [];
  const calls = [
    ["neverland", () => NV.neverlandPermissionRequest({ profile: FORK, piggy: PIGGY, amountRaw: "1" })],
    ["curvance", () => CV.curvancePermissionRequest({ profile: FORK, piggy: PIGGY, amountRaw: "1" })],
    ["shmon", () => SM.shmonPermissionRequest({ profile: FORK, piggy: PIGGY, amountWei: "1" })],
    ["euler", () => EU.eulerPermissionRequest({ profile: FORK, piggy: PIGGY, amountRaw: "1" })],
    ["kuru-buy", () => KU.kuruPermissionRequest({ profile: FORK, piggy: PIGGY, action: KU.KURU_ACTION?.BUY, amountRaw: "1" })],
    ["revoke", () => RV.revokePermissionRequest({ profile: FORK, piggy: PIGGY })],
    ["lp", () => LP.lpPermissionRequest({ profile: FORK, piggy: PIGGY, amountRaw: "1" })],
    ["upshift", () => UP.upshiftPermissionRequest({ profile: FORK, piggy: PIGGY, amountRaw: "1" })],
    ["abil", () => AB.abilPermissionRequest({ profile: FORK, piggy: PIGGY, amountRaw: "1" })],
  ];
  for (const [name, f] of calls) {
    const r = f();
    assert.ok(!r.permission, name);
    seen.push(`${name}=${r.error || "request"}`);
  }
  console.log(`      observed: ${seen.join(" · ")}`);
});

await check("no network", () => assert.equal(fetchCalls, 0));

console.log(`\nA-963 fork job chain: ${pass} PASS / ${fail} FAIL`);
if (fail) process.exit(1);
