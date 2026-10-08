// [A-762] Second mainnet merge — per-protocol descriptors, read-only routing, fail-closed execution routes.
// Node only, no network, no tx, no sign.   node app/test/a762-second-mainnet-merge.mjs
//   D  descriptors stay protocol-specific (no shared lowest-common-denominator shape) and match the lanes
//   R  reader routing preserves per-protocol evidence / UNKNOWN fields (no drop, no coercion)
//   X  the execution route refuses every protocol, every step, every forged input; liveExecution stays false
//   K  Kintsu return is never complete / immediate
//   G  aBIL eligibility / rights gates stay blocking
//   S  source boundaries: product does not import the lanes; no live path
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as NEVERLAND from "../src/mainnet-job-neverland.js";
import * as CURVANCE from "../src/mainnet-job-curvance.js";
import * as ABIL from "../src/mainnet-job-abil.js";
import * as KINTSU from "../src/mainnet-job-kintsu.js";
import { MAINNET_LANE_CONFIG } from "../src/mainnet-job-lane.js";
import { resolveChainProfile } from "../src/chain-profile.js";
import {
  CURRENT_READER_STATUS as S, SECOND_READER_ROUTES, SECOND_READER_ROUTE_IDS, readSecondCurrent, routeSecondCurrentRead, routeSecondCurrentRow,
} from "../src/second-current-reader.js";
import {
  SECOND_MAINNET_DESCRIPTORS, SECOND_MAINNET_DESCRIPTOR_SCHEMA, SECOND_MAINNET_JOB_IDS, routeSecondMainnetExecution, secondKintsuReturnView,
  validateSecondMainnetDescriptor,
} from "../src/second-execution-adapter.js";

globalThis.fetch = async () => { throw new Error("real network is forbidden in this suite"); };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(HERE, "../src");
const SRC = (f) => readFileSync(path.join(SRC_DIR, f), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) {
    console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 5).join("\n      ")}`);
    fail += 1;
  }
}

const IDS = ["aave-usdc", "neverland-usdc", "curvance-usdc", "abil-spot", "kintsu-smon"];
const PROTOCOL = { "aave-usdc": "aave", "neverland-usdc": "neverland", "curvance-usdc": "curvance", "abil-spot": "abil", "kintsu-smon": "kintsu" };
const LANES = Object.freeze({ "neverland-usdc": NEVERLAND, "curvance-usdc": CURVANCE, "abil-spot": ABIL, "kintsu-smon": KINTSU });
const MAINNET = resolveChainProfile("monad-mainnet");
const PIGGY = { id: "legacy-0x32b8b801348386f62ca7ca1647c7092012dd5661", address: "0x32b8B801348386f62cA7ca1647c7092012dd5661" };
const NOW = "2026-10-05T00:00:00.000Z";
const LOCKS = ["ready", "executable", "executionPermission", "createsPermission", "liveExecution"];

// Reader-shaped rows (same keys readSecondCurrent emits per protocol).
const base = { source: "fixture", observedAt: NOW, chainId: 143, block: 109000000, codePresent: true };
const ROWS = {
  "aave-usdc": { id: "aave-usdc", status: S.AAVE_BUILDABLE, reason: "read_via_lane_pre_action", read: { ...base, pool: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef", receiptToken: { symbol: "aMonUSDC", address: "0x35a73BAcb179d3740395A3ceCc87FF2e581d6042", matchesRecorded: true }, reserve: { supplyCapRaw: null, frozen: false }, holdings: { usdcRaw: "5000000", receiptRaw: "0", allowanceToPoolRaw: "0" } } },
  "neverland-usdc": { id: "neverland-usdc", status: S.NEVERLAND_DERIVED_ASSUMED, reason: "aave_v3_shape_assumed_receipt_token_derived", read: { ...base, pool: "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585", receiptToken: { address: "0x38648958836eA88b368b4ac23b86Ad44B0fe7508", derived: true }, holdings: { usdcRaw: "5000000", receiptRaw: "0", allowanceToPoolRaw: "0" } }, assumptions: ["pool exposes aave v3 getReserveData", "aTokenAddress is the receipt token"] },
  "curvance-usdc": { id: "curvance-usdc", status: S.CURVANCE_ERC4626, reason: "erc4626_views", read: { ...base, vault: "0x8EE9FC28B8Da872c38A496e9dDB9700bb7261774", holdings: { sharesRaw: "4829898", assetsRaw: "4999998" }, vaultTotalAssetsRaw: "900000000" } },
  "abil-spot": { id: "abil-spot", status: S.ABIL_QUOTE_INCOMPLETE, reason: "pool_identity_matches_recorded_quote_unknown", read: { ...base, identityMatchesRecorded: true, poolLiquidityRaw: "1", holdings: { usdcRaw: "0", abilRaw: "0", usdcAllowanceToRouterRaw: "0", abilAllowanceToRouterRaw: "0" }, quote: { value: null, status: "UNKNOWN", reason: "no_recorded_quoter_or_price_view" }, recorded: { source: "x", block: 108999816 } }, unknown: ["quote", "dividend", "eligibility"] },
  "kintsu-smon": { id: "kintsu-smon", status: S.KINTSU_OBSERVATION, reason: "return_observation_only", read: { ...base, exitFeeInBips: 10 }, note: "contract-state observation (chain / code / exit fee); the account's sMON balance is not read here" },
};
const READ = { kind: "second_current_read", piggyAddress: PIGGY.address, candidates: [...IDS.map((id) => ROWS[id]), { id: "kuru", status: S.UNAVAILABLE, reason: "no_exported_address_or_abi", read: null }] };
const ROUTED = routeSecondCurrentRead(READ);
const routeOf = (id, routed = ROUTED) => routed.routes.find((r) => r.jobId === id);
const forged = (jobId, extra = {}) => ({ ...MAINNET, jobId, ...extra });
const FORK_EXEC = { kind: "local_fork", chainId: 143, forkBlock: 108999816, send: async () => { throw new Error("no send in this suite"); }, receipt: async () => null };
const EXECUTORS = [undefined, null, {}, FORK_EXEC, { ...FORK_EXEC, kind: "live" }];

// ── D · descriptors ─────────────────────────────────────────────────────────────────────────────────
await check("D1 five descriptors, each with its OWN protocol block and no other protocol's; locks false; frozen; valid", () => {
  assert.deepEqual([...SECOND_MAINNET_JOB_IDS], IDS);
  for (const id of IDS) {
    const d = SECOND_MAINNET_DESCRIPTORS[id];
    assert.equal(d.schema, SECOND_MAINNET_DESCRIPTOR_SCHEMA);
    assert.equal(d.jobId, id); assert.equal(d.protocol, PROTOCOL[id]);
    assert.ok(Object.prototype.hasOwnProperty.call(d, PROTOCOL[id]), `${id}: own block`);
    for (const other of Object.values(PROTOCOL)) if (other !== PROTOCOL[id]) assert.equal(Object.prototype.hasOwnProperty.call(d, other), false, `${id}: no ${other} block`);
    for (const k of LOCKS) assert.equal(d[k], false, `${id}.${k}`);
    assert.ok(Object.isFrozen(d) && Object.isFrozen(d[d.protocol]) && Object.isFrozen(d.steps) && Object.isFrozen(d.lane));
    assert.deepEqual(validateSecondMainnetDescriptor(d), { ok: true });
  }
});

await check("D2 no lowest-common-denominator: protocol block key sets all differ and steps are each protocol's own", () => {
  const keySets = IDS.map((id) => Object.keys(SECOND_MAINNET_DESCRIPTORS[id][PROTOCOL[id]]).sort().join(","));
  assert.equal(new Set(keySets).size, IDS.length, "every protocol block has a different shape");
  const steps = IDS.map((id) => SECOND_MAINNET_DESCRIPTORS[id].steps.join(","));
  assert.equal(new Set(steps).size, IDS.length);
  assert.deepEqual([...SECOND_MAINNET_DESCRIPTORS["kintsu-smon"].steps], Object.keys(KINTSU.KINTSU_STEPS));
  assert.deepEqual([...SECOND_MAINNET_DESCRIPTORS["neverland-usdc"].steps], Object.keys(NEVERLAND.NEVERLAND_STEPS));
  assert.deepEqual([...SECOND_MAINNET_DESCRIPTORS["curvance-usdc"].steps], Object.keys(CURVANCE.CURVANCE_STEPS));
  assert.deepEqual([...SECOND_MAINNET_DESCRIPTORS["abil-spot"].steps], [...ABIL.ABIL_STEPS]);
  // Protocol-specific facts that would be lost in a shared shape:
  assert.equal(SECOND_MAINNET_DESCRIPTORS["neverland-usdc"].neverland.receiptTokenShape, "reader_assumed");
  assert.equal(SECOND_MAINNET_DESCRIPTORS["curvance-usdc"].curvance.sharesAssumedEqualToAmount, false);
  assert.equal(SECOND_MAINNET_DESCRIPTORS["kintsu-smon"].kintsu.returnProof, "unproven");
  assert.equal(SECOND_MAINNET_DESCRIPTORS["abil-spot"].abil.rightsGate.required, true);
  assert.equal(SECOND_MAINNET_DESCRIPTORS["aave-usdc"].aave.receiptTokenMustMatchRecorded, true);
  // Reader routes are per protocol too.
  assert.deepEqual([...SECOND_READER_ROUTE_IDS], IDS);
  assert.equal(new Set(IDS.map((id) => SECOND_READER_ROUTES[id].observedStatuses.join())).size, IDS.length);
});

await check("D3 descriptors match the lane modules' own exports (drift check is real)", () => {
  const nv = SECOND_MAINNET_DESCRIPTORS["neverland-usdc"].neverland;
  assert.deepEqual([...nv.unknownFields], [...NEVERLAND.NEVERLAND_UNKNOWN_FIELDS]);
  assert.deepEqual([...nv.unprovenSteps], [...NEVERLAND.NEVERLAND_UNPROVEN_STEPS]);
  assert.equal(nv.exitObserved, NEVERLAND.NEVERLAND_FORK_EVIDENCE.exitObserved);
  const cv = SECOND_MAINNET_DESCRIPTORS["curvance-usdc"].curvance;
  assert.deepEqual([...cv.unknownFields], [...CURVANCE.CURVANCE_UNKNOWN_FIELDS]);
  assert.deepEqual([...cv.unprovenSteps], [...CURVANCE.CURVANCE_UNPROVEN_STEPS]);
  assert.deepEqual([...SECOND_MAINNET_DESCRIPTORS["abil-spot"].abil.blockingFields], [...ABIL.ABIL_BLOCKING_FIELD_NAMES]);
  assert.deepEqual([...SECOND_MAINNET_DESCRIPTORS["kintsu-smon"].kintsu.unprovenSteps], [...KINTSU.KINTSU_UNPROVEN_STEPS]);
  assert.equal(SECOND_MAINNET_DESCRIPTORS["kintsu-smon"].evidenceClass, KINTSU.KINTSU_FORK_EVIDENCE.label);
  // With the real lanes bound, no route reports drift or an unbound lane.
  for (const id of IDS) {
    const out = routeSecondMainnetExecution({ jobId: id, step: SECOND_MAINNET_DESCRIPTORS[id].steps[0], route: routeOf(id), lanes: LANES, profile: forged(id), piggy: PIGGY });
    assert.equal(out.blockedBy.some((b) => /drift|lane_not_bound/.test(b)), false, `${id}: ${out.blockedBy.join(" | ")}`);
  }
});

await check("D4 validator refuses descriptors that claim readiness, borrow another protocol's block, or loosen a gate", () => {
  const bad = [
    ["neverland-usdc", { ready: true }, "descriptor_lock_not_false:ready"],
    ["neverland-usdc", { liveExecution: undefined }, "descriptor_lock_not_false:liveExecution"],
    ["curvance-usdc", { aave: {} }, "descriptor_foreign_block:aave"],
    ["curvance-usdc", { curvance: { ...SECOND_MAINNET_DESCRIPTORS["curvance-usdc"].curvance, sharesAssumedEqualToAmount: true } }, "curvance_one_to_one_claimed"],
    ["neverland-usdc", { neverland: { ...SECOND_MAINNET_DESCRIPTORS["neverland-usdc"].neverland, receiptTokenShape: "proven" } }, "neverland_shape_claimed"],
    ["kintsu-smon", { kintsu: { ...SECOND_MAINNET_DESCRIPTORS["kintsu-smon"].kintsu, returnComplete: true } }, "kintsu_return_claimed"],
    ["kintsu-smon", { kintsu: { ...SECOND_MAINNET_DESCRIPTORS["kintsu-smon"].kintsu, immediateExit: true } }, "kintsu_return_claimed"],
    ["abil-spot", { abil: { ...SECOND_MAINNET_DESCRIPTORS["abil-spot"].abil, rightsGate: { required: true, satisfied: true } } }, "abil_rights_gate_not_blocking"],
    ["abil-spot", { abil: { ...SECOND_MAINNET_DESCRIPTORS["abil-spot"].abil, blockingFields: ["rights", "quote"] } }, "abil_gate_not_blocking:eligibility"],
    ["aave-usdc", { protocol: "lending" }, "descriptor_protocol_block"],
  ];
  for (const [id, patch, error] of bad) assert.deepEqual(validateSecondMainnetDescriptor({ ...SECOND_MAINNET_DESCRIPTORS[id], ...patch }), { error }, `${id} ${JSON.stringify(patch)}`);
  assert.deepEqual(validateSecondMainnetDescriptor(null), { error: "descriptor_missing" });
});

// ── R · reader routing ──────────────────────────────────────────────────────────────────────────────
await check("R1 routing preserves each protocol's read, unknown list, unknownClass, assumptions and note exactly", () => {
  assert.equal(ROUTED.routes.length + ROUTED.unrouted.length, READ.candidates.length);
  assert.deepEqual(ROUTED.unrouted[0], READ.candidates[5]);
  for (const id of IDS) {
    const r = routeOf(id);
    const row = ROWS[id];
    assert.equal(r.protocol, PROTOCOL[id]); assert.equal(r.status, row.status); assert.equal(r.reason, row.reason);
    assert.deepEqual(r.read, row.read, `${id}: read unchanged`);
    assert.notEqual(r.read, row.read, "a copy, not the caller's object");
    assert.ok(Object.isFrozen(r.read));
    for (const u of row.unknown || []) assert.ok(r.unknown.includes(u), `${id}: ${u} kept`);
    for (const g of SECOND_READER_ROUTES[id].readerGaps) assert.ok(r.unknown.includes(g), `${id}: reader gap ${g}`);
    assert.deepEqual([...r.assumptions], row.assumptions || []);
    assert.equal(r.note, row.note ?? null);
    assert.equal(r.evidence, "observed");
    for (const k of ["executionPermission", "liveExecution"]) assert.equal(r[k], false);
    assert.equal(r.decision, "unknown"); assert.equal(r.action, "none"); assert.equal(r.actionCount, 0);
  }
  assert.equal(routeOf("abil-spot").read.quote.value, null, "null stays null");
  assert.equal(routeOf("aave-usdc").read.reserve.supplyCapRaw, null, "an unread cap stays null, never 0");
  assert.equal(routeOf("abil-spot").read.quote.status, "UNKNOWN");
  assert.ok(routeOf("kintsu-smon").unknown.includes("final_return_value"));
  assert.ok(routeOf("neverland-usdc").unknown.includes("receipt_token_shape_assumed"));
  assert.ok(routeOf("curvance-usdc").unknown.includes("realized_exit_assets"));
});

await check("R2 unknown / missing / conflicting rows stay UNKNOWN with their class; nothing is dropped or upgraded", async () => {
  // aBIL unknown row exactly as the reader emits it
  const abilUnknown = { id: "abil-spot", status: S.UNKNOWN, reason: "stale:rpc_head_behind_recorded_evidence", read: null, unknownClass: "stale", unknown: ["quote", "dividend", "eligibility"] };
  const r1 = routeSecondCurrentRow(abilUnknown);
  assert.equal(r1.evidence, "unknown"); assert.equal(r1.unknownClass, "stale"); assert.equal(r1.read, null); assert.equal(r1.reason, abilUnknown.reason);
  // a row's own unknown that no route lists is still carried
  const custom = routeSecondCurrentRow({ ...ROWS["curvance-usdc"], unknown: ["row_specific_unknown"] });
  assert.ok(custom.unknown.includes("row_specific_unknown"));
  // missing rows
  const empty = routeSecondCurrentRead({ candidates: [] });
  assert.deepEqual(empty.routes.map((r) => [r.jobId, r.evidence, r.unknownClass, r.reason]), IDS.map((id) => [id, "unknown", "missing", "row_missing"]));
  // a status from another protocol is conflicting, and the read is still kept for inspection
  const cross = routeSecondCurrentRow({ ...ROWS["neverland-usdc"], status: S.AAVE_BUILDABLE });
  assert.equal(cross.evidence, "unknown"); assert.equal(cross.unknownClass, "conflicting");
  assert.equal(cross.reason, `status_not_for_protocol:${S.AAVE_BUILDABLE}`);
  assert.deepEqual(cross.read, ROWS["neverland-usdc"].read);
  // observed status but a protocol evidence key missing -> unknown, not partially observed
  const { holdings, ...noHoldings } = ROWS["curvance-usdc"].read;
  const partial = routeSecondCurrentRow({ ...ROWS["curvance-usdc"], read: noHoldings });
  assert.equal(partial.evidence, "unknown"); assert.equal(partial.reason, "evidence_missing:holdings");
  // failures keep their reason
  const failed = routeSecondCurrentRow({ id: "kintsu-smon", status: S.READ_FAILED, reason: "rpc_unreachable", read: null });
  assert.equal(failed.evidence, "unknown"); assert.equal(failed.reason, "rpc_unreachable");
  // unrouted ids and garbage
  assert.equal(routeSecondCurrentRow({ id: "__proto__" }).jobId, null);
  assert.equal(routeSecondCurrentRow(null).reason, "unrouted_candidate");
  // a real read with no transport: every protocol unknown, reasons preserved
  const real = routeSecondCurrentRead(await readSecondCurrent({ profile: MAINNET, piggyAddress: PIGGY.address }));
  for (const r of real.routes) { assert.equal(r.evidence, "unknown"); assert.equal(r.read, null); assert.match(r.reason, /no_rpc/); }
  assert.ok(real.routes.find((r) => r.jobId === "abil-spot").unknown.includes("quote"));
});

// ── X · execution routes ─────────────────────────────────────────────────────────────────────────────
const PROFILES = (id) => [MAINNET, forged(id), forged(id, { liveExecution: true }), forged(id, { liveExecution: undefined }), null, {}];
await check("X1 every protocol × every step × profile × executor × claim: allowed false, action 0, live false", () => {
  let n = 0;
  for (const id of IDS) {
    for (const step of [...SECOND_MAINNET_DESCRIPTORS[id].steps, "nope", undefined]) {
      for (const profile of PROFILES(id)) {
        for (const executor of EXECUTORS) {
          for (const route of [routeOf(id), routeOf(IDS[(IDS.indexOf(id) + 1) % IDS.length]), null, { ...routeOf(id), evidence: "observed", ready: true }]) {
            const out = routeSecondMainnetExecution({ jobId: id, step, route, lanes: LANES, profile, piggy: PIGGY, executor, proof: { complete: true }, ready: true, liveExecution: true });
            assert.equal(out.allowed, false); assert.equal(out.action, "none"); assert.equal(out.actionCount, 0); assert.equal(out.sent, false);
            for (const k of LOCKS) assert.equal(out[k], false);
            assert.ok(out.blockedBy.includes("merge_route_has_no_execution_path"));
            assert.ok(out.blockedBy.includes("live_gate_closed") || out.blockedBy.includes("live_execution_disabled"));
            assert.ok(Object.isFrozen(out));
            n += 1;
          }
        }
      }
    }
  }
  assert.ok(n > 1500, `combinations ${n}`);
  assert.equal(routeSecondMainnetExecution({ jobId: "fastlane-shmon" }).reason, "unknown_route");
  assert.equal(routeSecondMainnetExecution({ jobId: "__proto__" }).reason, "unknown_route");
  assert.equal(routeSecondMainnetExecution(null).allowed, false);
});

await check("X2 per-protocol refusals: each protocol is refused by its OWN boundary / missing proof", () => {
  const go = (id, step, extra = {}) => routeSecondMainnetExecution({ jobId: id, step, route: routeOf(id), lanes: LANES, profile: forged(id), piggy: PIGGY, executor: FORK_EXEC, ...extra });
  const aave = go("aave-usdc", "supply");
  assert.equal(aave.reason, "aave_guarded_boundary_only");
  const aaveBad = go("aave-usdc", "supply", { route: routeSecondCurrentRow({ ...ROWS["aave-usdc"], read: { ...ROWS["aave-usdc"].read, receiptToken: { ...ROWS["aave-usdc"].read.receiptToken, matchesRecorded: false } } }) });
  assert.equal(aaveBad.reason, "aave_receipt_token_not_matching_recorded");
  const nv = go("neverland-usdc", "approve");
  assert.equal(nv.reason, "lane:unknown_field:exitTiming");
  assert.ok(nv.blockedBy.includes("neverland_receipt_token_shape_assumed"));
  for (const f of NEVERLAND.NEVERLAND_UNKNOWN_FIELDS) assert.ok(nv.blockedBy.includes(`unknown_field:${f}`));
  assert.ok(go("neverland-usdc", "withdrawPartial").blockedBy.includes("lane:unproven_step:withdrawPartial"));
  const cv = go("curvance-usdc", "deposit");
  assert.equal(cv.reason, "lane:unknown_field:exitTiming");
  for (const f of CURVANCE.CURVANCE_UNKNOWN_FIELDS) assert.ok(cv.blockedBy.includes(`unknown_field:${f}`));
  for (const s of ["redeemPartial", "withdraw", "mint"]) assert.ok(go("curvance-usdc", s).blockedBy.includes(`unproven_step:${s}`));
  const ab = go("abil-spot", "buy");
  assert.equal(ab.reason, "lane:rights_gate_unsatisfied");
  const ks = go("kintsu-smon", "deposit");
  assert.match(ks.reason, /^lane:/);
  assert.ok(ks.blockedBy.includes("kintsu_return_unproven"));
  for (const s of ["submitBatch", "redeem", "return"]) assert.ok(go("kintsu-smon", s).blockedBy.includes(`lane:unproven_step:${s}`));
  // Reader evidence that is not observed is a protocol refusal before the lane is consulted.
  const nvNoRead = go("neverland-usdc", "approve", { route: routeSecondCurrentRow(null, "neverland-usdc") });
  assert.equal(nvNoRead.reason, "reader_evidence_unknown:missing");
  assert.equal(go("curvance-usdc", "deposit", { route: routeOf("neverland-usdc") }).reason, "reader_route_job_mismatch");
  // Distinct first reasons across protocols: no shared refusal shape.
  assert.equal(new Set([aave, nv, ab, ks].map((o) => o.reason)).size, 4);
});

await check("X3 fail closed on lane binding: missing, swapped, drifted or lying lanes are refused, never trusted", () => {
  const go = (id, lanes, step = SECOND_MAINNET_DESCRIPTORS[id].steps[0]) => routeSecondMainnetExecution({ jobId: id, step, route: routeOf(id), lanes, profile: forged(id), piggy: PIGGY, executor: FORK_EXEC });
  for (const id of IDS.filter((x) => x !== "aave-usdc")) {
    assert.ok(go(id, {}).blockedBy.includes("lane_not_bound"), id);
    assert.ok(go(id, undefined).blockedBy.includes("lane_not_bound"), id);
  }
  assert.ok(go("neverland-usdc", { "neverland-usdc": CURVANCE }).blockedBy.includes("lane_descriptor_drift:job_id"));
  // A lane that claims a now-proven field / a lying gate that returns allowed:true.
  const nvDrift = { ...NEVERLAND, NEVERLAND_UNKNOWN_FIELDS: NEVERLAND.NEVERLAND_UNKNOWN_FIELDS.slice(1) };
  assert.ok(go("neverland-usdc", { "neverland-usdc": nvDrift }).blockedBy.includes("lane_descriptor_drift:neverland_unknowns"));
  const liar = { ...CURVANCE, curvanceExecutionGate: () => ({ allowed: true, reason: "ok", actionCount: 1 }) };
  const lied = go("curvance-usdc", { "curvance-usdc": liar });
  assert.equal(lied.allowed, false); assert.equal(lied.actionCount, 0);
  assert.ok(lied.blockedBy.includes("lane:ok") && lied.blockedBy.includes("merge_route_has_no_execution_path"));
  const thrower = { ...NEVERLAND, neverlandExecutionGate: () => { throw new Error("x"); } };
  assert.ok(go("neverland-usdc", { "neverland-usdc": thrower }).blockedBy.includes("lane:gate_unreadable"));
  const kDrift = { ...KINTSU, KINTSU_STAGE: { ...KINTSU.KINTSU_STAGE, RETURNED: "returned" } };
  assert.ok(go("kintsu-smon", { "kintsu-smon": kDrift }).blockedBy.includes("lane_descriptor_drift:kintsu_return_stage"));
  const kNoReturn = { ...KINTSU, KINTSU_UNPROVEN_STEPS: ["submitBatch", "redeem"] };
  assert.ok(go("kintsu-smon", { "kintsu-smon": kNoReturn }).blockedBy.includes("lane_descriptor_drift:kintsu_unproven_steps"));
  assert.equal(MAINNET_LANE_CONFIG.liveExecution, false); assert.equal(MAINNET_LANE_CONFIG.reader, null);
});

// ── K · Kintsu return ───────────────────────────────────────────────────────────────────────────────
await check("K1 Kintsu return is never complete / immediate, for any stage, claim or lane", () => {
  const stages = [...Object.values(KINTSU.KINTSU_STAGE), "returned", "redeemed", "done", "complete", undefined, null, { returnComplete: true }];
  for (const lanes of [LANES, {}, { "kintsu-smon": { ...KINTSU, kintsuOutcomeWord: () => "returned" } }]) {
    for (const stage of stages) {
      const v = secondKintsuReturnView({ stage, lanes, returnComplete: true, immediate: true });
      assert.equal(v.returnComplete, false); assert.equal(v.immediateExit, false);
      assert.equal(v.returnProof, "unproven"); assert.equal(v.eta, "UNKNOWN"); assert.equal(v.finalReturn, "UNKNOWN");
      assert.ok(["none", "holding", "pending", "unknown"].includes(v.word), v.word);
    }
  }
  assert.equal(secondKintsuReturnView({ stage: KINTSU.KINTSU_STAGE.PENDING_UNLOCK, lanes: LANES }).word, "pending");
  assert.equal(secondKintsuReturnView({ stage: KINTSU.KINTSU_STAGE.HOLDING, lanes: LANES }).word, "holding");
  for (const step of SECOND_MAINNET_DESCRIPTORS["kintsu-smon"].steps) {
    const out = routeSecondMainnetExecution({ jobId: "kintsu-smon", step, route: routeOf("kintsu-smon"), lanes: LANES, profile: forged("kintsu-smon"), piggy: PIGGY, executor: FORK_EXEC });
    assert.equal(out.returnComplete, false); assert.equal(out.immediateExit, false);
  }
  const d = SECOND_MAINNET_DESCRIPTORS["kintsu-smon"];
  assert.notEqual(d.kintsu.exitSemantics, "immediate");
  const text = JSON.stringify([d, routeOf("kintsu-smon"), secondKintsuReturnView({ stage: "pending_unlock", lanes: LANES })]);
  assert.equal(/"immediate"|"returned"|"complete"|"done"|"returnComplete":true|"immediateExit":true/.test(text), false);
});

// ── G · aBIL gates ──────────────────────────────────────────────────────────────────────────────────
await check("G1 aBIL eligibility / KYC / geo / rights gates stay blocking whatever evidence is supplied", () => {
  const fullRoute = routeSecondCurrentRow({ ...ROWS["abil-spot"], read: { ...ROWS["abil-spot"].read, quote: { value: "5000000", status: "OK" } } });
  for (const step of ["buy", "sell"]) {
    for (const profile of PROFILES("abil-spot")) {
      const out = routeSecondMainnetExecution({ jobId: "abil-spot", step, route: fullRoute, lanes: LANES, profile, piggy: PIGGY, executor: FORK_EXEC, quote: "1", minOutRaw: "1", exitEvidence: {} });
      assert.equal(out.allowed, false);
      for (const f of ["eligibility", "kyc", "geo", "rights"]) assert.ok(out.blockedBy.includes(`blocking_field:${f}`), f);
      assert.ok(out.blockedBy.includes("rights_gate_unsatisfied"));
      assert.ok(out.blockedBy.includes("abil_quote_unknown"), "a caller quote is not a quote source");
      assert.equal(out.rightsGate.required, true); assert.equal(out.rightsGate.satisfied, false);
    }
  }
  // A lane that drops a blocking field, unblocks one, or satisfies the rights gate is drift.
  const go = (lane) => routeSecondMainnetExecution({ jobId: "abil-spot", step: "buy", route: routeOf("abil-spot"), lanes: { "abil-spot": lane }, profile: forged("abil-spot"), piggy: PIGGY });
  assert.ok(go({ ...ABIL, ABIL_BLOCKING_FIELD_NAMES: ABIL.ABIL_BLOCKING_FIELD_NAMES.filter((f) => f !== "kyc") }).blockedBy.includes("lane_descriptor_drift:abil_blocking_fields"));
  assert.ok(go({ ...ABIL, ABIL_BLOCKING_FIELDS: { ...ABIL.ABIL_BLOCKING_FIELDS, geo: { kind: "eligibility", value: "OK", blocking: false } } }).blockedBy.includes("lane_descriptor_drift:abil_field:geo"));
  const sat = go({ ...ABIL, abilRightsGate: () => ({ ...ABIL.abilRightsGate(null), satisfied: true }) });
  assert.ok(sat.blockedBy.includes("lane_descriptor_drift:abil_rights_gate"));
  assert.ok(sat.blockedBy.includes("blocking_field:eligibility"), "blocking fields stay even when the lane lies");
  assert.equal(sat.allowed, false);
});

// ── S · source boundaries ───────────────────────────────────────────────────────────────────────────
await check("S1 product does not import the lanes; merge code has no send / sign / executor / network / live-true path", () => {
  const files = readdirSync(SRC_DIR).filter((x) => x.endsWith(".js"));
  for (const lane of ["neverland", "curvance", "abil", "kintsu"]) {
    assert.deepEqual(files.filter((f) => f !== `mainnet-job-${lane}.js` && new RegExp(`mainnet-job-${lane}`).test(SRC(f))), [], lane);
  }
  const adapter = SRC("second-execution-adapter.js");
  const merge = strip(adapter.slice(adapter.indexOf("// ── Second mainnet merge")));
  assert.ok(merge.length > 3000);
  assert.equal(/sendTransaction|sendRawTransaction|executeMoneyStep|issuePermission|authorize\(|consume\(|advanceLaneIntent|advanceAaveLaneGuarded\(|\.send\(|sign|localStorage|setItem|fetch\(|https?:/.test(merge), false);
  assert.equal(/liveExecution\s*:\s*true|allowed\s*:\s*true|ready\s*:\s*true/.test(merge), false);
  const reader = SRC("second-current-reader.js");
  const routing = strip(reader.slice(reader.indexOf("// ── [Second mainnet merge] read-only routing")));
  assert.ok(routing.length > 1500);
  assert.equal(/reader\.rpc|reader\.call|fetchImpl|eth_|permission\s*:\s*true|Permission\s*:\s*true|liveExecution\s*:\s*true/.test(routing), false);
  // [A-791 re-pin, named reason: card A-791 is the "later card" this pin waited for — main now consumes the A-762 route as
  // EVIDENCE. The pin is narrowed, not dropped: the route names may appear ONLY in main's import lines and inside the one
  // evidence function secondLaneRouteEvidence; that function binds no lane and no executor, names no permission/sign/send
  // path, drops any route that claims anything but "not allowed", and its result is only ever assigned (never read to decide).
  // The per-row router and the Kintsu return view are still not named by product code at all.]
  const main = strip(SRC("main.js"));
  assert.equal(/routeSecondCurrentRow|secondKintsuReturnView/.test(main), false, "per-row router / Kintsu return view: no product call site");
  const evStart = main.indexOf("function secondLaneRouteEvidence(");
  assert.ok(evStart > 0, "the evidence function exists");
  const evEnd = main.indexOf("\n}\n", evStart) + 3;
  const evidenceFn = main.slice(evStart, evEnd);
  const outside = (main.slice(0, evStart) + main.slice(evEnd)).replace(/^import [^\n]*$/gm, "");
  assert.equal(/routeSecondMainnetExecution|routeSecondCurrentRead|SECOND_MAINNET_DESCRIPTORS/.test(outside), false, "route names only in imports + secondLaneRouteEvidence");
  assert.match(evidenceFn, /routeSecondMainnetExecution\(\{ jobId, step, route, profile: CHAIN_PROFILE, piggy: null, executor: null \}\)/);
  assert.equal(/lanes|issuePermission|authorize\(|consume\(|executeMoneyStep|sendTransaction|sendRawTransaction|sign|advance|liveExecution\s*:\s*true|allowed\s*:\s*true/.test(evidenceFn), false, "no lane binding / permission / sign / send in the evidence function");
  assert.match(evidenceFn, /SECOND_ROUTE_LOCKS\.some\(\(k\) => out\[k\] !== false\)/, "a route claiming anything is dropped");
  const uses = main.match(/[^\n]*laneRoutes[^\n]*/g) || [];
  assert.ok(uses.length >= 3 && uses.every((l) => /laneRoutes: null,|sj\.laneRoutes = null;|sj\.laneRoutes = secondLaneRouteEvidence\(currentRead\);/.test(l)), "route evidence is only assigned, never read to decide");
  assert.equal(/mainnet-job-(neverland|curvance|abil|kintsu)/.test(main), false, "main still imports no lane module");
  assert.equal(MAINNET.liveExecution, false);
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
