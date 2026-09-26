// [A-476] 후보의 현재 Piggy context 가 **런타임 account+chain** 에서 오는지, 없으면
// fail-closed 되는지를 재는 테스트 — 네트워크 0 · 브라우저 0.
//   node app/test/live-piggy-context.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  UNRESOLVED_PIGGY_CONTEXT,
  buildDestinationFixtures,
  resolveCurrentPiggyContext,
  runSecondJourney,
} from "../src/job-feed.js";
import { evaluateReadinessEvidence } from "../src/second-job-readiness.js";

const JOB_FEED_SRC = readFileSync(new URL("../src/job-feed.js", import.meta.url), "utf8");
const MAIN_SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

// Harness Piggy 의 **공개** 주소/chain 은 기존 증거(A-463/A-465)에서 회수한 값이다.
// 제품 코드가 아니라 이 테스트에만 존재한다. secret/PRF 는 읽지도 쓰지도 않는다.
const HARNESS_PUBLIC = Object.freeze({
  address: "0x4386A2237DF924453A14575238Ad0565eB39D4C6",
  chain: "monad-testnet",
});

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. 낡은 fixture 가 제품 코드에서 사라졌다 ───────────────────────────────────────────
check("job-feed no longer hardcodes the mainnet fixture context", () => {
  assert.equal(JOB_FEED_SRC.includes("monad-mainnet-fixture"), false);
  assert.equal(JOB_FEED_SRC.includes("a174-local-piggy"), false);
});

check("product code pins no Harness Piggy address", () => {
  for (const src of [JOB_FEED_SRC, MAIN_SRC]) {
    assert.equal(src.includes(HARNESS_PUBLIC.address), false);
    assert.equal(src.toLowerCase().includes(HARNESS_PUBLIC.address.toLowerCase()), false);
  }
});

// ── 2. context 없음/불완전 → UNRESOLVED (mainnet fallback 0) ───────────────────────────
check("no runtime context resolves to UNRESOLVED, not a fixture chain", () => {
  assert.deepEqual(resolveCurrentPiggyContext(), UNRESOLVED_PIGGY_CONTEXT);
  assert.equal(UNRESOLVED_PIGGY_CONTEXT.chain, "UNKNOWN");
  assert.equal(UNRESOLVED_PIGGY_CONTEXT.address, "UNKNOWN");
  assert.equal(UNRESOLVED_PIGGY_CONTEXT.evidenceMode, "no_runtime_context");
});

check("partial context never partially promotes", () => {
  const cases = [
    { address: HARNESS_PUBLIC.address },                       // chain 없음
    { chain: "monad-testnet" },                                // address 없음
    { address: "fixture-account", chain: "monad-testnet" },    // address 형식 아님
    { address: HARNESS_PUBLIC.address, chain: "" },            // chain 빈 값
    { address: HARNESS_PUBLIC.address, chain: "UNKNOWN" },     // chain UNKNOWN
  ];
  for (const runtime of cases) {
    assert.deepEqual(resolveCurrentPiggyContext(runtime), UNRESOLVED_PIGGY_CONTEXT);
  }
});

check("every candidate carries the unresolved context when there is no runtime account", () => {
  for (const destination of buildDestinationFixtures()) {
    assert.equal(destination.currentPiggyContext.chain, "UNKNOWN");
    assert.equal(destination.currentPiggyContext.address, "UNKNOWN");
  }
});

// ── 3. 런타임 context 가 있으면 그 account+chain 이 그대로 후보에 실린다 ───────────────────
check("runtime account+chain flows into every candidate", () => {
  for (const destination of buildDestinationFixtures(HARNESS_PUBLIC)) {
    assert.equal(destination.currentPiggyContext.chain, HARNESS_PUBLIC.chain);
    assert.equal(destination.currentPiggyContext.address, HARNESS_PUBLIC.address);
    assert.equal(destination.currentPiggyContext.evidenceMode, "runtime_context_read_only");
  }
});

check("runSecondJourney takes the context from the live scope", () => {
  const flow = runSecondJourney({
    selectedErrandIds: ["grow"],
    scope: { accountId: HARNESS_PUBLIC.address, chainId: HARNESS_PUBLIC.chain },
  });
  for (const destination of flow.destinations) {
    assert.equal(destination.currentPiggyContext.address, HARNESS_PUBLIC.address);
    assert.equal(destination.currentPiggyContext.chain, HARNESS_PUBLIC.chain);
  }
});

check("an unauthenticated scope keeps candidates unresolved", () => {
  const flow = runSecondJourney({ selectedErrandIds: ["grow"], scope: { accountId: "", chainId: "monad-testnet" } });
  for (const destination of flow.destinations) {
    assert.equal(destination.currentPiggyContext.address, "UNKNOWN");
  }
});

// ── 4. scope mismatch 는 여전히 정확히 잡힌다(context 교체가 판정을 느슨하게 하지 않는다) ──
check("chain/address mismatch is still detected against the live context", () => {
  // [A-579] Kintsu's Job chain is monad-mainnet. On the testnet runtime it is evidence only and
  // stops at job_chain_not_runtime_chain before any target check (asserted here). The target
  // checks themselves are exercised on a runtime whose chain IS the Job chain.
  const [, kintsuOnTestnet] = buildDestinationFixtures(HARNESS_PUBLIC);
  assert.equal(evaluateReadinessEvidence({ ...kintsuOnTestnet, capabilityStatus: "qualified" }, {}, { nowMs: 1000 }).reason, "job_chain_not_runtime_chain");
  const HARNESS_PUBLIC_MAINNET = { ...HARNESS_PUBLIC, chain: "monad-mainnet" };
  const [, kintsu] = buildDestinationFixtures(HARNESS_PUBLIC_MAINNET);
  const candidate = { ...kintsu, capabilityStatus: "qualified" };
  const base = {
    source: "read_only_probe",
    destinationId: candidate.id,
    block: 1,
    eligibility: "known",
    exit: "known",
    proof: "known",
    gas: "known",
    requiredAssets: ["gas"],
    availableAssets: ["gas"],
    missingNow: [],
    timestampMs: 900,
    expiresAtMs: 2000,
  };
  const wrongChain = evaluateReadinessEvidence(candidate, { ...base, chain: "monad-testnet", address: HARNESS_PUBLIC.address }, { nowMs: 1000 });
  assert.equal(wrongChain.reason, "target_chain_mismatch");
  const wrongAddress = evaluateReadinessEvidence(candidate, { ...base, chain: HARNESS_PUBLIC_MAINNET.chain, address: "0x0000000000000000000000000000000000000001" }, { nowMs: 1000 });
  assert.equal(wrongAddress.reason, "target_address_mismatch");
  const matched = evaluateReadinessEvidence(candidate, { ...base, chain: HARNESS_PUBLIC_MAINNET.chain, address: HARNESS_PUBLIC.address }, { nowMs: 1000 });
  assert.equal(matched.status, "JOB_READY");
  // READY 는 **권한이 아니다** — 여기서도 실행 권한은 절대 나오지 않는다.
  assert.equal(matched.executionPermission, false);
});

check("context replacement never grants execution permission", () => {
  const flow = runSecondJourney({
    selectedErrandIds: ["grow"],
    scope: { accountId: HARNESS_PUBLIC.address, chainId: HARNESS_PUBLIC.chain },
  });
  assert.equal(flow.txExecuted, false);
  assert.equal(flow.preflight?.executionPermission, false);
  assert.equal(flow.preferenceState.executionPermission, false);
});

console.log(`\n${pass}/${pass} PASS`);
