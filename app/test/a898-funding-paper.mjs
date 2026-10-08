// [A-898] Funding Paper (deliverable A) + the relay bridge refundTo/recipient binding. Node only, no network.
//   node app/test/a898-funding-paper.mjs
// pre-A-911 baseline: the Funding Paper logic pinned here is unchanged. Since A-911 its view is drawn on the own screen (.a911-screen, a911-screens.js); the old .a898-* paper markup remains the pinned module output.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-898 test: network forbidden"); };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC = (f) => readFileSync(path.join(HERE, "..", "src", f), "utf8");
const FP = await import("../src/funding-paper.js");
const FE = await import("../src/funding-entry.js");

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0]}`); }
};

const PIGGY = { id: "p-1", name: "Honeybun", address: "0x1111111111111111111111111111111111111111" };
const CHAIN = "monad-mainnet";
const open = (o = {}) => { const r = FP.openFundingPaper({ piggy: PIGGY, chainId: CHAIN, ...o }); assert.equal(r.ok, true, r.reason); return r.paper; };
const view = (p) => FP.fundingPaperView(p);

await check("A1 exactly three rows in order with the Owner labels", () => {
  const v = view(open());
  assert.deepEqual(v.rows.map((r) => r.id), ["card", "bank", "crypto"]);
  assert.deepEqual(v.rows.map((r) => r.label), ["Pay with card", "Bank transfer", "Pay with crypto"]);
});
await check("A2 card/bank are available:false with a reason; crypto is available", () => {
  const v = view(open());
  const by = Object.fromEntries(v.rows.map((r) => [r.id, r]));
  assert.equal(by.card.available, false); assert.equal(by.card.reason, "no_provider_selected");
  assert.equal(by.bank.available, false); assert.equal(by.bank.reason, "no_provider_selected");
  assert.equal(by.crypto.available, true); assert.equal(by.crypto.reason, null);
  assert.equal(v.rows.length, 3, "never hidden");
});
await check("A3 choosing an unavailable row starts nothing (no intent, stage stays rows)", () => {
  for (const row of ["card", "bank"]) {
    const p = FP.fundingPaperReduce(open(), { type: "choose_row", row });
    assert.equal(p.stage, "rows"); assert.equal(p.intent, null); assert.equal(p.refusal, "no_provider_selected");
  }
});
await check("A4 even an injected card adapter has no start path in this build (fail closed)", () => {
  const p = open({ adapters: FP.fundingPaperAdapters({ card: { available: true, railId: "onramp_provider" } }) });
  assert.equal(view(p).rows[0].available, true);
  const q = FP.fundingPaperReduce(p, { type: "choose_row", row: "card" });
  assert.equal(q.stage, "rows"); assert.equal(q.intent, null); assert.equal(q.refusal, "no_start_path");
});
await check("A5 crypto row = the Piggy's own address + copy + Monad network note; no QR (no encoder in repo)", () => {
  const p = FP.fundingPaperReduce(open(), { type: "choose_row", row: "crypto" });
  const c = view(p).crypto;
  assert.equal(p.stage, "crypto");
  assert.equal(c.address, PIGGY.address); assert.equal(c.copyText, PIGGY.address);
  assert.equal(c.network, "Monad network"); assert.equal(c.qr, null);
  assert.equal(p.intent.target, PIGGY.address); assert.equal(p.intent.targetPiggyId, "p-1");
  assert.equal(p.intent.railId, "direct_wallet_transfer");
});
await check("A6 asset choice (USDC / MON) exists only inside the crypto row", () => {
  const rowsView = view(open());
  assert.equal(rowsView.crypto, null);
  assert.equal(FP.fundingPaperReduce(open(), { type: "choose_asset", asset: "MON" }).cryptoAsset, "USDC", "ignored outside the crypto row");
  let p = FP.fundingPaperReduce(open(), { type: "choose_row", row: "crypto" });
  assert.deepEqual(view(p).crypto.assets.map((a) => a.id), ["USDC", "MON"]);
  p = FP.fundingPaperReduce(p, { type: "choose_asset", asset: "MON" });
  assert.equal(p.cryptoAsset, "MON"); assert.equal(p.intent.targetAsset, "MON");
  assert.equal(FP.fundingPaperReduce(p, { type: "choose_asset", asset: "DOGE" }).cryptoAsset, "MON");
  const markupRows = FP.fundingPaperMarkup(view(open()));
  assert.equal(/USDC|MON/.test(markupRows), false, "rows screen shows no asset");
});
await check("A7 no provider names / Apple Pay / Cash in any rendered stage", () => {
  const stages = [open(), FP.fundingPaperReduce(open(), { type: "choose_row", row: "crypto" })];
  for (const p of stages) assert.equal(/ramp|moonpay|transak|stripe|coinbase|apple|google|cash|relay|across|li\.fi/i.test(FP.fundingPaperMarkup(view(p))), false);
  assert.equal(/apple pay|google pay|"cash"|cash/i.test(JSON.stringify(view(open()).rows)), false);
});
await check("A8 shortfall prefill: destination = that Piggy, amount = shortfall; copy of the original intent kept", () => {
  const p = open({ prefill: { amount: "12" }, resumeAfter: { piggyId: "p-1", action: "gift_send:d1", amount: "20", asset: "USDC", decimals: 6 }, draftId: "d1" });
  assert.deepEqual(view(p).prefill, { amountUsd: "12", asset: "USDC" });
  const q = FP.fundingPaperReduce(p, { type: "choose_row", row: "crypto" });
  assert.equal(q.intent.requestedAmount, "12"); assert.equal(q.intent.targetPiggyId, "p-1");
  assert.equal(view(q).returnsToDraft, true);
  assert.equal(FP.openFundingPaper({ piggy: PIGGY, chainId: CHAIN, prefill: { amount: "0" } }).ok, false);
});
await check("A9 standalone deposit has no amount (openAmount only for the paper); startFunding default stays strict", () => {
  const q = FP.fundingPaperReduce(open(), { type: "choose_row", row: "crypto" });
  assert.equal(q.intent.requestedAmount, null);
  const strict = FE.startFunding({ method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, amount: null, arrival: { chain: CHAIN, asset: "USDC" }, expectedChain: CHAIN, target: PIGGY.address, targetPiggyId: "p-1", adapters: [{ method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, available: true, railId: "direct_wallet_transfer" }] });
  assert.equal(strict.ok, false); assert.equal(strict.reason, "invalid_amount");
});
const confirmed = (o = {}) => ({ status: "confirmed", chain: CHAIN, asset: "USDC", target: PIGGY.address, amount: "12", txHash: "0xabc", at: "2026-10-08T00:00:00Z", ...o });
await check("A10 balance grows ONLY on a confirmed arrival; pending/unknown/failed/wrong asset/target never credit", () => {
  const base = FP.fundingPaperReduce(open({ prefill: { amount: "12" } }), { type: "choose_row", row: "crypto" });
  assert.equal(FP.fundingPaperBalanceGrew(base), false);
  for (const [r, stage] of [[{ status: "pending" }, "pending"], [{ status: "unknown" }, "unknown"], [{ status: "failed" }, "failed"], [confirmed({ asset: "MON" }), "failed"], [confirmed({ target: "0x2222222222222222222222222222222222222222" }), "failed"], [confirmed({ txHash: "" }), "failed"]]) {
    const p = FP.fundingPaperReduce(base, { type: "arrival", result: r });
    assert.equal(p.stage, stage); assert.equal(FP.fundingPaperBalanceGrew(p), false); assert.equal(view(p).balanceGrew, false);
  }
  const ok = FP.fundingPaperReduce(base, { type: "arrival", result: confirmed() });
  assert.equal(ok.stage, "confirmed"); assert.equal(FP.fundingPaperBalanceGrew(ok), true);
  assert.equal(ok.lastResult.credited.amount, "12", "credited = the arrived amount");
});
await check("A11 confirmed arrival from a draft resumes that draft (resumeAfterFunding), grants no permission", () => {
  const ra = { piggyId: "p-1", action: "gift_send:d1", amount: "20", asset: "USDC", decimals: 6 };
  const base = FP.fundingPaperReduce(open({ prefill: { amount: "12" }, resumeAfter: ra, draftId: "d1" }), { type: "choose_row", row: "crypto" });
  const ok = FP.fundingPaperReduce(base, { type: "arrival", result: confirmed(), available: "20" });
  assert.equal(ok.resumed.resume, true); assert.equal(ok.resumed.permissionGranted, false); assert.equal(FP.fundingPaperReturnsToDraft(ok), true);
  const less = FP.fundingPaperReduce(base, { type: "arrival", result: confirmed({ amount: "5" }), available: "13" });
  assert.equal(less.resumed.stillShort, "7");
  const pend = FP.fundingPaperReduce(base, { type: "arrival", result: { status: "pending" } });
  assert.equal(FP.fundingPaperReturnsToDraft(pend), false);
});
await check("A12 back: crypto -> rows (intent dropped); rows -> closing", () => {
  let p = FP.fundingPaperReduce(open(), { type: "choose_row", row: "crypto" });
  p = FP.fundingPaperReduce(p, { type: "back" });
  assert.equal(p.stage, "rows"); assert.equal(p.intent, null); assert.equal(p.closing, false);
  assert.equal(FP.fundingPaperReduce(p, { type: "back" }).closing, true);
});
await check("A13 live seams are null; no fetch in the new modules; the tripwire never fired", () => {
  assert.equal(FP.FUNDING_PAPER_CONFIG.arrivalReader, null);
  assert.equal(view(FP.fundingPaperReduce(open(), { type: "choose_row", row: "crypto" })).canCheck, false);
  for (const f of ["funding-paper.js", "gift-send-paper.js"]) assert.equal(/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|setInterval|setTimeout/.test(SRC(f).replace(/\/\/.*$/gm, "")), false, f);
  assert.equal(fetchCalls, 0);
});
await check("A14 main.js wiring: [A-898] blocks are // comments only; crypto proof precedes the address; no live planner referenced", () => {
  const MAIN = SRC("main.js");
  const i = MAIN.indexOf("// ── [A-898] Funding Paper"); const j = MAIN.indexOf("// ── [A-898] end ──");
  assert.ok(i > 0 && j > i);
  const block = MAIN.slice(i, j);
  assert.equal(block.includes("/*"), false);
  assert.ok(block.indexOf("a898ProveDestination(paper.piggy)") < block.indexOf('type: "choose_row"'), "Face ID destination proof before the crypto row opens");
  assert.equal(/planRelayFunding|planFundingRoute|relayQuoteRequestForFunding|requestRelayQuote/.test(MAIN), false);
  assert.equal(/\bfetch\(/.test(block), false);
  assert.equal(/Piggy picker|selectPiggyForGift/i.test(block), false);
  assert.ok(MAIN.includes("a898OpenFundingPaper(only, null)") && MAIN.includes("a898BodyMarkup()"));
});

// ── relay bridge: refundTo + recipient are passed into the binding (A-901 D2 / review) ──────────────────────────────
const LIVE = path.join(ROOT, "_private/ops/receipts/A901_relay_proxy/live/live-quote-response.json");
const LIB = path.join(ROOT, "_private/ops/harness/a886-relay-funding-sim/lib.mjs");
if (!existsSync(LIVE) || !existsSync(LIB)) {
  console.log("SKIP  B* relay live fixture not present (public clone)");
} else {
  const RAW = JSON.parse(readFileSync(LIVE, "utf8"));
  const lib = await import(LIB);
  const { planRelayFunding } = await import("../src/funding-intent-bridge.js");
  const { FUNDING_PLAN_STATE, startFunding, FUNDING_METHOD, FUNDING_RAIL } = FE;
  const { MONAD_USDC_ADDRESS } = await import("../src/funding-rail-relay.js");
  const PAYER = RAW.details.sender; const RECIP = RAW.details.recipient;
  const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const DEP = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
  const NOW_MS = 1_791_366_000_000;
  const binding = (over = {}) => ({ source: { chainId: 8453, token: BASE_USDC, decimals: 6 }, destination: { chainId: 143, token: MONAD_USDC_ADDRESS, decimals: 6 }, recipient: RECIP, inputAmountUnits: "5000000", ...over });
  const intent = startFunding({ method: FUNDING_METHOD.FROM_ANOTHER_WALLET, amount: "5", arrival: { chain: "monad-mainnet", asset: "USDC" }, target: RECIP, targetPiggyId: "p-live", adapters: [{ method: FUNDING_METHOD.FROM_ANOTHER_WALLET, available: true, railId: FUNDING_RAIL.INTERNAL_ROUTE }], expectedChain: "monad-mainnet" }).intent;
  const safety = { policy: lib.TEST_ONLY_POLICY, nowMs: NOW_MS, allowedSpenders: [DEP], allowedStepTargets: [DEP], destinationRecords: [{ address: RECIP, source: "piggy_registry" }] };
  const run = (o = {}) => planRelayFunding({ intent, binding: binding(o.binding), rawQuote: RAW, payer: PAYER, receivedAtMs: NOW_MS - 1000, expiresAtMs: NOW_MS + 30000, safety, ...o, binding: binding(o.binding) });
  await check("B1 live fixture + the payer as refundTo (explicit) and the request recipient -> READY_FOR_CONFIRMATION", () => {
    const r = run({ refundTo: PAYER });
    assert.equal(r.state, FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION, JSON.stringify(r.reasons));
  });
  await check("B2 refundTo omitted = the payer (same default as the request builder) -> READY", () => {
    assert.equal(run().state, FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION);
  });
  await check("B3 a different refundTo -> rejected (relay_refund_recipient_not_refundto)", () => {
    const r = run({ refundTo: "0x3333333333333333333333333333333333333333" });
    assert.notEqual(r.state, FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION); assert.ok(JSON.stringify(r).includes("refund_recipient_not_refundto"), JSON.stringify(r.reasons));
  });
  await check("B4 attacker recipient in the binding (monad-side refund goes elsewhere) -> rejected", () => {
    const r = run({ binding: { recipient: "0x4444444444444444444444444444444444444444" } });
    assert.notEqual(r.state, FUNDING_PLAN_STATE.READY_FOR_CONFIRMATION);
    assert.ok(/recipient|refund/.test(JSON.stringify(r.reasons)), JSON.stringify(r.reasons));
  });
  await check("B5 the bridge source passes refundTo and recipient into verifyRelayDepositBinding", () => {
    const s = SRC("funding-intent-bridge.js");
    const k = s.indexOf("verifyRelayDepositBinding(raw, {");
    const call = s.slice(k, k + 700);
    assert.ok(/refundTo/.test(call) && /recipient: binding\.recipient/.test(call));
  });
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
