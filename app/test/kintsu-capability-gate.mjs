// [A-477] Kintsu-like 후보의 capability 관문을 고정하는 테스트 — 네트워크 0 · 브라우저 0.
//   node app/test/kintsu-capability-gate.mjs
// A-477 실측 결론: 공식 docs 의 Monad **testnet** vault 주소에는 현재 code 가 없고(체인 10143),
// 배포가 살아 있는 곳은 **mainnet 143** 이다. 우리 Piggy/앱은 testnet 에 있다. 따라서 이 후보는
// 자금 문제가 아니라 **deployment** 때문에 열리지 않는다. 그 사실을 코드가 조용히 뒤집지 못하게 잠근다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDestinationFixtures } from "../src/job-feed.js";
import { evaluateReadinessEvidence } from "../src/second-job-readiness.js";

const JOB_FEED_SRC = readFileSync(new URL("../src/job-feed.js", import.meta.url), "utf8");
const MAIN_SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

// A-477 Lane A/B 에서 회수한 **공개** 주소. 제품 코드가 아니라 이 테스트에만 있다.
const KINTSU_DOC_TESTNET = "0xe1d2439b75fb9746E7Bc6cB777Ae10AA7f7ef9c5"; // 공식 docs testnet 탭 · 실측 code 0x
const KINTSU_DOC_MAINNET = "0xA3227C5969757783154C60bF0bC1944180ed81B9"; // 공식 docs mainnet · 실측 code present
const RUNTIME = { address: "0x4386A2237DF924453A14575238Ad0565eB39D4C6", chain: "monad-testnet" };

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

check("no Kintsu protocol address is pinned in product code", () => {
  for (const src of [JOB_FEED_SRC, MAIN_SRC]) {
    for (const addr of [KINTSU_DOC_TESTNET, KINTSU_DOC_MAINNET]) {
      assert.equal(src.toLowerCase().includes(addr.toLowerCase()), false);
    }
  }
});

check("the Kintsu-like candidate is still capability-open, not funding-blocked", () => {
  const kintsu = buildDestinationFixtures(RUNTIME).find((d) => d.id === "kintsu-like-grow-delayed-return");
  assert.ok(kintsu);
  assert.equal(kintsu.capabilityStatus, "JOB_OPEN");
  // 요구 자산은 gas 뿐이다 — 즉 자금은 이 후보를 막는 요인이 아니다.
  assert.deepEqual(kintsu.currentPiggyContext.requiredAssets, ["gas"]);
  assert.deepEqual(kintsu.currentPiggyContext.missingNow, []);
});

check("even with gas and a matching chain/address, capability_open stops it first", () => {
  const kintsu = buildDestinationFixtures(RUNTIME).find((d) => d.id === "kintsu-like-grow-delayed-return");
  const now = Date.now();
  const generous = {
    source: "read_only_rpc_probe",
    chain: RUNTIME.chain,
    address: RUNTIME.address,
    destinationId: kintsu.id,
    block: 64308127,
    gas: "known",
    eligibility: "known",
    exit: "known",
    proof: "known",
    requiredAssets: ["gas"],
    availableAssets: ["gas"],
    missingNow: [],
    timestampMs: now - 1000,
    expiresAtMs: now + 5 * 60 * 1000,
  };
  const result = evaluateReadinessEvidence(kintsu, generous, { nowMs: now });
  assert.equal(result.status, "JOB_OPEN");
  assert.equal(result.reason, "capability_open");
  assert.equal(result.executionPermission, false);
});

check("delayed return stays delayed — it is never modelled as immediate", () => {
  const kintsu = buildDestinationFixtures(RUNTIME).find((d) => d.id === "kintsu-like-grow-delayed-return");
  const model = kintsu.capabilityContext.returnModel;
  assert.equal(model.type, "delayed");
  assert.equal(model.known, true);
  assert.equal(model.trackable, true);
  assert.notEqual(model.type, "immediate");
});

console.log(`\n${pass}/${pass} PASS`);
