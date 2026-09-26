// [A-484 Lane A] fork-backed 어댑터 계약 — 네트워크 0 · 브라우저 0 · 체인 호출 0.
//   node app/test/second-job-adapter.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLOCKED_PATHS,
  EVIDENCE_LABEL,
  EXECUTION_MODE,
  FIRST_JOURNEY_LINEAGE,
  JOB_FAMILY,
  buildExecutionPlan,
  describeBlockedPath,
  isLiveProven,
  listForkProvenDestinations,
  listVisibleJobFamilies,
} from "../src/second-job-readiness.js";
import { ACTION } from "../src/rule-decision.js";

const SRC = readFileSync(new URL("../src/second-job-readiness.js", import.meta.url), "utf8");
const CTX = { address: "0x4386A2237DF924453A14575238Ad0565eB39D4C6", chain: "monad-mainnet" };
const ALLOWANCE = {
  token: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  spender: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
  allowance: "5000000",
};

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. 가족 중복 제거 — 안정 Grow 는 한 칸이다 ───────────────────────────────────
check("the stable-Grow family shows one baseline, not three errands", () => {
  const families = listVisibleJobFamilies();
  const stable = families.find((f) => f.family === JOB_FAMILY.GROW_STABLE);
  assert.equal(stable.baseline, "aave-usdc");
  assert.deepEqual(stable.alternatives.sort(), ["curvance-usdc", "neverland-usdc"]);
});

check("every family has exactly one baseline", () => {
  for (const f of listVisibleJobFamilies()) {
    assert.ok(f.baseline, `${f.family} must have a baseline`);
  }
  const families = listVisibleJobFamilies().map((f) => f.family).sort();
  assert.deepEqual(families, [JOB_FAMILY.GROW_DELAYED, JOB_FAMILY.GROW_STABLE, JOB_FAMILY.OWN_RWA, JOB_FAMILY.PROTECT].sort());
});

check("FastLane/shMON is lineage, not a distinct second experience", () => {
  assert.equal(FIRST_JOURNEY_LINEAGE.countsAsDistinctSecondExperience, false);
  assert.equal(listForkProvenDestinations().some((d) => d.id === "fastlane-shmon"), false);
});

// ── 2. fork 증거가 권한을 올리지 않는다 ──────────────────────────────────────────
check("a fork-backed plan never grants execution permission", () => {
  for (const mode of [EXECUTION_MODE.FORK_SIMULATION, EXECUTION_MODE.LIVE]) {
    const out = buildExecutionPlan("aave-usdc", { context: CTX, executionMode: mode });
    assert.equal(out.status, "PLAN_READY");
    assert.equal(out.executionPermission, false);
    assert.equal(out.plan.executionPermission, false);
    assert.equal(out.plan.permissionRequired, true);
    assert.equal(out.action, ACTION.ASK);
  }
});

check("fork evidence is never a live proof", () => {
  const out = buildExecutionPlan("aave-usdc", { context: CTX });
  assert.equal(out.plan.forkEvidence.label, EVIDENCE_LABEL.FORK_SIM);
  assert.equal(isLiveProven(out.plan.forkEvidence.label), false);
  assert.equal(isLiveProven(EVIDENCE_LABEL.FORK_SIM_PENDING), false);
  assert.equal(isLiveProven(EVIDENCE_LABEL.APP_FORK_E2E), false);
  assert.equal(isLiveProven(EVIDENCE_LABEL.MAINNET_TX), true);
});

check("execution mode is always explicit, and live never implies fork evidence changed", () => {
  const fork = buildExecutionPlan("aave-usdc", { context: CTX, executionMode: EXECUTION_MODE.FORK_SIMULATION });
  const live = buildExecutionPlan("aave-usdc", { context: CTX, executionMode: EXECUTION_MODE.LIVE });
  assert.equal(fork.plan.executionMode, EXECUTION_MODE.FORK_SIMULATION);
  assert.equal(live.plan.executionMode, EXECUTION_MODE.LIVE);
  // 모드가 바뀌어도 증거 라벨은 그대로다
  assert.equal(live.plan.forkEvidence.label, fork.plan.forkEvidence.label);
});

check("an unknown execution mode is refused", () => {
  const out = buildExecutionPlan("aave-usdc", { context: CTX, executionMode: "whatever" });
  assert.equal(out.status, "UNKNOWN");
  assert.equal(out.reason, "invalid_execution_mode");
});

check("no code path in the source upgrades a fork label to a mainnet label", () => {
  // 증거 라벨을 덮어쓰는 대입이 없어야 한다.
  assert.equal(/forkEvidence(\.label)?\s*=\s*[^=]/.test(SRC.replace(/label: EVIDENCE_LABEL/g, "")), false);
  assert.equal(/executionPermission\s*:\s*true/.test(SRC.split("[A-484 Lane A]")[1] || ""), false);
});

// ── 3. 지연 귀환은 즉시 성공이 아니다 ────────────────────────────────────────────
check("Kintsu is delayed with an unknown duration, and says why", () => {
  const out = buildExecutionPlan("kintsu-smon", { context: CTX });
  assert.equal(out.plan.returnMode, "delayed");
  assert.equal(out.plan.exit.expectedDuration, null);
  assert.match(out.plan.exit.expectedDurationUnknownReason, /not published/);
  assert.notEqual(out.plan.exit.mode, "immediate");
});

check("Kintsu keeps its cancel path and exit fee visible", () => {
  const out = buildExecutionPlan("kintsu-smon", { context: CTX });
  assert.match(out.plan.exit.cancelPath, /cancelUnlockRequest/);
  assert.equal(out.plan.exit.exitFeeBips, 10);
  assert.ok(out.plan.risks.some((r) => /MON price exposure/.test(r)));
  assert.ok(out.plan.receiptFields.includes("batchId"));
});

// ── 4. Protect 는 대상이 없으면 계획이 되지 않는다 ───────────────────────────────
check("Protect is unavailable when there is nothing to revoke", () => {
  const none = buildExecutionPlan("protect-revoke-allowance", { context: CTX });
  assert.equal(none.status, "UNKNOWN");
  assert.equal(none.reason, "protect_target_missing");

  const zero = buildExecutionPlan("protect-revoke-allowance", { context: CTX, allowanceTarget: { ...ALLOWANCE, allowance: "0" } });
  assert.equal(zero.reason, "protect_target_absent");
});

check("Protect becomes a plan only with a real target, and targets the token itself", () => {
  const out = buildExecutionPlan("protect-revoke-allowance", { context: CTX, allowanceTarget: ALLOWANCE });
  assert.equal(out.status, "PLAN_READY");
  assert.equal(out.plan.destination, ALLOWANCE.token); // 상수로 박힌 토큰이 아니다
  assert.deepEqual(out.plan.requiredAssets, ["gas"]);
  assert.equal(out.plan.exit.mode, "not_applicable");
});

// ── 5. aBIL 은 배당도 주주 권리도 약속하지 않는다 ────────────────────────────────
check("the aBIL plan states economic exposure only and keeps dividends UNKNOWN", () => {
  const out = buildExecutionPlan("abil-spot", { context: CTX });
  assert.equal(out.plan.rights.shareholderRights, false);
  assert.match(out.plan.rights.statement, /economic exposure only/);
  assert.equal(out.plan.rights.dividend, "UNKNOWN");
  assert.match(out.plan.rights.dividendReason, /venue-sourced|no ETF distribution/);
  assert.ok(out.plan.eligibilityGate);
});

check("no adapter text promises a dividend or shareholder ownership", () => {
  const adapterSrc = SRC.split("[A-484 Lane A]")[1] || "";
  for (const forbidden of ["dividend guaranteed", "dividends are paid", "you own the stock", "shareholder rights: true"]) {
    assert.equal(adapterSrc.toLowerCase().includes(forbidden), false, `must not contain "${forbidden}"`);
  }
  assert.equal(/shareholderRights:\s*true/.test(adapterSrc), false);
});

// ── 6. 런타임 context 불일치는 여전히 fail-closed ────────────────────────────────
check("a missing or wrong runtime context fails closed", () => {
  assert.equal(buildExecutionPlan("aave-usdc", { context: {} }).reason, "missing_runtime_address");
  assert.equal(buildExecutionPlan("aave-usdc", { context: { address: CTX.address } }).reason, "missing_runtime_chain");
  assert.equal(buildExecutionPlan("aave-usdc", { context: { address: CTX.address, chain: "UNKNOWN" } }).reason, "missing_runtime_chain");
  assert.equal(buildExecutionPlan("aave-usdc", { context: { address: CTX.address, chain: "monad-testnet" } }).reason, "chain_mismatch");
  assert.equal(buildExecutionPlan("aave-usdc", { context: { address: "not-an-address", chain: "monad-mainnet" } }).reason, "missing_runtime_address");
});

check("an unknown destination is refused", () => {
  assert.equal(buildExecutionPlan("something-made-up", { context: CTX }).reason, "unknown_destination");
});

check("the plan carries the runtime account, not a pinned dev wallet", () => {
  const other = { address: "0x00000000000000000000000000000000000000a1", chain: "monad-mainnet" };
  assert.equal(buildExecutionPlan("aave-usdc", { context: other }).plan.account, other.address);
});

// ── 7. 막힌 길은 막힌 채로 ───────────────────────────────────────────────────────
check("blocked paths stay blocked and say why", () => {
  assert.equal(BLOCKED_PATHS.length, 3);
  for (const b of BLOCKED_PATHS) {
    assert.equal(b.bypassAllowed, false);
    assert.ok(b.reason.length > 10);
    assert.equal(describeBlockedPath(b.id).bypassAllowed, false);
  }
  assert.equal(describeBlockedPath("nope"), null);
  // 막힌 목적지는 실행 계획으로도 만들어지지 않는다
  for (const b of BLOCKED_PATHS) {
    assert.equal(buildExecutionPlan(b.id, { context: CTX }).reason, "unknown_destination");
  }
});

// ── 8. 모든 계획은 카드가 요구한 칸을 다 채운다 ──────────────────────────────────
check("every plan specifies chain, asset, destination, steps, delta, exit, receipt, stop", () => {
  const targets = [
    ["aave-usdc", {}], ["curvance-usdc", {}], ["neverland-usdc", {}], ["kintsu-smon", {}],
    ["abil-spot", {}], ["protect-revoke-allowance", { allowanceTarget: ALLOWANCE }],
  ];
  for (const [id, extra] of targets) {
    const out = buildExecutionPlan(id, { context: CTX, ...extra });
    assert.equal(out.status, "PLAN_READY", `${id} should plan`);
    const p = out.plan;
    assert.ok(p.chain && p.chainId, `${id} chain`);
    assert.ok(p.requiredAssets.length > 0, `${id} assets`);
    assert.ok(p.destination, `${id} destination`);
    assert.ok(p.steps.length > 0, `${id} steps`);
    assert.ok(p.measurableDelta, `${id} delta`);
    assert.ok(p.exit && p.exit.path, `${id} exit`);
    assert.ok(p.receiptFields.length > 0, `${id} receipt`);
    assert.ok(p.stopConditions.length > 0, `${id} stop`);
    assert.ok(p.forkEvidence.label, `${id} evidence`);
  }
});

check("no plan describes leverage, borrowing or looping", () => {
  const adapterSrc = (SRC.split("[A-484 Lane A]")[1] || "").toLowerCase();
  for (const word of ["leverage", "borrow(", "looping"]) {
    assert.equal(adapterSrc.includes(word), false, `adapter must not offer "${word}"`);
  }
});

console.log(`\n${pass}/${pass} PASS`);
