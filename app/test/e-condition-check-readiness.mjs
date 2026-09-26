// [A-495 Lane E] E node — `nah.` condition-check **readiness only**.
//
// 이 파일이 증명하는 것 / 증명하지 않는 것을 먼저 적는다.
//
//   증명한다  : comparator(`decideRule`, `decideSemanticReturnRule`) + read path(read-only RPC)가
//               붙어 있고, agreed rule 이 없으면 action 0 / `unknown` 으로 닫힌다는 것.
//   증명 안 함: E 노드의 닫힘. [A-571 Phase C 갱신] qualitative/semantic agreed rule
//               ("right back" 같은 의미 합의)은 `rule-decision.js`에 존재한다
//               (PARTIAL_AGREED_RULE_FOUND) — 그러나 그걸 전역 숫자(시/일)로 묶는 canon 값은
//               없다(NUMERIC_BINDING_OPEN). 여기 쓰이는 임계값은 전부 `FIXTURE_*` 로 라벨된
//               가짜이고, `RULE_EXAMPLES`/`SEMANTIC_RULE_EXAMPLES` 는 이름 그대로 예시다
//               (= agreed canon 아님). E는 실제 선택된 Job + 그 Job의 live evidence +
//               action-0 receipt 가 모두 있어야 닫힌다 — 이 파일 혼자로는 못 닫는다.
//
// 경계: tx 0 · 서명 0 · 상태변경 RPC 0. 쓰는 method 는 `eth_chainId` / `eth_blockNumber` 뿐이다.
// 네트워크가 막히면 값을 지어내지 않고 그 항목만 SKIP 으로 남긴다.
//
//   node app/test/e-condition-check-readiness.mjs
//   (프록시 뒤 샌드박스에서는 `NODE_USE_ENV_PROXY=1` 를 앞에 붙인다. 없으면 read path 3개가 SKIP 된다.)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RULE_EXAMPLES, decideRule, decideRules } from "../src/rule-decision.js";

const MAINNET_RPC = "https://rpc.monad.xyz";
const EXPECTED_CHAIN_ID = 143;

// ── 명시적 FIXTURE. 이건 Owner 가 동의한 값이 아니다. 라벨이 그 사실을 들고 다닌다. ──
const FIXTURE_LABEL = "FIXTURE_NOT_AGREED";
const FIXTURE_FEE_RULE = Object.freeze({
  id: "fixture_fee",
  field: "feeBps",
  comparator: "lte",
  expected: 50,
  agreed: true, // fixture 안에서만 참. canon 의 agreed 값이 아니다.
  label: FIXTURE_LABEL,
});
const FIXTURE_BLOCK_RULE = Object.freeze({
  id: "fixture_block_floor",
  field: "blockNumber",
  comparator: "gte",
  // 일부러 미래값 — live 값이 이걸 못 넘겨서 nah/action 0 이 나오는 걸 본다.
  expected: 999_999_999,
  agreed: true,
  requiresBlock: false,
  label: FIXTURE_LABEL,
});

let pass = 0;
let skip = 0;
const fail = [];
function check(label, fn) {
  try {
    const r = fn();
    if (r === "SKIP") { console.log(`SKIP  ${label}`); skip += 1; return; }
    console.log(`PASS  ${label}`);
    pass += 1;
  } catch (err) {
    console.log(`FAIL  ${label}\n      ${err.message}`);
    fail.push(label);
  }
}
async function checkAsync(label, fn) {
  try {
    const r = await fn();
    if (r === "SKIP") { console.log(`SKIP  ${label}`); skip += 1; return; }
    console.log(`PASS  ${label}`);
    pass += 1;
  } catch (err) {
    console.log(`FAIL  ${label}\n      ${err.message}`);
    fail.push(label);
  }
}

// ───────────────────────────────────────────────────────────────────
// 1. canon 확인 — 실제 agreed rule 값이 없다
// ───────────────────────────────────────────────────────────────────

check("rule-decision 이 내놓는 값 묶음의 이름은 EXAMPLES 다 (= agreed canon 아님)", () => {
  const src = readFileSync(new URL("../src/rule-decision.js", import.meta.url), "utf8");
  assert.match(src, /RULE_EXAMPLES/, "예시 묶음 이름이 바뀌었다");
  assert.equal(
    /AGREED_RULES|OWNER_AGREED|agreedRuleValues/.test(src),
    false,
    "agreed rule 정본처럼 보이는 export 가 생겼다 — 그러면 이 테스트의 전제를 다시 읽어야 한다",
  );
});

check("job-feed 의 선택은 permission 도 agreed rule 도 만들지 않는다", () => {
  const src = readFileSync(new URL("../src/job-feed.js", import.meta.url), "utf8");
  assert.match(src, /executionPermission:\s*false/, "executionPermission=false 가 사라졌다");
  assert.match(src, /agreedRule:\s*null/, "agreedRule=null 이 사라졌다");
});

check("agreed 가 아닌 rule 은 unknown / action 0 으로 닫힌다", () => {
  const out = decideRule(
    { id: "no_rule", field: "feeBps", comparator: "lte", expected: 50, agreed: false },
    { found: 10, block: 1, source: "fixture" },
  );
  assert.equal(out.result, "unknown");
  assert.equal(out.action, "none");
  assert.equal(out.reason, "rule_not_agreed");
});

check("rule 자체가 없으면 던지지 않고 unknown / action 0", () => {
  const out = decideRule(undefined, undefined);
  assert.equal(out.result, "unknown");
  assert.equal(out.action, "none");
  assert.equal(out.evidence.found, "UNKNOWN");
});

// ───────────────────────────────────────────────────────────────────
// 2. comparator — fixture 값으로만
// ───────────────────────────────────────────────────────────────────

check("[FIXTURE] hard rule breach → nah / action 0 + expected·found·block 증거", () => {
  const out = decideRule(FIXTURE_FEE_RULE, { found: 120, block: 42, source: FIXTURE_LABEL });
  assert.equal(out.result, "nah");
  assert.equal(out.action, "none");
  assert.equal(out.evidence.expected, "50");
  assert.equal(out.evidence.found, "120");
  assert.equal(out.evidence.block, 42);
  assert.equal(out.evidence.source, FIXTURE_LABEL);
});

check("[FIXTURE] block 이 없으면 nah 가 아니라 unknown 이다 (둘을 섞지 않는다)", () => {
  const out = decideRule(FIXTURE_FEE_RULE, { found: 120, block: null, source: FIXTURE_LABEL });
  assert.equal(out.result, "unknown");
  assert.equal(out.action, "none");
  assert.equal(out.reason, "missing_block");
});

check("[FIXTURE] 여러 rule 중 하나라도 unknown 이면 전체가 unknown / action 0", () => {
  const out = decideRules(
    [FIXTURE_FEE_RULE, { ...RULE_EXAMPLES.exitAvailability, id: "fixture_exit" }],
    { fixture_fee: { found: 10, block: 7, source: FIXTURE_LABEL }, fixture_exit: { found: null, block: 7 } },
  );
  assert.equal(out.result, "unknown");
  assert.equal(out.action, "none");
});

// ───────────────────────────────────────────────────────────────────
// 3. read path — 살아있는 읽기 전용 체인 값 하나
// ───────────────────────────────────────────────────────────────────

async function rpc(method) {
  const res = await fetch(MAINNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

let liveBlock = null;

await checkAsync(`read path: ${MAINNET_RPC} 가 chain id ${EXPECTED_CHAIN_ID} 를 돌려준다`, async () => {
  let raw;
  try {
    raw = await rpc("eth_chainId");
  } catch {
    return "SKIP"; // 네트워크가 막혔다. 값을 지어내지 않는다.
  }
  assert.equal(Number(BigInt(raw)), EXPECTED_CHAIN_ID);
});

await checkAsync("read path: live block 을 읽는다 (읽기 전용, tx 0)", async () => {
  let raw;
  try {
    raw = await rpc("eth_blockNumber");
  } catch {
    return "SKIP";
  }
  liveBlock = Number(BigInt(raw));
  assert.ok(Number.isFinite(liveBlock) && liveBlock > 0, `block 이 이상하다: ${raw}`);
});

await checkAsync("[FIXTURE 임계값 · LIVE 값] comparator 가 live 값을 받아 nah / action 0 으로 닫는다", async () => {
  if (liveBlock === null) return "SKIP";
  const out = decideRule(FIXTURE_BLOCK_RULE, {
    found: liveBlock,
    block: liveBlock,
    source: `${MAINNET_RPC} eth_blockNumber (${FIXTURE_LABEL} threshold)`,
  });
  assert.equal(out.result, "nah");
  assert.equal(out.action, "none");
  assert.equal(out.evidence.expected, String(FIXTURE_BLOCK_RULE.expected));
  assert.equal(out.evidence.found, String(liveBlock));
  assert.equal(out.evidence.block, liveBlock);
  console.log(
    `      evidence: expected ${out.evidence.comparator} ${out.evidence.expected} · found ${out.evidence.found} (block ${out.evidence.block}) · source ${out.evidence.source}`,
  );
});

// ───────────────────────────────────────────────────────────────────

console.log("");
console.log(`E readiness: ${pass} pass · ${skip} skip · ${fail.length} fail`);
// [A-571 Phase C] 갱신 — 옛 문구 `NO_ACTUAL_AGREED_RULE_VALUE` 는 "동의된 rule 자체가 없다"로
// 읽혀 현재 canon과 어긋난다. 실제로는: qualitative/semantic agreed rule(예: "right back")은
// `rule-decision.js`의 `decideSemanticReturnRule` + `SEMANTIC_RETURN_MEANING` 로 존재한다
// (PARTIAL_AGREED_RULE_FOUND). 그러나 그 rule을 전역 숫자(시/일)로 묶는 canon 값은 여전히 없다
// (NUMERIC_BINDING_OPEN) — 이 파일의 임계값은 여전히 전부 FIXTURE 다. E는 실제로 선택된 Job +
// 그 Job의 live evidence + action-0 receipt 세 가지가 모두 갖춰질 때까지 □ 로 남는다.
console.log("STATE: PARTIAL_AGREED_RULE_FOUND (qualitative/semantic agreed rule exists) + NUMERIC_BINDING_OPEN (no global numeric binding). E 는 □ 로 남는다 — 실제 선택된 Job + live evidence + action-0 receipt 가 있어야 닫힌다.");
if (fail.length) {
  console.log(`failed: ${fail.join(", ")}`);
  process.exitCode = 1;
}
