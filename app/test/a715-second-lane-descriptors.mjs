// [A-715] Second lane descriptors (D1) — node only, no network, no tx.
//   node app/test/a715-second-lane-descriptors.mjs
// Pins:
//   NR  no-ready invariant: no descriptor, and no combination of a descriptor with a decision / rule / preview /
//       intent input, yields READY, permission, live execution, a runnable lane or a verified rate. The scan below is
//       independent of validateSecondLaneDescriptor, so mutating a descriptor AND the validator together still fails.
//   SH  shape: exactly the three evidenced candidates (Neverland USDC, Curvance USDC, Protect allowance cleanup);
//       closed key set; no address; comparable fields derived from the decision core; open gates listed.
//   SRC every recorded value traces to a quoted phrase in the build record / fork-lab receipt / readiness code.
//   E1  A-710 decision core unchanged by descriptors; liveExecution stays false; no product file imports them.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAINNET_LANE_CONFIG,
  SECOND_LANE_DESCRIPTORS,
  SECOND_LANE_DESCRIPTOR_SCHEMA,
  SECOND_LANE_OPEN_GATES,
  SECOND_LANE_STAGE,
  acceptAgreedRule,
  buildLanePermissionPreview,
  decideCurrentCandidate,
  decideCurrentCandidates,
  describeSecondLaneCandidate,
  secondLaneDescriptor,
  startLaneIntent,
  validateSecondLaneDescriptor,
} from "../src/mainnet-job-lane.js";
import { resolveChainProfile } from "../src/chain-profile.js";
import { createMemoryStorage } from "../src/second-journey-state.js";

globalThis.fetch = async () => { throw new Error("real network is forbidden in this suite"); };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "../..");
const SRC_DIR = path.join(HERE, "../src");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

let pass = 0;
let fail = 0;
let skip = 0;
async function check(label, fn) {
  try {
    const r = await fn();
    if (r === "SKIP") { console.log(`SKIP  ${label}`); skip += 1; return; }
    console.log(`PASS  ${label}`);
    pass += 1;
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 5).join("\n      ")}`);
    fail += 1;
  }
}

const IDS = ["neverland-usdc", "curvance-usdc", "protect-revoke-allowance"];
const MAINNET = resolveChainProfile("monad-mainnet");
const PIGGY = { id: "legacy-0x32b8b801348386f62ca7ca1647c7092012dd5661", address: "0x32b8B801348386f62cA7ca1647c7092012dd5661" };
const SCOPE = { accountId: PIGGY.address, chainId: "monad-mainnet" };
const EVENT = "a715-event-1";
const NOW = "2026-10-03T00:00:00.000Z";

// Independent no-ready scan. Anything that says ready / permission / live / runnable / executable / verified must
// be exactly false; no string may claim READY or a mainnet tx; no rate-like key may carry a value.
const CLAIM_KEY = /ready|permission|live|runnable|executable|verified|authori[sz]ed|granted|allowed/i;
const RATE_KEY = /ap[ry]|rate|earn|return(ed)?Pct|profit/i;
const CLAIM_STRING = /\bREADY\b|PASS_MAINNET_TX|PASS_APP_FORK_E2E|live_proven|\bverified\b|\bapproved\b/;
function noReadyClaims(value, where = "root") {
  if (Array.isArray(value)) { value.forEach((v, i) => noReadyClaims(v, `${where}[${i}]`)); return; }
  if (typeof value === "string") { assert.ok(!CLAIM_STRING.test(value), `${where}: string claims readiness: ${value}`); return; }
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value)) {
    if (CLAIM_KEY.test(k)) assert.equal(v, false, `${where}.${k} must be exactly false`);
    if (RATE_KEY.test(k) && k !== "rateVerified") assert.fail(`${where}.${k}: a rate-like field in a descriptor`);
    noReadyClaims(v, `${where}.${k}`);
  }
}

const readRow = (id, read = {}) => {
  const base = { chainId: 143, source: "fixture", observedAt: NOW, block: 108999816 };
  const status = SECOND_LANE_DESCRIPTORS[id].readerStatus;
  const values = id === "curvance-usdc" ? { holdings: { sharesRaw: "4829898", assetsRaw: "4999998" } }
    : id === "neverland-usdc" ? { holdings: { usdcRaw: "5000000", receiptRaw: "0", allowanceToPoolRaw: "0" } }
      : { allowanceRaw: "5" };
  return { id, status, reason: "fixture", read: { ...base, ...values, ...read } };
};
const firstField = (id) => SECOND_LANE_DESCRIPTORS[id].comparableFields[0];
const rule = (id, comparator, expected) => ({ kind: "agreed_rule", agreedBy: "user", eventId: EVENT, candidateId: id, field: firstField(id), comparator, expected });

// ── NR · no-ready invariant ─────────────────────────────────────────────────────────────────────────
await check("NR1 every descriptor: all locks exactly false, stage described_not_runnable, no READY / mainnet-tx / rate claim anywhere", () => {
  assert.deepEqual(Object.keys(SECOND_LANE_DESCRIPTORS).sort(), [...IDS].sort());
  for (const id of IDS) {
    const d = SECOND_LANE_DESCRIPTORS[id];
    for (const k of ["ready", "executable", "executionPermission", "createsPermission", "liveExecution", "rateVerified"]) {
      assert.ok(Object.prototype.hasOwnProperty.call(d, k), `${id}.${k} present`);
      assert.equal(d[k], false, `${id}.${k}`);
    }
    assert.equal(d.stage, "described_not_runnable");
    assert.equal(d.forkEvidence.label, "PASS_FORK_SIM", `${id}: fork simulation only`);
    noReadyClaims(d, id);
    assert.ok(Object.isFrozen(d) && Object.isFrozen(d.forkEvidence) && Object.isFrozen(d.steps) && Object.isFrozen(d.unknown) && Object.isFrozen(d.comparableFields));
  }
});

await check("NR2 validator refuses any descriptor that implies ready / permission / live / rate / mainnet evidence / an address", () => {
  const base = SECOND_LANE_DESCRIPTORS["neverland-usdc"];
  assert.deepEqual(validateSecondLaneDescriptor(base), { ok: true });
  const bad = [
    [{ ready: true }, "descriptor_lock_not_false:ready"],
    [{ ready: "false" }, "descriptor_lock_not_false:ready"],
    [{ executable: true }, "descriptor_lock_not_false:executable"],
    [{ executionPermission: true }, "descriptor_lock_not_false:executionPermission"],
    [{ createsPermission: true }, "descriptor_lock_not_false:createsPermission"],
    [{ liveExecution: true }, "descriptor_lock_not_false:liveExecution"],
    [{ rateVerified: true }, "descriptor_lock_not_false:rateVerified"],
    [{ ready: undefined }, "descriptor_lock_not_false:ready"],
    [{ stage: "READY" }, "descriptor_stage"],
    [{ supplyApr: "4.0151" }, "descriptor_unknown_key:supplyApr"],
    [{ destination: "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585" }, "descriptor_unknown_key:destination"],
    [{ protocol: "Neverland 0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585" }, "descriptor_has_address"],
    [{ forkEvidence: { ...base.forkEvidence, label: "PASS_MAINNET_TX" } }, "descriptor_evidence_class"],
    [{ forkEvidence: { ...base.forkEvidence, measuredRate: "1" } }, "descriptor_evidence_key:measuredRate"],
    [{ comparableFields: [...base.comparableFields, "anything"] }, "descriptor_fields"],
    [{ openGates: ["owner_live_go"] }, "descriptor_gates"],
    [{ unknown: [] }, "descriptor_unknown_list"],
    [{ candidateId: "fastlane-shmon" }, "descriptor_candidate_not_read"],
    [{ readerStatus: "READY" }, "descriptor_reader_status"],
  ];
  for (const [patch, error] of bad) assert.deepEqual(validateSecondLaneDescriptor({ ...base, ...patch }), { error }, JSON.stringify(patch));
  assert.deepEqual(validateSecondLaneDescriptor(null), { error: "descriptor_missing" });
  assert.equal(secondLaneDescriptor("aave-usdc"), null, "the proven Aave lane has no descriptor here");
  assert.equal(secondLaneDescriptor("kintsu-smon"), null);
  assert.equal(secondLaneDescriptor("__proto__"), null);
});

await check("NR3 combination: descriptor × every decision outcome (match / nah / unknown) is never runnable, permitted or live", () => {
  for (const id of IDS) {
    const row = readRow(id);
    const found = id === "curvance-usdc" ? "4829898" : id === "neverland-usdc" ? "5000000" : "5";
    const decisions = [
      decideCurrentCandidate({ row, agreedRule: rule(id, "eq", found), scope: SCOPE, eventId: EVENT, selectionSource: "a715", nowIso: NOW }),
      decideCurrentCandidate({ row, agreedRule: rule(id, "gt", found), scope: SCOPE, eventId: EVENT, selectionSource: "a715", nowIso: NOW }),
      decideCurrentCandidate({ row, scope: SCOPE, eventId: EVENT, selectionSource: "a715", nowIso: NOW }),
      decideCurrentCandidate({ row: readRow(id, { stale: true }), agreedRule: rule(id, "eq", found), scope: SCOPE, eventId: EVENT, nowIso: NOW }),
    ];
    assert.deepEqual(decisions.map((d) => d.decision), ["match", "nah", "unknown", "unknown"], id);
    for (const dec of decisions) {
      assert.equal(dec.executionPermission, false);
      const view = describeSecondLaneCandidate(id, dec);
      assert.equal(view.described, true);
      assert.equal(view.decision, dec.decision);
      assert.equal(view.runnable, false); assert.equal(view.executionPermission, false); assert.equal(view.liveExecution, false);
      assert.deepEqual([...view.openGates], [...SECOND_LANE_OPEN_GATES]);
      noReadyClaims(view, `${id}:${dec.decision}:view`);
      noReadyClaims(SECOND_LANE_DESCRIPTORS[id], id);
      if (dec.receipt) {
        assert.equal(dec.receipt.executionContext.executable, false);
        assert.equal(dec.receipt.selection.createsPermission, false);
        assert.equal(dec.receipt.actionCount, 0);
      }
    }
    // A decision for another candidate never lends its word to this descriptor.
    assert.equal(describeSecondLaneCandidate(id, { candidateId: "aave-usdc", decision: "match" }).decision, "unknown");
  }
  assert.equal(describeSecondLaneCandidate("aave-usdc").described, false);
  assert.equal(describeSecondLaneCandidate("aave-usdc").runnable, false);
});

await check("NR4 a descriptor is never a rule, a reading, a preview or an errand input", () => {
  for (const id of IDS) {
    const d = SECOND_LANE_DESCRIPTORS[id];
    assert.equal(acceptAgreedRule(d, { candidateId: id, eventId: EVENT }).error, "rule_not_agreed");
    const asRow = decideCurrentCandidate({ row: d, agreedRule: rule(id, "eq", "5"), scope: SCOPE, eventId: EVENT, nowIso: NOW });
    assert.equal(asRow.decision, "unknown"); assert.equal(asRow.executionPermission, false);
    assert.equal(asRow.reason, "rule_not_for_this_candidate", "a descriptor has no row id");
    const asIdRow = decideCurrentCandidate({ row: { ...d, id }, agreedRule: rule(id, "eq", "5"), scope: SCOPE, eventId: EVENT, nowIso: NOW });
    assert.equal(asIdRow.decision, "unknown"); assert.equal(asIdRow.executionPermission, false);
    assert.match(asIdRow.reason, /^evidence_unavailable:/, "a descriptor is not a reading");
    const asRule = decideCurrentCandidate({ row: readRow(id), agreedRule: d, scope: SCOPE, eventId: EVENT, nowIso: NOW });
    assert.equal(asRule.decision, "unknown"); assert.equal(asRule.reason, "rule_not_agreed");
    assert.equal(buildLanePermissionPreview({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000000", decision: d }).preview, null);
    assert.equal(buildLanePermissionPreview({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000000", decision: { ...d, result: "do_it" } }).error, "decision_binding_mismatch");
    const started = startLaneIntent({ profile: MAINNET, piggy: PIGGY, preview: d, storage: createMemoryStorage(), nowMs: 0, nowIso: NOW });
    assert.equal(started.intent, null);
  }
  // Whole-reader combination: descriptors present, every row still decides without permission.
  const all = decideCurrentCandidates({ currentRead: { candidates: IDS.map((id) => readRow(id)) }, agreedRules: Object.fromEntries(IDS.map((id) => [id, SECOND_LANE_DESCRIPTORS[id]])), scope: SCOPE, eventId: EVENT, nowIso: NOW });
  assert.equal(all.length, 3);
  for (const r of all) { assert.equal(r.decision, "unknown"); assert.equal(r.executionPermission, false); }
});

// ── SH · shape ──────────────────────────────────────────────────────────────────────────────────────
await check("SH1 closed key set, schema, chain 143, no address, comparable fields derived from the decision core", () => {
  const KEYS = ["schema", "candidateId", "family", "protocol", "asset", "chainId", "shape", "readerStatus", "comparableFields", "steps", "exit", "forkEvidence", "unknown", "stage", "openGates", "ready", "executable", "executionPermission", "createsPermission", "liveExecution", "rateVerified"];
  for (const id of IDS) {
    const d = SECOND_LANE_DESCRIPTORS[id];
    assert.deepEqual(Object.keys(d).sort(), [...KEYS].sort(), id);
    assert.equal(d.schema, SECOND_LANE_DESCRIPTOR_SCHEMA);
    assert.equal(d.candidateId, id);
    assert.equal(d.chainId, 143);
    assert.equal(d.stage, SECOND_LANE_STAGE.DESCRIBED);
    assert.equal(/0x[0-9a-fA-F]{40}/.test(JSON.stringify(d)), false, `${id}: no address`);
    assert.ok(d.unknown.includes("writer_abi"), `${id}: writer ABI stays UNKNOWN`);
    assert.ok(d.unknown.includes("gas_fee_usd"), `${id}: gas in USD stays UNKNOWN`);
    // Every comparable field is one the A-710 decision core can actually read for this candidate.
    for (const f of d.comparableFields) {
      const r = rule(id, "eq", "1"); r.field = f;
      assert.ok(acceptAgreedRule(r, { candidateId: id, eventId: EVENT }).rule, `${id}.${f} readable by the decision core`);
    }
    assert.equal(secondLaneDescriptor(id), d);
  }
  assert.deepEqual([...SECOND_LANE_DESCRIPTORS["neverland-usdc"].comparableFields], ["piggyUsdcRaw", "receiptTokenRaw", "allowanceToPoolRaw"]);
  assert.deepEqual([...SECOND_LANE_DESCRIPTORS["curvance-usdc"].comparableFields], ["sharesRaw", "assetsRaw"]);
  assert.deepEqual([...SECOND_LANE_DESCRIPTORS["protect-revoke-allowance"].comparableFields], ["allowanceRaw"]);
  assert.deepEqual([...SECOND_LANE_OPEN_GATES], ["owner_live_go", "product_reader_config", "destination_bound_in_lane", "writer_abi_in_app", "exact_permission", "lane_money_lock", "freshness_definition"]);
});

await check("SH2 values: exactly what the build record evidences, nothing more (rate / target / cooldown stay UNKNOWN)", () => {
  const nv = SECOND_LANE_DESCRIPTORS["neverland-usdc"];
  const cv = SECOND_LANE_DESCRIPTORS["curvance-usdc"];
  const pr = SECOND_LANE_DESCRIPTORS["protect-revoke-allowance"];
  const pin = { label: "PASS_FORK_SIM", chainId: 143, block: 108999816, blockTimestamp: "2026-09-29T09:24:32Z", timeWarp: false, sentRaw: "5000000", currentPin: true };
  assert.deepEqual({ ...nv.forkEvidence }, { ...pin, deltaRaw: "-1", gasUsedUserSteps: 579678 });
  assert.deepEqual({ ...cv.forkEvidence }, { ...pin, deltaRaw: "-2", gasUsedUserSteps: 293063 });
  assert.deepEqual({ ...pr.forkEvidence }, { label: "PASS_FORK_SIM", chainId: 143, block: 106616273, change: "allowance 5 -> 0", currentPin: false });
  assert.deepEqual([nv.family, nv.protocol, nv.asset, nv.shape, nv.readerStatus, nv.exit], ["grow_stable", "Neverland", "USDC", "aave_v3_fork_pool", "neverland_derived_assumed", "immediate"]);
  assert.deepEqual([cv.family, cv.protocol, cv.asset, cv.shape, cv.readerStatus, cv.exit], ["grow_stable", "Curvance", "USDC", "erc4626_vault", "curvance_erc4626", "immediate"]);
  assert.deepEqual([pr.family, pr.protocol, pr.asset, pr.shape, pr.readerStatus, pr.exit], ["protect", "ERC-20", "UNKNOWN", "erc20_allowance_reset", "protect_caller_supplied", "not_applicable"]);
  assert.deepEqual([...nv.steps], ["approve_exact", "supply", "withdraw"]);
  assert.deepEqual([...cv.steps], ["approve_exact", "deposit", "redeem"]);
  assert.deepEqual([...pr.steps], ["approve_zero"]);
  assert.deepEqual([...nv.unknown], ["destination_in_lane", "writer_abi", "rate", "gas_fee_usd", "receipt_token_shape_assumed"]);
  assert.deepEqual([...cv.unknown], ["destination_in_lane", "writer_abi", "rate", "gas_fee_usd", "cooldown"]);
  assert.deepEqual([...pr.unknown], ["target_token", "target_spender", "current_allowance", "gas_at_current_pin", "gas_fee_usd", "writer_abi"]);
});

// ── SRC · every value traces to recorded evidence ──────────────────────────────────────────────────
// Each entry: [file, exact phrase]. Line numbers at the time of writing are in the A-715 WRITER_NOTES table.
const BP = "_private/BUILD_PLAN.md";
const MX = "_private/ops/receipts/A652_mainnet_fork_lab/MAINNET_FORK_MATRIX.md";
const RD = "app/src/second-job-readiness.js";
const RDR = "app/src/second-current-reader.js";
const SOURCES = {
  "pin chain 143 block 108999816 at 2026-09-29T09:24:32Z": [BP, "block **108,999,816** (2026-09-29T09:24:32Z)"],
  "neverland/curvance PASS_FORK_SIM, immediate exit, -1/-2 raw, no time warp": [BP, "Aave v3 / Neverland / Curvance USDC — **PASS_FORK_SIM**, 즉시 exit, $5 왕복 **−1 / −1 / −2 raw units**(time warp 없음)"],
  "fork PASS is not READY / permission / APY": [BP, "fork PASS ≠ 제품 READY / permission / safety / APY / beta launch"],
  "neverland = Aave V3 fork": [BP, "**Neverland USDC**(Aave V3 포크"],
  "neverland 4h cooldown has no basis": [BP, "옛 메모의 \"Neverland 4시간 쿨다운\"은 **근거 없음**"],
  "curvance 20 min cooldown (human utterance only) → UNKNOWN": [BP, "`[사람 발화 · A-068]` Curvance **20분**"],
  "protect allowance 5 -> 0 PASS_FORK_SIM at 106,616,273": [BP, "권한정리(allowance 5→0)"],
  "A-480 pin 106,616,273": [BP, "Monad mainnet(143) 블록 106,616,273 고정 fork"],
  "protect J2-3 PARTIAL_UNKNOWN": [BP, "| J2-3 / PARTIAL_UNKNOWN |"],
  "protect: no suitable allowance → unavailable": [BP, "No suitable allowance means an explicit unavailable result"],
  "neverland steps approve → supply → withdraw": [MX, "| Neverland USDC | yes: approve → supply → withdraw, all success | immediate |"],
  "curvance steps approve → deposit → redeem, ERC-4626": [MX, "| Curvance USDC | yes: approve → deposit → redeem, all success | immediate (redeem next block, no hold observed) |"],
  "curvance ERC-4626 vault": [MX, "USDC in ERC-4626 lending vault"],
  "gas user-side: Neverland 579,678 · Curvance 293,063": [MX, "Neverland 579,678 → 0.0580 · Curvance 293,063 → 0.0293"],
  "gas USD UNKNOWN": [MX, "The USD value of gas is **UNKNOWN**"],
  "protect: destination null, target at runtime": [RD, "destination: null, // 대상 토큰은 런타임에 정해진다"],
  "protect: approve(spender, 0)": [RD, "steps: Object.freeze([\"approve(spender, 0)\"])"],
  "protect fork evidence": [RD, "forkEvidence: Object.freeze({ label: EVIDENCE_LABEL.FORK_SIM, block: 106616273, note: \"allowance 5 -> 0 (fork-evidence 2026-09)\" })"],
  "reader statuses": [RDR, "NEVERLAND_DERIVED_ASSUMED: \"neverland_derived_assumed\""],
  "reader status curvance": [RDR, "CURVANCE_ERC4626: \"curvance_erc4626\""],
  "reader status protect": [RDR, "PROTECT_CALLER_SUPPLIED: \"protect_caller_supplied\""],
  "neverland receipt token shape assumed": [RDR, "aave_v3_shape_assumed_receipt_token_derived"],
};
await check("SRC1 every descriptor value cites an exact phrase present in the recorded source", () => {
  const missingPrivate = [BP, MX].some((f) => !existsSync(path.join(REPO, f)));
  for (const [fact, [file, phrase]] of Object.entries(SOURCES)) {
    const abs = path.join(REPO, file);
    if (!existsSync(abs)) { assert.ok(file.startsWith("_private/"), `${file} missing`); continue; }
    assert.ok(readFileSync(abs, "utf8").includes(phrase), `${fact}: phrase not found in ${file}`);
  }
  if (missingPrivate) return "SKIP";
});

// ── E1 · A-710 core unchanged; boundary ─────────────────────────────────────────────────────────────
await check("E1 liveExecution false, reader null; descriptor section has no send / sign / executor / storage path", () => {
  assert.deepEqual({ ...MAINNET_LANE_CONFIG }, { reader: null, liveExecution: false });
  const lane = readFileSync(path.join(SRC_DIR, "mainnet-job-lane.js"), "utf8");
  const start = lane.indexOf("// ── [D1] Second lane descriptors");
  assert.ok(start > lane.indexOf("// ── [E1] current-reader output"), "D1 section follows the E1 core");
  const d1 = strip(lane.slice(start));
  assert.ok(d1.length > 1000);
  assert.ok(!/sendTransaction|sendRawTransaction|executeMoneyStep|executor|issuePermission|authorize\(|consume\(|sign|localStorage|setItem|getItem|fetch\(|import /.test(d1));
});

await check("E2 no product file imports a descriptor (main.js and every other src file except the lane module)", () => {
  const NAMES = /SECOND_LANE_DESCRIPTORS|secondLaneDescriptor|describeSecondLaneCandidate|validateSecondLaneDescriptor|SECOND_LANE_OPEN_GATES/;
  for (const f of readdirSync(SRC_DIR).filter((x) => x.endsWith(".js") && x !== "mainnet-job-lane.js")) {
    assert.equal(NAMES.test(readFileSync(path.join(SRC_DIR, f), "utf8")), false, `${f} references a descriptor`);
  }
});

await check("E3 A-710 decision core: a reading alone is unknown; a match is ask with no permission (unchanged)", () => {
  const row = readRow("neverland-usdc");
  const bare = decideCurrentCandidate({ row, scope: SCOPE, eventId: EVENT, nowIso: NOW });
  assert.equal(bare.decision, "unknown"); assert.equal(bare.reason, "rule_not_agreed"); assert.equal(bare.action, "none");
  const m = decideCurrentCandidate({ row, agreedRule: rule("neverland-usdc", "eq", "5000000"), scope: SCOPE, eventId: EVENT, nowIso: NOW });
  assert.equal(m.decision, "match"); assert.equal(m.action, "ask"); assert.equal(m.executionPermission, false); assert.equal(m.receipt, null);
  assert.equal(Object.keys(m).some((k) => /ready/i.test(k)), false);
});

console.log(`\n${pass}/${pass + fail} PASS${skip ? ` (${skip} SKIP)` : ""}`);
if (fail) process.exit(1);
