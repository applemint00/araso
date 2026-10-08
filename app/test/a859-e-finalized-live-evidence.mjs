// [A-859] E finalized live-evidence wiring. Fake RPC only: no network, no browser, no tx, no signing.
//   node app/test/a859-e-finalized-live-evidence.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readReturnObservation, RETURN_READ_METHODS, RETURN_READ_METHODS_FINALIZED } from "../src/second-job-readiness.js";
import { runSecondJourney } from "../src/job-feed.js";
import { createSecondJourneyState, recordSecondJourneyDecisionReceipt, validateDecisionReceipt } from "../src/second-journey-state.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const VERCEL = readFileSync(new URL("../../vercel.json", import.meta.url), "utf8");
const SCOPE = { accountId: "0x00000000000000000000000000000000000000a1", chainId: "monad-testnet" };
const KINTSU_DEST = "kintsu-like-grow-delayed-return";
const NOW = () => "2026-10-07T10:00:00.000Z";
const RPC = "https://rpc.monad.xyz";
const HASH = `0x${"ab".repeat(32)}`;

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

function fakeRpc({ finalized = 200000000, latest = 200000040, hash = HASH, chainHex = "0x8f", fee = 10, code = "0x6080", failOn = null, blockResult } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const req = JSON.parse(init.body);
    calls.push({ url, ...req });
    if (failOn === req.method) throw new Error("offline");
    const results = {
      eth_chainId: chainHex,
      eth_blockNumber: `0x${latest.toString(16)}`,
      eth_getBlockByNumber: blockResult !== undefined ? blockResult : { number: `0x${finalized.toString(16)}`, hash },
      eth_getCode: code,
      eth_call: `0x${fee.toString(16).padStart(64, "0")}`,
    };
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: req.id, result: results[req.method] }) };
  };
  return { impl, calls };
}
const read = (rpc, extra = {}) => readReturnObservation("kintsu-smon", { rpcUrl: RPC, fetchImpl: rpc.impl, now: NOW, finality: "finalized", ...extra });

// ── source pins ──────────────────────────────────────────────────────────────
await check("main.js config: exact mainnet RPC + finalized, single literal; product guard present", () => {
  assert.match(MAIN, /\nconst RETURN_EVIDENCE_READ_CONFIG = Object\.freeze\(\{ rpcUrl: "https:\/\/rpc\.monad\.xyz", finality: "finalized" \}\);\n/);
  assert.equal((MAIN.match(/https:\/\/rpc\.monad\.xyz/g) || []).length, 1);
  assert.match(MAIN, /finality: readConfig\.finality,/);
  assert.match(MAIN, /status = "not_finalized"/);
});

await check("vercel.json connect-src: exactly one added host https://rpc.monad.xyz", () => {
  const csp = JSON.parse(VERCEL).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /connect-src 'self' https:\/\/testnet-rpc\.monad\.xyz https:\/\/rpc\.monad\.xyz;/);
  assert.equal(/connect-src[^;]*\*/.test(csp), false);
});

// ── finalized read sequence ──────────────────────────────────────────────────
await check("finalized read: block fetched from the finalized tag first, every state read pinned to that exact block", async () => {
  const rpc = fakeRpc({ finalized: 200000000, latest: 200000040 });
  const out = await read(rpc);
  assert.equal(out.status, "ok");
  assert.deepEqual(rpc.calls.map((c) => c.method), ["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call"]);
  assert.deepEqual(rpc.calls[1].params, ["finalized", false]);
  const tag = `0x${(200000000).toString(16)}`;
  assert.equal(rpc.calls[2].params[1], tag);
  assert.equal(rpc.calls[3].params[1], tag);
  assert.equal(rpc.calls[3].params[0].data, "0xfde73f7d");
  assert.ok(rpc.calls.every((c) => RETURN_READ_METHODS_FINALIZED.includes(c.method)));
  assert.ok(rpc.calls.every((c) => c.url === RPC));
  const o = out.observation;
  assert.equal(o.block, 200000000, "pinned to the finalized block, not the head");
  assert.equal(o.blockHash, HASH);
  assert.equal(o.finality, "finalized");
  assert.equal(o.chainId, 143);
  assert.equal(o.exitFeeBips, 10);
  assert.match(o.source, /@finalized:200000000$/);
});

await check("default (no finality option) stays head-pinned and whitelist unchanged", async () => {
  const rpc = fakeRpc();
  const out = await readReturnObservation("kintsu-smon", { rpcUrl: RPC, fetchImpl: rpc.impl, now: NOW });
  assert.deepEqual(rpc.calls.map((c) => c.method), ["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call"]);
  assert.equal(out.observation.block, 200000040);
  assert.equal(out.observation.finality, undefined);
  assert.deepEqual([...RETURN_READ_METHODS], ["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call"]);
});

await check("no send/sign method is ever reachable in finalized mode", () => {
  assert.ok(RETURN_READ_METHODS_FINALIZED.every((m) => !/send|sign|personal_|wallet_/i.test(m)));
});

// ── negative paths: fail closed, never head fallback, never nah ──────────────
await check("finalized-tag read failures give observation null (no head fallback)", async () => {
  for (const [label, rpc] of [
    ["block read throws", fakeRpc({ failOn: "eth_getBlockByNumber" })],
    ["block null", fakeRpc({ blockResult: null })],
    ["block is string", fakeRpc({ blockResult: "0x1" })],
    ["block is array", fakeRpc({ blockResult: [] })],
    ["bad hash", fakeRpc({ hash: "0x12" })],
    ["missing number", fakeRpc({ blockResult: { hash: HASH } })],
    ["getCode fails", fakeRpc({ failOn: "eth_getCode" })],
    ["eth_call fails", fakeRpc({ failOn: "eth_call" })],
  ]) {
    const out = await read(rpc);
    assert.equal(out.observation, null, label);
    assert.notEqual(out.status, "ok", label);
    assert.ok(!rpc.calls.some((c) => c.method === "eth_blockNumber"), `${label}: never consults the head`);
  }
  assert.equal((await read(fakeRpc(), { rpcUrl: "http://plain.invalid" })).status, "no_rpc");
});

// ── decision Receipt ─────────────────────────────────────────────────────────
function flow(observation, status = "ok") {
  return runSecondJourney({
    scope: SCOPE, selectionKind: "one", selectedErrandIds: ["grow"], preferredDestinationId: KINTSU_DEST,
    requireFreshReturnObservation: true, selectionSource: "app_ui_jit_answer", decisionEventId: "check:k:859",
    jitAnswer: "right_back", returnObservations: observation ? { "kintsu-smon": observation } : undefined,
    returnReadStatus: status, decisionAt: NOW(),
  });
}

await check("right_back + finalized read -> NAH Receipt with integer finalized block + hash, action0, evidence-only chain", async () => {
  const { observation } = await read(fakeRpc());
  const r = flow(observation).decisionReceipt;
  assert.equal(r.decision, "nah");
  assert.equal(r.evidence.block, 200000000);
  assert.ok(Number.isInteger(r.evidence.block));
  assert.equal(r.evidence.readStatus, "ok");
  assert.equal(r.evidence.provenance.observation.finality, "finalized");
  assert.equal(r.evidence.provenance.observation.blockHash, HASH);
  assert.equal(r.evidence.provenance.observation.chainId, 143);
  assert.equal(r.evidence.provenance.observation.exitFeeBips, 10);
  assert.equal(r.action, "none");
  assert.equal(r.actionCount, 0);
  assert.equal(r.txExecuted, false);
  assert.equal(r.executionContext.executable, false);
  assert.equal(r.executionContext.role, "evidence_only_other_chain");
  assert.equal(r.executionContext.runtimeChain, "monad-testnet");
  assert.equal(validateDecisionReceipt(r, createSecondJourneyState(SCOPE)).error, null);
});

await check("Receipt persists and reopens identically (JSON round trip)", async () => {
  const { observation } = await read(fakeRpc());
  const r = flow(observation).decisionReceipt;
  const out = recordSecondJourneyDecisionReceipt(createSecondJourneyState(SCOPE), r);
  assert.equal(out.recorded, true);
  const reopened = JSON.parse(JSON.stringify(out.state));
  assert.deepEqual(reopened.receipts[0], out.state.receipts[0]);
  assert.deepEqual(reopened.receipts[0].evidence, r.evidence);
  const again = recordSecondJourneyDecisionReceipt(reopened, flow(observation).decisionReceipt);
  assert.equal(again.state.receipts.length, 1, "same event id does not duplicate");
});

await check("failed finalized read -> UNKNOWN Receipt (fail-closed), block null, never NAH", async () => {
  const { observation, status } = await read(fakeRpc({ failOn: "eth_getBlockByNumber" }));
  assert.equal(observation, null);
  const r = flow(observation, status).decisionReceipt;
  assert.equal(r.decision, "unknown");
  assert.equal(r.evidence.block, null);
  assert.equal(r.action, "none");
  assert.equal(r.executionContext.executable, false);
});

await check("chain / exit-fee / code conflict on a finalized read -> unknown, not nah", async () => {
  for (const rpc of [fakeRpc({ chainHex: "0x1" }), fakeRpc({ fee: 25 }), fakeRpc({ code: "0x" })]) {
    const { observation } = await read(rpc);
    assert.notEqual(flow(observation).decisionReceipt.decision, "nah");
  }
});

await check("few_days / no_rush stay UNKNOWN with a finalized read", async () => {
  const { observation } = await read(fakeRpc());
  for (const jitAnswer of ["few_days", "no_rush"]) {
    const f = runSecondJourney({
      scope: SCOPE, selectionKind: "one", selectedErrandIds: ["grow"], preferredDestinationId: KINTSU_DEST,
      requireFreshReturnObservation: true, selectionSource: "app_ui_jit_answer", decisionEventId: `check:k:${jitAnswer}`,
      jitAnswer, returnObservations: { "kintsu-smon": observation }, returnReadStatus: "ok", decisionAt: NOW(),
    });
    assert.equal(f.decisionReceipt.decision, "unknown", jitAnswer);
    assert.equal(f.decisionReceipt.action, "none");
  }
});

await check("validator: finalized-claiming Receipt needs matching integer block and a well-formed hash", async () => {
  const { observation } = await read(fakeRpc());
  const good = flow(observation).decisionReceipt;
  const st = createSecondJourneyState(SCOPE);
  const clone = () => JSON.parse(JSON.stringify(good));
  const badBlock = clone(); badBlock.evidence.provenance.observation.block = 5;
  assert.equal(validateDecisionReceipt(badBlock, st).error, "finalized_block_mismatch");
  const badHash = clone(); badHash.evidence.provenance.observation.blockHash = "0xnope";
  assert.equal(validateDecisionReceipt(badHash, st).error, "finalized_without_hash");
  const noBlock = clone(); noBlock.evidence.block = null;
  assert.notEqual(validateDecisionReceipt(noBlock, st).error, null);
});

await check("a non-finalized observation never carries finality into the Receipt", () => {
  const head = { source: "read-only rpc", observedAt: NOW(), block: 200000040, chainId: 143, codePresent: true, exitFeeBips: 10, finality: "finalized", blockHash: "0xbad" };
  const r = flow(head).decisionReceipt;
  assert.equal(r.evidence.provenance.observation.finality, undefined, "malformed hash drops the finalized claim");
});

await check("secret-shape scan exemption is exactly the blockHash slot (hash anywhere else is still rejected)", async () => {
  const { observation } = await read(fakeRpc());
  const good = flow(observation).decisionReceipt;
  const st = createSecondJourneyState(SCOPE);
  const elsewhere = JSON.parse(JSON.stringify(good)); elsewhere.why = `${elsewhere.why} ${HASH}`;
  assert.equal(validateDecisionReceipt(elsewhere, st).error, "secret_shaped_value");
  const otherKey = JSON.parse(JSON.stringify(good)); otherKey.evidence.provenance.observation.txRef = HASH;
  assert.equal(validateDecisionReceipt(otherKey, st).error, "secret_shaped_value");
});

await check("F1: finalized conflict and stale reads record as UNKNOWN action0 (block equality only for nah/live_observation)", async () => {
  const st0 = createSecondJourneyState(SCOPE);
  const { observation: ok } = await read(fakeRpc());
  const { observation: conflict } = await read(fakeRpc({ fee: 25 }));
  const stale = { ...ok, block: 100 };
  for (const [label, obs] of [["conflict", conflict], ["stale", stale]]) {
    const r = flow(obs).decisionReceipt;
    assert.equal(r.decision, "unknown", label);
    assert.equal(r.action, "none", label);
    assert.notEqual(r.evidence.evidenceMode, "live_observation", label);
    assert.equal(r.evidence.provenance.observation.finality, "finalized", label);
    assert.equal(validateDecisionReceipt(r, st0).error, null, label);
    assert.equal(recordSecondJourneyDecisionReceipt(st0, r).recorded, true, label);
  }
  // still strict where the receipt rests on the read
  const nah = flow(ok).decisionReceipt;
  const bad = JSON.parse(JSON.stringify(nah)); bad.evidence.provenance.observation.block = nah.evidence.block + 1;
  assert.equal(validateDecisionReceipt(bad, st0).error, "finalized_block_mismatch");
});

await check("F2: hash scan exemption needs finality+tagUsed finalized and integer block; main.js refuses a hash the RPC did not return", async () => {
  const st0 = createSecondJourneyState(SCOPE);
  const { observation } = await read(fakeRpc());
  const good = flow(observation).decisionReceipt;
  for (const mut of [(o) => { o.tagUsed = "latest"; }, (o) => { o.finality = "latest"; }, (o) => { o.block = "5"; }]) {
    const r = JSON.parse(JSON.stringify(good)); mut(r.evidence.provenance.observation);
    assert.notEqual(validateDecisionReceipt(r, st0).error, null);
  }
  assert.match(MAIN, /receiptObs\.blockHash !== sj\.returnRead\?\.observation\?\.blockHash\) return;/);
  assert.ok(MAIN.indexOf("receiptObs.blockHash !==") < MAIN.indexOf("recordSecondJourneyDecisionReceipt(ensureSecondJourneyDomainState(), receipt)"));
});

console.log(`\n${pass}/${pass} PASS`);
