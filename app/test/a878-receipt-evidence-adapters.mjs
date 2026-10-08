// A-878 · receipt evidence W3 adapters (First / Second / Gift): deterministic mapping, labels, reader+store fit,
// Second staged-tx vs state_observation separation, Gift ledger separation, observation-only boundary.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapFirstEvidence, FIRST_EVIDENCE_STEPS } from "../src/receipt-evidence-first.js";
import {
  mapSecondEvidence, mapSecondLaneIntent, mapSecondLaneReceipt, mapSecondPlumbingPending, mapSecondStateObservation,
} from "../src/receipt-evidence-second.js";
import { GIFT_LEDGER_BOUNDARY, mapGiftEvidence } from "../src/receipt-evidence-gift.js";
import { evidenceKey as readerKey, readTxEvidence } from "../src/receipt-evidence-reader.js";
import { createEvidenceStore, evidenceKey as storeKey } from "../src/receipt-evidence-store.js";
// Pins for labels the Second adapter copies instead of importing (test-only imports).
import { SECOND_PLUMBING_EVIDENCE_CLASS, SECOND_SEND_PENDING_STAGES } from "../src/second-execution-adapter.js";
import { EVIDENCE_LABEL, EXECUTION_MODE } from "../src/second-job-readiness.js";
import { DECISION_RECEIPT_SCHEMA } from "../src/second-journey-state.js";
import { laneReceiptCandidate } from "../src/mainnet-job-lane.js";
import { createGiftGasLedger, createMemoryGiftGasStore } from "../src/gift-gas-ledger.js";
import { scopeForChainId } from "../src/funding-context.js";

const H = (n) => "0x" + n.toString(16).padStart(64, "0");
const A = (n) => "0x" + n.toString(16).padStart(40, "0");
const mem = () => { const m = {}; return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };
const SRC = Object.fromEntries(["first", "second", "gift"].map((j) => [j, readFileSync(new URL(`../src/receipt-evidence-${j}.js`, import.meta.url), "utf8")]));
let n = 0; const ok = (name) => { n++; console.log("PASS", name); };

const AUTH_WORDS = ["permission", "executable", "authorize", "envelope", "nonceToConsume", "canSend", "ready", "executionPermission"];
function walkKeys(o, out = []) { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { out.push(k); walkKeys(v, out); } return out; }
function checkTxItem(it, journey) {
  assert.equal(it.kind, "tx");
  assert.equal(it.authority, "observation_only");
  assert.equal(it.journey, journey);
  assert.ok(it.chain && /^[1-9][0-9]*$/.test(it.chain.chainId) && typeof it.chain.label === "string" && it.chain.label.length > 0);
  assert.ok(typeof it.source === "string" && it.source.startsWith(journey + "."));
  assert.ok(it.journeyLabel.startsWith(journey + "."));
  assert.equal(it.evidenceKey, readerKey({ chainId: it.chain.chainId, txHash: it.txHash }));
  assert.equal(it.evidenceKey, storeKey({ chainId: it.chain.chainId, txHash: it.txHash }));
  assert.ok(Object.isFrozen(it));
  for (const k of walkKeys(it)) assert.ok(!AUTH_WORDS.includes(k), `authority-like key ${k}`);
  if (it.readEligible) {
    assert.equal(it.readRequest.hash, it.txHash); assert.equal(it.readRequest.chainId, it.chain.chainId);
    assert.equal(it.seed.status, "unknown"); assert.equal(it.seed.journey, it.journeyLabel);
  }
}

// ── boundaries: import graph, no clock / network / timers / storage in adapter sources ──
for (const [j, s] of Object.entries(SRC)) {
  const imports = [...s.matchAll(/^\s*import\s[^;]*from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./receipt-evidence-reader.js"], `${j} imports`);
  assert.ok(!/\bimport\s*\(/.test(s), `${j} dynamic import`);
  const code = s.replace(/^\s*\/\/.*$/gm, "");
  for (const bad of ["Date.now", "new Date", "setTimeout", "setInterval", "fetch(", "localStorage", "sessionStorage", "XMLHttpRequest", "WebSocket", "Math.random", "crypto."]) {
    assert.ok(!code.includes(bad), `${j} uses ${bad}`);
  }
}
assert.ok(!/gift-gas-ledger/.test(SRC.gift.replace(/^\s*\/\/.*$/gm, "")), "gift adapter references ledger module in code");
ok("import graph = reader only; no clock/network/timers/storage");

// ── pins: copied labels still match the source modules ──
assert.deepEqual([...SECOND_SEND_PENDING_STAGES], ["deposit-sending", "deposit-broadcast", "redeem-sending", "redeem-broadcast"]);
assert.ok(SRC.second.includes(`"${SECOND_PLUMBING_EVIDENCE_CLASS}"`));
assert.ok(SRC.second.includes(`"${EXECUTION_MODE.FORK_SIMULATION}"`) && SRC.second.includes(`"${EVIDENCE_LABEL.FORK_SIM}"`));
assert.ok(SRC.second.includes(`"${DECISION_RECEIPT_SCHEMA}"`));
ok("copied Second labels pinned to source modules");

// ── First ──
{
  const pending = { stage: "redeem-broadcast", depositTxHash: H(1), redeemTxHash: H(2).toUpperCase().replace("0X", "0x") };
  const a = mapFirstEvidence({ record: pending, sourceKind: "send_pending", chainId: 10143, chainLabel: "monad-testnet", piggyAddress: A(9), now: "2026-10-07T00:00:00Z" });
  const b = mapFirstEvidence({ record: pending, sourceKind: "send_pending", chainId: 10143, chainLabel: "monad-testnet", piggyAddress: A(9), now: "2026-10-07T00:00:00Z" });
  assert.deepEqual(a, b);
  assert.equal(a.ok, true); assert.deepEqual(a.items.map((i) => i.step), FIRST_EVIDENCE_STEPS);
  a.items.forEach((i) => checkTxItem(i, "first"));
  assert.equal(a.items[1].txHash, H(2)); assert.equal(a.items[0].recordClaim.stage, "redeem-broadcast");
  assert.deepEqual(a.items[0].readRequest.expect, { from: A(9) });
  assert.equal(a.items[0].seed.observedAt, "2026-10-07T00:00:00Z");
  // no clock injected -> no observedAt
  assert.equal("observedAt" in mapFirstEvidence({ record: pending, sourceKind: "send_pending", chainId: 10143 }).items[0].seed, false);
  // deposit-only (failed/stuck) keeps its hash as evidence
  const d = mapFirstEvidence({ record: { stage: "deposit-broadcast", depositTxHash: H(3) }, sourceKind: "send_pending", chainId: 10143 });
  assert.equal(d.items.length, 1); assert.deepEqual(d.refused, [{ step: "redeem", reason: "no_hash" }]); assert.equal(d.items[0].chain.label, "UNKNOWN");
  // settled receipt: legacy txHash -> redeem; reverted status kept as claim only
  const r = mapFirstEvidence({ record: { depositTxHash: H(4), txHash: H(5), status: "reverted" }, sourceKind: "send_receipt", chainId: 10143 });
  assert.equal(r.items[1].txHash, H(5)); assert.equal(r.items[1].source, "first.send_receipt.txHash_legacy"); assert.equal(r.items[1].recordClaim.status, "reverted");
  const mm = mapFirstEvidence({ record: { depositTxHash: H(4), redeemTxHash: H(6), txHash: H(5) }, sourceKind: "send_receipt", chainId: 10143 });
  assert.equal(mm.items[1].txHash, H(6)); assert.ok(mm.refused.some((x) => x.reason === "txhash_redeem_mismatch"));
  // refusals
  assert.equal(mapFirstEvidence({ record: pending, sourceKind: "send_pending" }).reason, "chain_unlabelled");
  assert.equal(mapFirstEvidence({ record: pending, chainId: 10143 }).reason, "source_kind_unknown");
  assert.equal(mapFirstEvidence({ record: { ...pending, chainId: 143 }, sourceKind: "send_pending", chainId: 10143 }).reason, "chain_mismatch");
  assert.equal(mapFirstEvidence({ record: { depositTxHash: H(1), redeemTxHash: H(1) }, sourceKind: "send_pending", chainId: 10143 }).reason, "duplicate_hash_across_steps");
  assert.deepEqual(mapFirstEvidence({ record: { stage: "weird", depositTxHash: "0x12", redeemTxHash: 5 }, sourceKind: "send_pending", chainId: 10143 }).refused.map((x) => x.reason), ["hash_invalid", "hash_invalid"]);
  ok("First deposit/redeem mapping");
}

// ── Second ──
{
  const plumbing = { stage: "redeem-broadcast", chainId: "monad-testnet", address: A(7), depositTxHash: H(10), redeemTxHash: H(11) };
  const p = mapSecondPlumbingPending(plumbing, { chainId: 10143 });
  assert.equal(p.ok, true); p.items.forEach((i) => checkTxItem(i, "second"));
  assert.equal(p.items[0].chain.label, "monad-testnet"); assert.equal(p.items[0].journeyLabel, "second.plumbing_proof.deposit");
  assert.equal(p.items[0].recordClaim.evidenceClass, "PASS_TESTNET_ACTUAL_TX");
  assert.equal(mapSecondPlumbingPending(plumbing, {}).reason, "chain_unlabelled"); // scope label is never turned into a number

  const intent = { chainId: 143, chain: "monad-mainnet", stage: "withdraw_sent", piggyAddress: A(8), executionMode: "live", evidenceClass: "PASS_MAINNET_TX",
    steps: { approve: { hash: H(20), status: "success" }, supply: { hash: H(21), status: "success" }, withdraw: { hash: H(22), status: "pending" } } };
  const li = mapSecondLaneIntent(intent);
  assert.deepEqual(li.items.map((i) => i.step), ["approve", "supply", "withdraw"]); li.items.forEach((i) => checkTxItem(i, "second"));
  assert.equal(li.items[2].recordClaim.stepStatus, "pending"); assert.equal(li.items[0].chain.chainId, "143");
  assert.equal(mapSecondLaneIntent(intent, { chainId: 10143 }).reason, "chain_mismatch");
  // fork sim: mapped as labelled, never read / seeded
  const fk = mapSecondLaneIntent({ ...intent, executionMode: "fork_simulation", evidenceClass: "PASS_FORK_SIM" });
  assert.ok(fk.items.every((i) => i.readEligible === false && i.readRequest === null && i.seed === null));
  assert.equal(fk.refused.filter((x) => x.reason === "fork_simulation_hash_not_read").length, 3);
  // lane receipt via the real laneReceiptCandidate evidencePointer
  const receipt = { schema: "araso_mainnet_lane_receipt_v1", eventId: "lane:p:1", outcome: "failed", failedStep: "supply", executionMode: "live", evidenceClass: "PASS_MAINNET_TX",
    chainId: 143, chain: "monad-mainnet", asset: "USDC", decimals: 6, deltaRaw: "0", piggyId: "p", piggyAddress: A(8),
    approveTx: H(20), supplyTx: H(21), withdrawTx: null, gasUsed: { approve: 1, supply: 2, withdraw: null }, unmeasured: [] };
  const cand = laneReceiptCandidate(receipt);
  const lr = mapSecondLaneReceipt(cand);
  assert.deepEqual(lr.items.map((i) => i.step), ["approve", "supply"]); assert.equal(lr.items[1].recordClaim.failedStep, "supply");
  assert.deepEqual(mapSecondLaneReceipt(cand), mapSecondLaneReceipt(receipt));
  assert.equal(mapSecondLaneReceipt({ approveTx: H(1), chainId: 143 }).reason, "record_invalid");

  // state_observation separation
  const decision = { schema: DECISION_RECEIPT_SCHEMA, eventId: "current:e:aave-usdc", chainId: "monad-mainnet", destinationId: "aave-usdc", decision: "nah",
    expected: "≥ 1", found: "0", txExecuted: false, actionCount: 0, evidence: { source: "rpc", observedAt: "2026-10-07T01:00:00Z", block: 123 } };
  const so = mapSecondStateObservation(decision);
  assert.equal(so.ok, true); assert.equal(so.observation.kind, "state_observation");
  for (const k of ["txHash", "evidenceKey", "readRequest", "seed"]) assert.equal(k in so.observation, false);
  assert.equal(so.observation.commitState, "proposed"); assert.equal(so.observation.tagUsed, "latest"); assert.equal(so.observation.block, 123);
  assert.equal(so.observation.chain.label, "monad-mainnet"); assert.equal(so.observation.source, "second.decision_receipt");
  assert.equal(mapSecondStateObservation({ ...decision, txExecuted: true }).reason, "not_a_state_observation");
  assert.equal(mapSecondStateObservation({ ...decision, txHash: H(1) }).reason, "not_a_state_observation");
  assert.equal(mapSecondStateObservation({ ...decision, actionCount: 1 }).reason, "not_a_state_observation");
  assert.equal(mapSecondStateObservation(intent).reason, "not_a_decision_receipt");

  const all = mapSecondEvidence({ plumbingPending: plumbing, laneIntent: intent, decisionReceipts: [decision, { ...decision, txExecuted: true }], chainId: 10143 });
  // plumbing (injected 10143) maps; lane intent (143) is refused as chain_mismatch — chains never blend
  assert.equal(all.staged.length, 2); assert.equal(all.stateObservations.length, 1);
  assert.ok(all.refused.some((x) => x.source === "second.lane_intent" && x.reason === "chain_mismatch"));
  assert.ok(all.refused.some((x) => x.source === "second.decision_receipt" && x.reason === "not_a_state_observation"));
  assert.ok(all.staged.every((i) => i.kind === "tx") && all.stateObservations.every((o) => o.kind === "state_observation"));
  assert.deepEqual(all, mapSecondEvidence({ plumbingPending: plumbing, laneIntent: intent, decisionReceipts: [decision, { ...decision, txExecuted: true }], chainId: 10143 }));
  ok("Second staged tx mapping + state_observation separation");
}

// ── Gift ──
{
  const giftId = H(0xabc);
  const input = { giftId, txHashes: { delivery: H(30), commit: H(31), claim: H(32) }, submitStatus: "value_transferred", chainId: 10143, chainLabel: "monad-testnet", recipient: A(5), escrow: A(6) };
  // a live in-memory gift gas ledger with one reserved entry: the adapter must not touch it
  const store = createMemoryGiftGasStore();
  const ledger = createGiftGasLedger({ store, deviceId: "dev-1", now: () => "2026-10-07T00:00:00Z" });
  assert.equal((await ledger.reserve(giftId, A(5), 1000n)).ok, true);
  const snap = JSON.stringify(store.snapshot());
  const g = mapGiftEvidence(input);
  assert.deepEqual(g, mapGiftEvidence(input));
  assert.equal(g.ok, true); assert.equal(g.ledgerBoundary, GIFT_LEDGER_BOUNDARY);
  assert.deepEqual(g.items.map((i) => i.step), ["delivery", "commit", "claim"]); g.items.forEach((i) => checkTxItem(i, "gift"));
  assert.deepEqual(g.items[0].readRequest.expect, { to: A(5) }); assert.deepEqual(g.items[1].readRequest.expect, { from: A(5), to: A(6) });
  assert.ok(g.items.every((i) => i.giftRef === giftId && i.evidenceKey.includes(i.txHash) && !i.evidenceKey.includes(giftId.slice(2))));
  const flat = JSON.stringify(g);
  for (const w of ["PENDING", "CONFIRMED", "\"UNKNOWN\"", "reserve", "markSent", "deviceId"]) assert.ok(!flat.includes(w), `gift output contains ${w}`);
  assert.equal(JSON.stringify(store.snapshot()), snap);
  // ledger entries / secrets are not inputs
  assert.equal(mapGiftEvidence({ ...input, state: "CONFIRMED" }).reason, "ledger_entry_not_accepted");
  assert.equal(mapGiftEvidence({ ...input, deviceId: "dev-1" }).reason, "ledger_entry_not_accepted");
  assert.equal(mapGiftEvidence({ ...input, salt: H(1) }).reason, "secret_field_not_accepted");
  assert.equal(mapGiftEvidence({ ...input, token: "x" }).reason, "secret_field_not_accepted");
  assert.equal(mapGiftEvidence({ ...input, chainId: undefined }).reason, "chain_unlabelled");
  assert.equal(mapGiftEvidence({ ...input, giftId: "gift-1" }).reason, "gift_id_invalid");
  assert.equal(mapGiftEvidence({ ...input, txHashes: { delivery: H(30), commit: H(30) } }).reason, "duplicate_hash_across_steps");
  // commit failed after delivery: delivery evidence kept, missing steps refused
  const part = mapGiftEvidence({ ...input, txHashes: { delivery: H(30), commit: H(31) }, submitStatus: "commit_failed" });
  assert.equal(part.items.length, 2); assert.deepEqual(part.refused, [{ step: "claim", reason: "no_hash" }]);
  ok("Gift delivery/commit/claim mapping; gas ledger separate and untouched");
}

// ── review fixes (REVIEW.md F1–F4) ──
{
  // F1: the record's chain scope must agree with the numeric chain id
  assert.equal(scopeForChainId(10143), "monad-testnet"); assert.equal(scopeForChainId(143), "monad-mainnet"); // pin of the copied pairs
  assert.ok(SRC.second.includes(`"monad-testnet": "10143"`) && SRC.second.includes(`"monad-mainnet": "143"`));
  const plumbing = { stage: "deposit-broadcast", chainId: "monad-testnet", depositTxHash: H(40) };
  assert.equal(mapSecondPlumbingPending(plumbing, { chainId: 143 }).reason, "chain_mismatch");
  assert.equal(mapSecondPlumbingPending({ ...plumbing, chainId: "monad-mainnet" }, { chainId: 10143 }).reason, "chain_mismatch");
  assert.equal(mapSecondPlumbingPending(plumbing, { chainId: 10143 }).ok, true);
  const unk = mapSecondPlumbingPending({ ...plumbing, chainId: "some-devnet" }, { chainId: 31337 });
  assert.equal(unk.ok, true); assert.equal(unk.items[0].chain.label, "some-devnet"); // unknown scope stays label-only
  const mixed = mapSecondEvidence({ plumbingPending: plumbing, chainId: 143 });
  assert.equal(mixed.staged.length, 0); assert.deepEqual(mixed.refused, [{ source: "second.plumbing_pending", reason: "chain_mismatch" }]);
  const li = { chainId: 143, chain: "monad-testnet", steps: { approve: { hash: H(41) } } };
  assert.equal(mapSecondLaneIntent(li).reason, "chain_mismatch");
  assert.equal(mapSecondLaneReceipt({ schema: "araso_mainnet_lane_receipt_v1", chainId: 143, chain: "monad-testnet", approveTx: H(41) }).reason, "chain_mismatch");
  assert.equal(mapSecondLaneReceipt({ chainId: "monad-testnet", evidencePointer: { schema: "araso_mainnet_lane_receipt_v1", chainId: 143, chain: "monad-mainnet", approveTx: H(41) } }).reason, "chain_mismatch");
  // F2: fork detection normalised
  const base = { chainId: 143, chain: "monad-mainnet", steps: { approve: { hash: H(42) } } };
  for (const v of [{ executionMode: "FORK_SIMULATION" }, { fork: true }, { forkBlock: 123 }, { evidenceClass: "pass_fork_sim_with_pending" }]) {
    assert.equal(mapSecondLaneIntent({ ...base, ...v }).items[0].readEligible, false, JSON.stringify(v));
  }
  assert.equal(mapSecondLaneIntent({ ...base, executionMode: "live" }).items[0].readEligible, true);
  const rcp = { schema: "araso_mainnet_lane_receipt_v1", chainId: 143, chain: "monad-mainnet", approveTx: H(42), executionMode: "live" };
  assert.equal(mapSecondLaneReceipt({ forkBlock: 1, evidencePointer: rcp }).items[0].readEligible, false); // wrapper says fork
  assert.equal(mapSecondLaneReceipt({ evidencePointer: rcp }).items[0].readEligible, true);
  // F3: same hash from two sources -> one staged item, later source refused
  const dup = mapSecondEvidence({ chainId: 143, laneIntent: { ...base, executionMode: "live" }, laneReceipt: rcp });
  assert.equal(dup.staged.length, 1); assert.equal(dup.staged[0].source, "second.lane_intent");
  assert.ok(dup.refused.some((x) => x.source === "second.lane_receipt" && x.reason === "duplicate_evidence_key_across_sources"));
  // F4: `now` bounded; secret keys refused by presence, case/underscore-insensitive
  const big = "9".repeat(100000);
  assert.equal(mapFirstEvidence({ record: { depositTxHash: H(1) }, sourceKind: "send_pending", chainId: 10143, now: big }).items[0].seed.observedAt.length, 40);
  assert.equal(mapSecondPlumbingPending(plumbing, { chainId: 10143, now: big }).items[0].seed.observedAt.length, 40);
  assert.equal(mapSecondStateObservation({ schema: DECISION_RECEIPT_SCHEMA, txExecuted: false }, { now: big }).observation.observedAt.length, 40);
  const gi = { giftId: H(0xabc), txHashes: { delivery: H(30) }, chainId: 10143 };
  assert.equal(mapGiftEvidence({ ...gi, now: big }).items[0].seed.observedAt.length, 40);
  for (const k of ["Token", "claim_token", "SALT", "privateKey", "secret"]) assert.equal(mapGiftEvidence({ ...gi, [k]: "x" }).reason, "secret_field_not_accepted", k);
  assert.equal(mapGiftEvidence({ ...gi, salt: undefined }).reason, "secret_field_not_accepted");
  ok("review fixes F1 chain scope · F2 fork · F3 cross-source dedup · F4 bounds");
}

// ── fit: reader (injected mock rpc) + store (injected storage) ──
{
  const first = mapFirstEvidence({ record: { depositTxHash: H(1), redeemTxHash: H(2) }, sourceKind: "send_pending", chainId: 10143, piggyAddress: A(9) });
  const rpc = async (method, params) => {
    if (method === "eth_chainId") return "0x279f";
    if (method === "eth_getTransactionReceipt") return { status: "0x1", blockNumber: "0x10", blockHash: H(0xb10), transactionHash: params[0], transactionIndex: "0x0", gasUsed: "0x5208" };
    if (method === "eth_getTransactionByHash") return { hash: params[0], nonce: "0x1", gas: "0x5208", from: A(9), to: A(1) };
    if (method === "eth_getTransactionCount") return "0x2";
    return null;
  };
  const s = mem(); const st = createEvidenceStore({ storage: s, chainId: 10143 });
  for (const it of first.items) assert.equal(st.append(it.seed).ok, true);
  for (const it of first.items) {
    const r = await readTxEvidence({ rpc, ...it.readRequest });
    assert.equal(r.ok, true); assert.equal(r.row.status, "success"); assert.equal(r.row.journey, it.journeyLabel); assert.equal(r.row.source, it.readRequest.source);
    assert.equal(r.row.evidenceKey, it.evidenceKey);
    assert.equal(st.append(r.row).outcome, "merged");
  }
  const rows = st.readAll();
  assert.equal(rows.active.length, 2); assert.ok(rows.active.every((x) => x.status === "success" && x.journey.startsWith("first.")));
  // a from-mismatch is surfaced by the reader (expect.from carried by the adapter)
  const wrong = mapFirstEvidence({ record: { depositTxHash: H(1) }, sourceKind: "send_pending", chainId: 10143, piggyAddress: A(4) });
  assert.equal((await readTxEvidence({ rpc, ...wrong.items[0].readRequest })).row.reason, "from_mismatch");
  // a state observation cannot enter the store (no txHash)
  const so = mapSecondStateObservation({ schema: DECISION_RECEIPT_SCHEMA, txExecuted: false, chainId: "monad-mainnet" });
  assert.equal(st.append(so.observation).ok, false);
  ok("items fit A-866 reader + A-868 store");
}

// ── never throws on hostile input ──
{
  const evil = new Proxy({}, { get() { throw new Error("boom"); }, has() { throw new Error("boom"); } });
  const inputs = [undefined, null, 1, "x", [], evil, { record: evil, sourceKind: "send_pending", chainId: 1 }];
  for (const x of inputs) {
    for (const f of [() => mapFirstEvidence(x), () => mapSecondPlumbingPending(x, { chainId: 1 }), () => mapSecondLaneIntent(x), () => mapSecondLaneReceipt(x),
      () => mapSecondStateObservation(x), () => mapSecondEvidence(x), () => mapGiftEvidence(x)]) {
      let out; assert.doesNotThrow(() => { out = f(); }); assert.equal(typeof out?.ok, "boolean");
    }
  }
  ok("no throw on hostile input");
}

{
  // [A-895 P-C] R-1: a plumbing record that carries a NUMERIC chainId is checked against the injected id (was: recordNumeric = null)
  const base = { stage: "deposit-broadcast", depositTxHash: H(60) };
  assert.equal(mapSecondPlumbingPending({ ...base, chainId: 10143 }, { chainId: 143 }).reason, "chain_mismatch");
  assert.equal(mapSecondPlumbingPending({ ...base, chainId: "10143" }, { chainId: 143 }).reason, "chain_mismatch");
  assert.equal(mapSecondPlumbingPending({ ...base, chainId: "10143" }, { chainId: 10143 }).ok, true);
  assert.equal(mapSecondPlumbingPending({ ...base, chainId: 10143 }, {}).ok, true); // numeric id on the record alone resolves the chain
  assert.equal(mapSecondPlumbingPending({ ...base, chainId: "monad-testnet" }, {}).reason, "chain_unlabelled"); // a scope label is still never a number
  // R-2: scope labels are matched after trim + lower-case + "_"/space -> "-"
  for (const v of ["Monad-Testnet", " monad_testnet ", "MONAD TESTNET", "monad-testnet"]) {
    assert.equal(mapSecondPlumbingPending({ ...base, chainId: v }, { chainId: 143 }).reason, "chain_mismatch", v);
    assert.equal(mapSecondPlumbingPending({ ...base, chainId: v }, { chainId: 10143 }).ok, true, v);
  }
  assert.equal(mapSecondPlumbingPending({ ...base, chainId: "Monad_Mainnet" }, { chainId: 10143 }).reason, "chain_mismatch");
  // inherited keys are not scopes (guarded own-property read, no Object.hasOwn in the module)
  for (const v of ["__proto__", "toString", "constructor", "hasOwnProperty"]) assert.equal(mapSecondPlumbingPending({ ...base, chainId: v }, { chainId: 1 }).ok, true, v);
  assert.equal(/Object\.hasOwn\(/.test(SRC.second), false);
  ok("A-895 P-C: A-878 R-1 numeric record chainId + R-2 scope label normalisation + no Object.hasOwn");
}

{
  // [A-895 P-C / L10] no unguarded Object.hasOwn( anywhere in app/src (older WebViews); only execution-safety.js keeps its guarded native/fallback form
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../src/", import.meta.url);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : e.name.endsWith(".js") ? [new URL(e.name, d)] : []));
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const offenders = walk(dir).filter((u) => !u.pathname.endsWith("/execution-safety.js"))
    .filter((u) => /Object\.hasOwn\(/.test(strip(readFileSync(u, "utf8")))).map((u) => u.pathname);
  assert.deepEqual(offenders, []);
  assert.ok(readFileSync(new URL("second-journey-view.js", dir), "utf8").includes("Object.prototype.hasOwnProperty.call(SECOND_FAMILY_TITLES_EN"));
  ok("A-895 P-C: no unguarded Object.hasOwn( in app/src (second-journey-view.js:255 + receipt-evidence-second.js)");
}

console.log(`a878 ALL PASS (${n} groups)`);
