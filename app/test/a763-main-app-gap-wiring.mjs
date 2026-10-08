// A-763 · main app closed-gap wiring (LOCAL_ONLY, no network / tx).
//   M  main app reads Second evidence read-only and has no mainnet execution path while the live gate/config is off
//   P  execution-safety destination provenance producer: UNKNOWN on missing provenance, never fake-clear
//   E  event hints / simulation / evidence never become permission
//   H  A-756 H-1 stale-tab guard and testnet $5 display truths untouched
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  DECISION, ROUTE_CLASS, DESTINATION_SOURCE, deriveDestinationProvenance, evaluateDestinationBoundExecution, evaluateExecution,
} from "../src/execution-safety.js";
import { resolveChainProfile, legacyTestnetPathOpen } from "../src/chain-profile.js";
import { readSecondCurrent, routeSecondCurrentRead } from "../src/second-current-reader.js";
import { routeSecondMainnetExecution, SECOND_MAINNET_JOB_IDS } from "../src/second-execution-adapter.js";
import { MAINNET_LANE_CONFIG } from "../src/mainnet-job-lane.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const SAFETY = readFileSync(new URL("../src/execution-safety.js", import.meta.url), "utf8");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function fnBody(name, src = MAIN) {
  const m = new RegExp(`(?:async\\s+)?function ${name}\\(`).exec(src);
  assert.ok(m, `${name} not found`);
  let depth = 0;
  for (let i = src.indexOf("{", src.indexOf(")", m.index)); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`${name}: end not found`);
}

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${e?.stack?.split("\n").slice(0, 3).join("\n      ")}`); fail += 1; }
}

// ── fixtures for the gate (same shape as execution-safety.mjs; inputs of this test, not product constants) ──
const NOW = 1_800_000_000_000;
const USDC = "0x00000000000000000000000000000000000000c1";
const WMON = "0x00000000000000000000000000000000000000d1";
const MY_PIGGY = "0x1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5678";
const POISON = "0x1234bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb5678"; // same first 4 / last 4 hex, different middle
const STRANGER = "0x9999000000000000000000000000000000004444";
const SPENDER = "0x00000000000000000000000000000000000000e1";
const post = () => ({ piggyDelta: "-10", outAssetDelta: "+9.98" });
const policy = () => ({
  routeClass: ROUTE_CLASS.SAME_CHAIN_SWAP, assetClass: "stable_to_stable", maxPriceImpactPct: 0.3, maxSlippagePct: 0.5,
  quoteMaxAgeMs: 60_000, requireSimulation: true, allowUnlimitedAllowance: false, materialOutputDeteriorationPct: 0.5,
});
const fields = (over = {}) => ({
  intentId: "intent-a763", piggyId: "honeybun", action: "swap", sourceChainId: 143, destinationChainId: 143,
  inputAsset: { identity: "USDC", symbol: "USDC", address: USDC, decimals: 6 },
  outputAsset: { identity: "WMON", symbol: "WMON", address: WMON, decimals: 18 },
  inputAmount: "10", expectedOut: "9.98", minOut: "9.93", priceImpactPct: 0.05, slippagePct: 0.2,
  totalEffectiveCost: "0.07", effectiveOutput: "9.93", quoteTimestamp: NOW - 5_000, quoteExpiry: NOW + 55_000,
  routeClass: ROUTE_CLASS.SAME_CHAIN_SWAP, liquidityStatus: "deep", simulationStatus: "ok",
  expectedPostconditions: post(), simulatedPostconditions: post(),
  destination: MY_PIGGY, destinationIdentitySource: DESTINATION_SOURCE.PIGGY_REGISTRY,
  spender: SPENDER, allowance: "10", allowanceBound: "10",
  ...over,
});
const expected = () => ({ sourceChainId: 143, destinationChainId: 143, allowedDestinationSources: ["piggy_registry", "user_typed"], allowedSpenders: [SPENDER] });
const bound = (f = {}, destinationRecords) => evaluateDestinationBoundExecution({ fields: fields(f), policy: policy(), expected: expected(), nowMs: NOW, destinationRecords });
const REG = [{ address: MY_PIGGY, source: DESTINATION_SOURCE.PIGGY_REGISTRY }];

// ── M · mainnet boundary ───────────────────────────────────────────────────────────────────────────────
await check("M1 harness plumbing proof refuses on a non-testnet profile before any client is touched (no mainnet send from main)", async () => {
  const body = fnBody("runLocalSecondPlumbingProofIfHarnessed");
  assert.match(body, /if \(typeof LEGACY_TESTNET_PATH !== "boolean" \|\| LEGACY_TESTNET_PATH !== true\) return \{ ran: false, reason: "not_testnet_profile" \};/);
  // the guard precedes every use of deps / scope / runSecondPlumbingProof
  const guardAt = body.indexOf("not_testnet_profile");
  for (const later of ["request.deps", "secondJourneyScope()", "runSecondPlumbingProof("]) assert.ok(body.indexOf(later) > guardAt, later);
  const run = async (legacy) => {
    const calls = { proof: 0, send: 0 };
    const ctx = vm.createContext({
      LOCAL_DEV_ENTRY: true,
      ...(legacy === undefined ? {} : { LEGACY_TESTNET_PATH: legacy }),
      secondJourneyScope: () => ({ accountId: "0xabc", chainId: legacy ? "monad-testnet" : "monad-mainnet" }),
      validatePersistenceScope: () => ({}),
      indexedPiggyId: () => "p1",
      safeLocalStorage: () => ({}),
      secondMoneyLock: () => null,
      state: { appLock: false, secondJourney: {} },
      runSecondPlumbingProof: async () => { calls.proof += 1; return { outcome: "blocked", reason: "stub" }; },
      commitSecondJourneyReceipt: () => { throw new Error("must not commit"); },
      ensureSecondJourneyDomainState: () => ({}),
    });
    vm.runInContext(`${body}\nthis.run = runLocalSecondPlumbingProofIfHarnessed;`, ctx);
    const deps = {
      account: { address: "0x00000000000000000000000000000000000000aa" },
      walletClient: { sendTransaction: async () => { calls.send += 1; return "0x"; } },
      publicClient: { waitForTransactionReceipt: async () => ({}), readContract: async () => 0n },
    };
    const out = await ctx.run({ deps, amountWei: "1", confirm: true });
    return { out, calls };
  };
  for (const legacy of [false, undefined, "true", 1]) {
    const { out, calls } = await run(legacy);
    assert.deepEqual({ ...out }, { ran: false, reason: "not_testnet_profile" }, String(legacy));
    assert.deepEqual(calls, { proof: 0, send: 0 });
  }
  // testnet profile: the guard is not a blanket refusal (the existing adapter gates take over)
  const t = await run(true);
  assert.equal(t.calls.proof, 1);
  assert.equal(t.calls.send, 0);
});

await check("M2 mainnet profile: live off, legacy First path sealed (sendPiggy / syncSendButton refuse before pending/grant)", () => {
  const MAINNET = resolveChainProfile("monad-mainnet");
  assert.equal(MAINNET.liveExecution, false);
  assert.equal(legacyTestnetPathOpen(MAINNET), false);
  assert.equal(MAINNET_LANE_CONFIG.liveExecution, false);
  assert.equal(MAINNET_LANE_CONFIG.reader, null);
  const sp = stripComments(fnBody("sendPiggy"));
  const sealedAt = sp.indexOf('typeof LEGACY_TESTNET_PATH === "boolean" && LEGACY_TESTNET_PATH !== true');
  assert.ok(sealedAt > 0 && sealedAt < sp.indexOf("readSendPending()"));
  assert.match(stripComments(fnBody("syncSendButton")), /const locked = sealed \|\|/);
});

await check("M3 main consumes Second evidence read-only: unconfigured reader, no lane module / A-762 route name, no executor", () => {
  const code = stripComments(MAIN);
  const refresh = stripComments(fnBody("refreshSecondLaneCandidates"));
  assert.match(refresh, /readSecondCurrent\(\{ profile: CHAIN_PROFILE, piggyAddress: state\.address \|\| "" \}\)/);
  assert.equal(/rpcUrl|transport|fetchImpl/.test(refresh), false);
  // pins respected (a757:348, a759:298, a760:376, a761:372, a762:337): product names none of these
  assert.equal(/mainnet-job-(neverland|curvance|abil|kintsu)/.test(MAIN), false);
  // [A-791 re-pin, named reason: A-791 wires the A-762 route into main as evidence (a762 S1 narrowed the same way). The route names
  // may appear only in import lines and in secondLaneRouteEvidence, which binds no lane / executor (a762 S1 + a791 assert its
  // body and behaviour); the per-row router and the Kintsu return view stay unnamed.]
  assert.equal(/routeSecondCurrentRow|secondKintsuReturnView/.test(MAIN), false);
  const evFn = fnBody("secondLaneRouteEvidence");
  const outsideEv = MAIN.replace(evFn, "").replace(/^import [^\n]*$/gm, "");
  assert.equal(/routeSecondMainnetExecution|routeSecondCurrentRead|SECOND_MAINNET_DESCRIPTORS/.test(stripComments(outsideEv)), false);
  assert.match(evFn, /executor: null \}\)/);
  assert.equal(/advanceAaveLaneGuarded|advanceLaneIntent|startLaneIntent|executeMoneyStep|liveExecution\s*:\s*true/.test(code), false);
});

await check("M4 the same unconfigured read, routed through the A-762 surface with no injected lanes, refuses every job/step on the live gate", async () => {
  const MAINNET = resolveChainProfile("monad-mainnet");
  const read = await readSecondCurrent({ profile: MAINNET, piggyAddress: MY_PIGGY });
  const routed = routeSecondCurrentRead(read);
  for (const jobId of SECOND_MAINNET_JOB_IDS) {
    const route = routed.routes.find((r) => r.jobId === jobId);
    assert.equal(route.evidence, "unknown", jobId);
    for (const step of ["approve", "supply", "deposit", "buy", "requestUnlock"]) {
      const r = routeSecondMainnetExecution({ jobId, step, route, lanes: {}, profile: MAINNET, proof: true, ready: true, liveExecution: true });
      assert.equal(r.allowed, false);
      assert.equal(r.actionCount, 0);
      assert.equal(r.executionPermission, false);
      assert.ok(r.blockedBy.includes("live_gate_closed") || r.blockedBy.includes("live_execution_disabled"), `${jobId}/${step}`);
      assert.ok(r.blockedBy.includes("merge_route_has_no_execution_path"));
    }
  }
});

// ── P · destination provenance producer ──────────────────────────────────────────────────────────────
await check("P1 missing provenance stays UNKNOWN (null, not false); caller claims of firstSeen/lookalike=false are discarded", () => {
  for (const records of [undefined, null, "registry", { address: MY_PIGGY }]) {
    const p = deriveDestinationProvenance({ destination: MY_PIGGY, records });
    assert.equal(p.status, DECISION.UNKNOWN);
    assert.equal(p.destinationFirstSeen, null);
    assert.equal(p.destinationLookalike, null);
    const r = bound({ destinationFirstSeen: false, destinationLookalike: false }, records);
    assert.equal(r.decision, DECISION.UNKNOWN, JSON.stringify(r.reasons));
    assert.equal(r.action, 0);
    assert.equal(r.executionReady, false);
    assert.ok(r.reasons.includes("destination_provenance_unknown"));
  }
});

await check("P2 unreadable destination or only unreadable records → UNKNOWN; full-address identity only", () => {
  assert.equal(deriveDestinationProvenance({ destination: "0x1234…5678", records: REG }).reason, "destination_unreadable");
  assert.equal(deriveDestinationProvenance({ destination: MY_PIGGY.slice(0, 41), records: REG }).status, DECISION.UNKNOWN);
  const junk = deriveDestinationProvenance({ destination: MY_PIGGY, records: [{ address: "0x12", source: "piggy_registry" }, { address: MY_PIGGY, source: "clipboard" }] });
  assert.equal(junk.status, DECISION.UNKNOWN);
  assert.equal(junk.reason, "provenance_unreadable");
  assert.equal(bound({}, [{ address: "nope", source: "history" }]).decision, DECISION.UNKNOWN);
});

await check("P3 own Piggy from the registry (exact, case-insensitive) → not first-seen, not lookalike → the gate can pass", () => {
  const p = deriveDestinationProvenance({ destination: MY_PIGGY.toUpperCase().replace("0X", "0x"), records: REG });
  assert.equal(p.status, "known");
  assert.equal(p.destinationFirstSeen, false);
  assert.equal(p.destinationLookalike, false);
  const r = bound({}, REG);
  assert.equal(r.decision, DECISION.DO, JSON.stringify(r.reasons));
  assert.equal(r.createsPermission, false);
});

await check("P4 first-seen: no vouching record (empty registry, or history-only exact match) → ASK, action 0", () => {
  const typed = bound({ destination: STRANGER, destinationIdentitySource: DESTINATION_SOURCE.USER_TYPED }, []);
  assert.equal(typed.destinationProvenance.destinationFirstSeen, true);
  assert.equal(typed.decision, DECISION.ASK);
  assert.equal(typed.action, 0);
  assert.ok(typed.reasons.includes("destination_needs_strong_confirmation"));
  const hist = deriveDestinationProvenance({ destination: STRANGER, records: [{ address: STRANGER, source: DESTINATION_SOURCE.HISTORY }] });
  assert.equal(hist.destinationFirstSeen, true, "history never vouches");
  assert.equal(hist.vouchedBy, null);
  const typedBefore = deriveDestinationProvenance({ destination: STRANGER, records: [{ address: STRANGER, source: DESTINATION_SOURCE.USER_TYPED }] });
  assert.equal(typedBefore.destinationFirstSeen, false);
});

await check("P5 lookalike (same visible edges, different middle) of a known address → ASK even if the caller says false", () => {
  const recs = [...REG, { address: POISON, source: DESTINATION_SOURCE.HISTORY }];
  const p = deriveDestinationProvenance({ destination: POISON, records: recs });
  assert.equal(p.destinationLookalike, true);
  assert.deepEqual([...p.lookalikeOf], [MY_PIGGY.toLowerCase()]);
  assert.equal(p.destinationFirstSeen, true);
  const r = bound({ destination: POISON, destinationIdentitySource: DESTINATION_SOURCE.USER_TYPED, destinationLookalike: false, destinationFirstSeen: false }, recs);
  assert.equal(r.decision, DECISION.ASK);
  assert.equal(r.action, 0);
  // the real address also flags while a planted lookalike sits in the records (stronger confirmation, never a pass on edges)
  assert.equal(deriveDestinationProvenance({ destination: MY_PIGGY, records: recs }).destinationLookalike, true);
  // an unrelated address is not a lookalike
  assert.equal(deriveDestinationProvenance({ destination: STRANGER, records: REG }).destinationLookalike, false);
});

await check("P6 a registry-source claim with no matching registry record is UNKNOWN, not trusted", () => {
  const r = bound({ destination: STRANGER, destinationIdentitySource: DESTINATION_SOURCE.PIGGY_REGISTRY }, REG);
  assert.equal(r.decision, DECISION.UNKNOWN);
  assert.ok(r.reasons.includes("destination_provenance_unknown"));
  assert.equal(r.findings.find((f) => f.code === "destination_provenance_unknown").detail.reason, "destination_source_claim_unbacked");
});

await check("P7 raw gate: an explicit null first-seen/lookalike is UNKNOWN (null is never read as false)", () => {
  const raw = (f) => evaluateExecution({ fields: fields(f), policy: policy(), expected: expected(), nowMs: NOW });
  assert.equal(raw({ destinationFirstSeen: null }).decision, DECISION.UNKNOWN);
  assert.equal(raw({ destinationLookalike: null }).decision, DECISION.UNKNOWN);
  assert.equal(raw({ destinationProvenanceUnknown: "provenance_unavailable" }).decision, DECISION.UNKNOWN);
  // pinned legacy baseline (execution-safety.mjs) unchanged: the raw gate with no provenance fields still answers as before
  assert.equal(raw({}).decision, DECISION.DO);
  // no product source calls the raw gate directly (it has no call site at all today)
  assert.equal(/evaluateExecution\(|evaluateDestinationBoundExecution\(/.test(stripComments(MAIN)), false);
});

await check("P8 only own record fields count: inherited address/source (prototype or Object.prototype) never vouch", () => {
  const inherited = Object.create({ address: MY_PIGGY, source: DESTINATION_SOURCE.PIGGY_REGISTRY });
  const p = deriveDestinationProvenance({ destination: MY_PIGGY, records: [inherited] });
  assert.equal(p.status, DECISION.UNKNOWN, "a record with only inherited fields is unreadable");
  assert.equal(p.reason, "provenance_unreadable");
  const halfOwn = Object.create({ source: DESTINATION_SOURCE.PIGGY_REGISTRY });
  halfOwn.address = MY_PIGGY;
  assert.equal(deriveDestinationProvenance({ destination: MY_PIGGY, records: [halfOwn] }).status, DECISION.UNKNOWN);
  // mixed with a real own-field history record: the inherited registry claim still does not vouch
  const mixed = deriveDestinationProvenance({ destination: MY_PIGGY, records: [inherited, { address: MY_PIGGY, source: DESTINATION_SOURCE.HISTORY }] });
  assert.equal(mixed.destinationFirstSeen, true);
  assert.equal(mixed.vouchedBy, null);
  assert.equal(bound({}, [inherited]).decision, DECISION.UNKNOWN);
  // polluted Object.prototype never makes destination / records / record fields appear
  Object.prototype.address = MY_PIGGY; Object.prototype.source = DESTINATION_SOURCE.PIGGY_REGISTRY;
  Object.prototype.destination = MY_PIGGY; Object.prototype.records = REG;
  try {
    assert.equal(deriveDestinationProvenance({}).status, DECISION.UNKNOWN);
    assert.equal(deriveDestinationProvenance({ destination: MY_PIGGY }).reason, "provenance_unavailable");
    assert.equal(deriveDestinationProvenance({ destination: MY_PIGGY, records: [{}] }).status, DECISION.UNKNOWN);
    const holes = deriveDestinationProvenance({ destination: MY_PIGGY, records: new Array(2) });
    assert.equal(holes.status, DECISION.UNKNOWN);
  } finally {
    delete Object.prototype.address; delete Object.prototype.source; delete Object.prototype.destination; delete Object.prototype.records;
  }
});

await check("P9 a throwing getter anywhere in the input never throws out of the producer or the bound gate: UNKNOWN, action 0", () => {
  const boom = (o, k) => Object.defineProperty(o, k, { enumerable: true, get() { throw new Error("getter"); } });
  const cases = [
    boom({}, "destination"),
    boom({ destination: MY_PIGGY }, "records"),
    { destination: MY_PIGGY, records: [boom({ source: DESTINATION_SOURCE.PIGGY_REGISTRY }, "address")] },
    { destination: MY_PIGGY, records: [boom({ address: MY_PIGGY }, "source")] },
    { destination: MY_PIGGY, records: new Proxy([], { get() { throw new Error("proxy"); }, getOwnPropertyDescriptor() { throw new Error("proxy"); } }) },
    { destination: MY_PIGGY, records: [new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("proxy"); } })] },
  ];
  for (const input of cases) {
    let p;
    assert.doesNotThrow(() => { p = deriveDestinationProvenance(input); });
    assert.equal(p.status, DECISION.UNKNOWN);
    assert.equal(p.destinationFirstSeen, null);
    assert.equal(p.destinationLookalike, null);
  }
  const gateCases = [
    boom({ policy: policy(), expected: expected(), nowMs: NOW }, "fields"),
    boom({ fields: fields(), policy: policy(), expected: expected(), nowMs: NOW }, "destinationRecords"),
    { fields: boom(fields(), "destination"), policy: policy(), expected: expected(), nowMs: NOW, destinationRecords: REG },
    { fields: fields({ inputAsset: boom({ symbol: "USDC", decimals: 6, identity: "USDC" }, "address") }), policy: policy(), expected: expected(), nowMs: NOW, destinationRecords: REG },
    { fields: fields(), policy: boom(policy(), "maxSlippagePct"), expected: expected(), nowMs: NOW, destinationRecords: REG },
  ];
  for (const input of gateCases) {
    let r;
    assert.doesNotThrow(() => { r = evaluateDestinationBoundExecution(input); });
    assert.equal(r.decision, DECISION.UNKNOWN, JSON.stringify(r.reasons));
    assert.equal(r.action, 0);
    assert.equal(r.executionReady, false);
    assert.equal(r.createsPermission, false);
  }
});

// ── E · evidence / hints / simulation ≠ permission ───────────────────────────────────────────────────
await check("E1 hints, simulation ok, READY or permission claims in the input never turn missing provenance into a pass or a permission", () => {
  const claims = { eventHint: "webhook:deposit_seen", simulationStatus: "ok", executionPermission: true, permission: true, ready: true, allowed: true, liveExecution: true };
  const r = bound(claims, undefined);
  assert.equal(r.decision, DECISION.UNKNOWN);
  assert.equal(r.action, 0);
  assert.equal(r.createsPermission, false);
  for (const k of ["permission", "executionPermission", "allowed", "envelope"]) assert.equal(Object.prototype.hasOwnProperty.call(r, k), false, k);
  // even a full pass is a gate answer, not a permission
  const ok = bound({}, REG);
  assert.equal(ok.decision, DECISION.DO);
  assert.equal(ok.createsPermission, false);
  assert.equal(Object.prototype.hasOwnProperty.call(ok, "permission"), false);
  // simulation "ok" alone with an unproven postcondition does not override a lookalike
  assert.equal(bound({ destination: POISON, destinationIdentitySource: "user_typed" }, [...REG]).decision, DECISION.ASK);
});

await check("E2 the producer/gate module stays pure: no permission envelope, no network, no storage, no price source", () => {
  const code = SAFETY.replace(/\/\/.*$/gm, "");
  assert.equal(/permission-envelope|issuePermission|authorize\(|consume\(|fetch\(|localStorage|sendTransaction|signTransaction|signMessage|signDigest|\bimport\s/.test(code), false);
  assert.equal(/oracle|priceFeed|usdPrice|getPrice|coingecko|pyth|chainlink/i.test(code), false);
});

await check("E3 main Second paths keep evidence apart from permission (candidates record action-0 receipts; Send stays DEV-fixture gated)", () => {
  for (const name of ["refreshSecondLaneCandidates", "recordSecondLaneDecision", "handleSecondLaneTry"]) {
    const b = stripComments(fnBody(name));
    assert.equal(/issuePermission|authorize\(|executionPermission\s*[:=]\s*true|permission\s*[:=]\s*true|sendTransaction|signDigest|requestGrant|runSecondPlumbingProof|liveExecution/.test(b), false, name);
  }
  assert.match(stripComments(fnBody("handleSecondSend")), /const canSend =\s*devPreview &&\s*preflight\?\.status === "JOB_READY" &&\s*preflight\?\.executionPermission === true/);
});

// ── H · A-756 H-1 + testnet $5 display intact ───────────────────────────────────────────────────────────
// Body hashes taken from the pre-A-763 tree (A-763 edits only the plumbing-proof harness in main.js).
const H_PINS = {
  firstTripClosedShared: "1079ba6542288dc88ba44db5f86f188eaf4e5d6b2585173d55269a671cb1f4e7",
  reserveSend: "2038458e47b1f86e9ebff480c0404e3c1b052f06af660cff52bb71d11e2c24f6",
  promoteSendReservation: "0847167f74d7cbc9840a19fce23b18a97f91be006ae2e99c17e67dc63d43ea48",
  confirmSendReservation: "9d53949f862b5fbd93c7840907612ef3b5fd759a117a828d8ab3b9bc3e3ea3cb",
  firstSendAmountSecondary: "bf6d03dead508b518e6d773505e5a6b3e021cdc8be07c23cf98876d74da8da64",
  // [A-896 re-pin, named reason: 99e M-L-2 Owner 60 s signer-margin] sendPiggyOnce gains ONE entry check (wall-clock signerSince vs 5 min - 60 s; below margin = treated as no session -> existing recoverPiggy path).
  // pre-A-896 baseline: sendPiggyOnce 01ee727da9fc2def3d057d939c42b9cf69a95ace97f4c9af81500bd3fef9646b [A-896 R1 re-pin: + monotonic performance.now stamp/check; prior A-896 value was the old pin]
  sendPiggyOnce: "0120bd9896880837c5fbb0e10a47b73efedeff3b9077f9877cbaae82b4e7955e",
  sendPiggy: "08e971de9099462a27c833333b4a3cae3ba431572ff78611afc7bee63ccb9c1f",
  sentRowValue: "e88b42121dfca241fc2b0c5f23c762bfe0a53b3b67c10bd7238f3014b71ce816",
};
await check("H1 H-1 guard, First send path and $5 display bodies are byte-identical to the pre-A-763 tree", () => {
  for (const [name, h] of Object.entries(H_PINS)) assert.equal(sha(fnBody(name)), h, name);
  // H-1 recheck still sits inside the exclusive-lock promotion, and the $5 / faint MON truths stand
  assert.match(fnBody("promoteSendReservation"), /firstTripClosedShared\(\)/);
  assert.match(MAIN, /const FIRST_SEND_USD = "\$5";/);
  assert.match(MAIN, /const SEND_AMOUNT = parseEther\("0\.001"\);/);
  assert.equal(/up to \$5|\$5 limit/.test(stripComments(MAIN)), false);
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
