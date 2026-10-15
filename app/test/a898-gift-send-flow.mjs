// [A-898] Send a Piggy (deliverables B-D + E): payer == selected == signer, presets, shortfall -> Funding Paper -> same draft,
// asset grammar, Face ID line, quote lock, fees named apart. Node only, no network.
//   node app/test/a898-gift-send-flow.mjs
// pre-A-911 baseline: the Send a Piggy logic pinned here is unchanged. Since A-911 the Gift is drawn on its own screen (.a911-screen); the .a898-* markup below is the module output that stays pinned.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-898 test: network forbidden"); };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = (f) => readFileSync(path.join(HERE, "..", "src", f), "utf8");
const G = await import("../src/gift-send-paper.js");
const FP = await import("../src/funding-paper.js");
const VS = await import("../src/gift-value-spec.js");
const FPm = await import("../src/funding-paper.js");

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0]}`); }
};

const PAYER = { id: "p-1", name: "Honeybun", address: "0x1111111111111111111111111111111111111111" };
const OTHER = { id: "p-2", name: "Mochi", address: "0x2222222222222222222222222222222222222222" };
const NOW = 1_800_000_000_000;
const GAS = { gasUnits: { commitClaim: 100000n, claim: 100000n, fundingTransfer: 21000n }, feeInputs: { maxFeePerGasWei: 100000000000n, source: "test-fixture" }, safety: { bufferBps: 1000 } };
// cost = 221000 * 1e11 = 2.21e16 wei, +10% buffer = 2.431e16 wei = 0.02431 MON; at $3 -> $0.07293 -> rounds UP to $0.08
const MARKET = (o = {}) => ({ monUsd: "3", receivedAtMs: NOW - 1000, expiresAtMs: NOW + 10000, quote: null, ...o });
const mk = (preset = null, extra = {}) => {
  const r = G.openGiftSend({ piggy: PAYER, selected: PAYER, chainScope: "monad-testnet", nowMs: NOW });
  assert.equal(r.ok, true);
  let d = r.draft;
  if (preset !== null) d = G.giftSendReduce(d, { type: "set_preset", preset });
  if (preset !== null) d = G.giftSendReduce(d, { type: "pick_front", front: "01" });
  return { ...d, ...extra };
};
const ev = (d, o = {}) => G.giftSendEvaluate(d, { holdings: { usdc: "50", mon: null }, market: null, gas: null, nowMs: NOW, ...o });

await check("B1 presets are exactly 20/50/100; no default; no custom amount", () => {
  assert.deepEqual([...G.GIFT_SEND_PRESETS], [20, 50, 100]);
  assert.deepEqual([...G.GIFT_SEND_PRESETS], [...VS.GIFT_VALUE_PRESET_LABELS]);
  const d = mk();
  assert.equal(d.preset, null, "no default");
  assert.deepEqual(G.giftSendView(d, ev(d)).presets.map((p) => p.id), ["20", "50", "100"]);
  for (const bad of [25, "25", 0, -20, 20.5, "20.5", "", null, undefined, NaN, "0x14", 1e2 + 1]) {
    const x = G.giftSendReduce(d, { type: "set_preset", preset: bad });
    assert.equal(x.preset, null, String(bad)); assert.equal(x.refusal, "unsupported_amount");
  }
  for (const good of [20, "20", 50, "50", 100, "100"]) assert.equal(G.giftSendReduce(d, { type: "set_preset", preset: good }).preset, Number(good));
});
await check("B2 payer = the selected Piggy only; no picker (not selected / wrong address / missing -> refused)", () => {
  assert.equal(G.openGiftSend({ piggy: PAYER, selected: OTHER, chainScope: "s" }).reason, "payer_not_selected");
  assert.equal(G.openGiftSend({ piggy: PAYER, selected: null, chainScope: "s" }).reason, "payer_not_selected");
  assert.equal(G.openGiftSend({ piggy: PAYER, selected: { ...PAYER, address: OTHER.address }, chainScope: "s" }).reason, "payer_selection_address_mismatch");
  assert.equal(G.openGiftSend({ piggy: { id: "x" }, selected: { id: "x" }, chainScope: "s" }).reason, "payer_address_missing");
  const v = G.giftSendView(mk(20), ev(mk(20)));
  assert.equal(Object.keys(v).some((k) => /piggies|picker|choices/i.test(k)), false);
  assert.equal(/picker/i.test(G.giftSendPaperMarkup(v)), false);
});
await check("B3 payer must be the signer: Face ID with another Piggy's signer is refused; the payer's signer proceeds", () => {
  const e = ev(mk(20), { market: MARKET(), gas: GAS });
  const lock = G.lockQuote(e, { nowMs: NOW });
  assert.ok(lock);
  let d = G.giftSendReduce(mk(20), { type: "faceid_start", lock });
  assert.equal(d.stage, "faceid");
  const bad = G.giftSendReduce(d, { type: "faceid_result", ok: true, signerAddress: OTHER.address });
  assert.equal(bad.stage, "compose"); assert.equal(bad.refusal, "signer_mismatch"); assert.equal(bad.lock, null);
  const none = G.giftSendReduce(d, { type: "faceid_result", ok: true });
  assert.equal(none.refusal, "no_signer");
  assert.equal(G.giftSendReduce(d, { type: "faceid_result", ok: false }).refusal, "faceid_declined");
  const ok = G.giftSendReduce(d, { type: "faceid_result", ok: true, signerAddress: PAYER.address.toUpperCase().replace("0X", "0x") });
  assert.equal(ok.stage, "executing");
  assert.equal(G.giftSendReduce({ ...mk(20), payer: PAYER }, { type: "payer_changed" }).stage, "closed");
});
await check("C1 enough: USDC covers it -> no asset display, no short, no MON option", () => {
  const d = mk(20);
  const e = ev(d, { holdings: { usdc: "50", mon: "10" }, market: MARKET(), gas: GAS });
  assert.equal(e.state, "enough"); assert.equal(e.short, false); assert.equal(e.monOption.offered, false);
  const v = G.giftSendView(d, e);
  assert.equal(v.short, false);
  assert.equal(v.faceIdLine.assetChange, false);
  assert.equal(/MON/.test(v.faceIdLine.text), false);
  assert.equal(v.faceIdLine.text, "$20 for this Gift · fee $0.08");
  const html = G.giftSendPaperMarkup(v);
  assert.equal(/need \$|Use MON|gift-add-money|gift-use-mon/.test(html), false);
});
await check("D1 short: need $X more + [Add money]; no auto popup; Face ID blocked", () => {
  const d = mk(20);
  const e = ev(d, { holdings: { usdc: "8", mon: null }, market: MARKET(), gas: GAS });
  assert.equal(e.state, "short"); assert.equal(e.shortfall, "12"); assert.equal(e.shortfallUsd, "12");
  assert.equal(e.canFaceId, false); assert.equal(e.blockedReason, "short");
  assert.equal(e.monOption.offered, false);
  const html = G.giftSendPaperMarkup(G.giftSendView(d, e));
  assert.ok(html.includes("need $12 more")); assert.ok(html.includes('data-a898-act="gift-add-money"'));
  assert.equal(/Use MON/.test(html), false);
  assert.equal(d.stage, "compose", "evaluating never opens funding by itself");
});
await check("D2 shortfall -> Funding Paper args: destination = payer, amount = shortfall, original intent kept; return = SAME draft", () => {
  let d = G.giftSendReduce(G.giftSendReduce(mk(20), { type: "set_to", value: "Dana" }), { type: "set_message", value: "happy birthday" });
  const e = ev(d, { holdings: { usdc: "8", mon: null } });
  const a = G.giftSendFundingArgs(d, e, { chainId: "monad-mainnet" });
  assert.equal(a.ok, true);
  assert.equal(a.openArgs.piggy.id, PAYER.id); assert.equal(a.openArgs.prefill.amount, "12"); assert.equal(a.openArgs.draftId, d.draftId);
  assert.equal(a.openArgs.resumeAfter.action, `gift_send:${d.draftId}`); assert.equal(a.openArgs.resumeAfter.amount, "20");
  assert.equal(G.giftSendFundingArgs(d, ev(d), { chainId: "monad-mainnet" }).reason, "not_short");
  d = G.giftSendReduce(d, { type: "funding_opened" });
  assert.equal(d.stage, "funding");
  assert.equal(G.giftSendReduce(d, { type: "set_to", value: "changed" }).to, "Dana", "fields are frozen while the paper is open");
  const opened = FP.openFundingPaper(a.openArgs);
  assert.equal(opened.ok, true);
  let paper = FP.fundingPaperReduce(opened.paper, { type: "choose_row", row: "crypto" });
  assert.equal(paper.intent.targetPiggyId, PAYER.id); assert.equal(paper.intent.requestedAmount, "12");
  // not yet confirmed -> not returned
  const pend = FP.fundingPaperReduce(paper, { type: "arrival", result: { status: "pending" } });
  assert.equal(G.giftSendResumeCheck(d, pend).ok, false);
  // a paper opened for ANOTHER draft never resumes this one
  const other = FP.fundingPaperReduce(FP.fundingPaperReduce(FP.openFundingPaper({ ...a.openArgs, draftId: "other" }).paper, { type: "choose_row", row: "crypto" }), { type: "arrival", result: { status: "confirmed", chain: "monad-mainnet", asset: "USDC", target: PAYER.address, amount: "12", txHash: "0x1" }, available: "20" });
  assert.equal(G.giftSendResumeCheck(d, other).reason, "different_draft");
  const done = FP.fundingPaperReduce(paper, { type: "arrival", result: { status: "confirmed", chain: "monad-mainnet", asset: "USDC", target: PAYER.address, amount: "12", txHash: "0x1" }, available: "20" });
  const back = G.giftSendResumeCheck(d, done);
  assert.equal(back.ok, true); assert.equal(back.funded, true); assert.equal(back.stillShort, null);
  const same = G.giftSendReduce(d, { type: "funding_returned" });
  assert.equal(same.draftId, d.draftId); assert.equal(same.preset, 20); assert.equal(same.to, "Dana"); assert.equal(same.message, "happy birthday"); assert.equal(same.stage, "compose");
  // after the return the evaluation is "enough" and Face ID is reachable
  assert.equal(ev(same, { holdings: { usdc: "20", mon: null }, market: MARKET(), gas: GAS }).canFaceId, true);
  // a smaller arrival returns to the same draft but still short with the NEW shortfall
  const small = FP.fundingPaperReduce(paper, { type: "arrival", result: { status: "confirmed", chain: "monad-mainnet", asset: "USDC", target: PAYER.address, amount: "5", txHash: "0x2" }, available: "13" });
  assert.equal(G.giftSendResumeCheck(d, small).stillShort, "7");
  assert.equal(ev(same, { holdings: { usdc: "13", mon: null } }).shortfall, "7");
});
await check("C2 MON: `Use MON for the remaining $X` only when short AND MON is held", () => {
  const d = mk(20);
  const cases = [
    [{ usdc: "50", mon: "10" }, false], // enough
    [{ usdc: "8", mon: null }, false], // short, no MON
    [{ usdc: "8", mon: "0" }, false],
    [{ usdc: "8", mon: "10" }, true],
  ];
  for (const [h, offered] of cases) {
    const e = ev(d, { holdings: h });
    assert.equal(e.monOption.offered, offered, JSON.stringify(h));
    const html = G.giftSendPaperMarkup(G.giftSendView(d, e));
    assert.equal(html.includes("Use MON for the remaining $12"), offered);
  }
  // a quote that needs more MON than held -> not offered
  assert.equal(ev(d, { holdings: { usdc: "8", mon: "1" }, market: MARKET({ quote: { monIn: "4.1", routeFeeUsd: "0", usdOut: "12" } }) }).monOption.offered, false);
  // choosing MON when not offered is refused
  assert.equal(G.giftSendReduce(d, { type: "pay_with", asset: "mon", offered: false }).payWith, "usdc");
  // held MON is shown as-is: $ big (only with a live price), token small
  const held = ev(d, { holdings: { usdc: "8", mon: "10" }, market: MARKET() }).monHeld;
  assert.deepEqual(held, { usd: "30", tokenQuantity: "10" });
});
await check("C3 MON chosen: the Face ID line is the Owner grammar and exact only with a quote, a fee and coverage", () => {
  let d = G.giftSendReduce(mk(20), { type: "pay_with", asset: "mon", offered: true });
  const H = { usdc: "8", mon: "10" };
  const q = { monIn: "4.1", routeFeeUsd: "0", usdOut: "12" };
  let e = ev(d, { holdings: H, market: MARKET({ quote: q }), gas: GAS });
  assert.equal(e.state, "short_mon"); assert.equal(e.canFaceId, true);
  assert.equal(e.faceIdLine.text, "About 4.1 MON → $12 for this Gift · fee $0.08");
  assert.equal(e.faceIdLine.assetChange, true);
  assert.ok(G.giftSendPaperMarkup(G.giftSendView(d, e)).includes("What's this?") /* Owner 2026-10-08 label (pre-label baseline: 설명이 필요해?) */, "red optional explain shows only on an asset change");
  // no quote -> not exact, Face ID disabled
  e = ev(d, { holdings: H, market: MARKET(), gas: GAS });
  assert.equal(e.faceIdLine.exact, false); assert.equal(e.faceIdLine.text, null); assert.equal(e.canFaceId, false); assert.equal(e.blockedReason, "quote_unavailable");
  // quote delivering less than the remaining $12 -> refused
  e = ev(d, { holdings: H, market: MARKET({ quote: { monIn: "4.1", routeFeeUsd: "0", usdOut: "11.99" } }), gas: GAS });
  assert.equal(e.canFaceId, false); assert.equal(e.blockedReason, "quote_below_remaining");
  // expired quote -> not usable
  e = ev(d, { holdings: H, market: MARKET({ quote: q, expiresAtMs: NOW - 1 }), gas: GAS });
  assert.equal(e.canFaceId, false);
  // fee unknown (no gas inputs) -> blocked, no placeholder fee printed
  e = ev(d, { holdings: H, market: MARKET({ quote: q }), gas: null });
  assert.equal(e.canFaceId, false); assert.equal(e.blockedReason, "fee_unknown"); assert.equal(e.faceIdLine.text, null);
  // "About N MON" never understates (rounded up at 4 dp)
  e = ev(d, { holdings: H, market: MARKET({ quote: { monIn: "4.100001", routeFeeUsd: "0", usdOut: "12" } }), gas: GAS });
  assert.equal(e.faceIdLine.parts.monIn, "4.1001");
  // switching preset drops the MON choice (no stale conversion)
  assert.equal(G.giftSendReduce(d, { type: "set_preset", preset: 50 }).payWith, "usdc");
  // short + USDC-only: no Face ID line at all
  assert.equal(ev(mk(20), { holdings: H, market: MARKET({ quote: q }), gas: GAS }).faceIdLine, null);
});
await check("C4 no asset change without the Face ID line: every MON path that can reach Face ID carries an exact line", () => {
  const d = G.giftSendReduce(mk(20), { type: "pay_with", asset: "mon", offered: true });
  for (const m of [null, MARKET(), MARKET({ quote: { monIn: "4.1", routeFeeUsd: "0", usdOut: "12" } })]) for (const g of [null, GAS]) {
    const e = ev(d, { holdings: { usdc: "8", mon: "10" }, market: m, gas: g });
    if (e.canFaceId) { assert.equal(e.faceIdLine.exact, true); assert.ok(/^About .+ MON → \$12 for this Gift · fee \$\d+\.\d\d$/.test(e.faceIdLine.text)); }
    assert.equal(e.canFaceId, e.faceIdLine?.exact === true);
  }
  assert.equal(G.lockQuote(ev(d, { holdings: { usdc: "8", mon: "10" }, market: MARKET() }), { nowMs: NOW }), null, "no lock without an exact line");
});
await check("C5 quote lock at Face ID; re-check at execution; interval/tolerance are injected (null defaults)", () => {
  const d = G.giftSendReduce(mk(20), { type: "pay_with", asset: "mon", offered: true });
  const H = { usdc: "8", mon: "10" };
  const at = (monIn, fee = GAS, t = NOW - 1000) => ev(d, { holdings: H, market: MARKET({ receivedAtMs: t, quote: { monIn, routeFeeUsd: "0", usdOut: "12" } }), gas: fee });
  const lock = G.lockQuote(at("4.1"), { nowMs: NOW });
  assert.equal(G.reconcileQuote(lock, at("4.1")).reason, "requote_needed", "a cached / same-time read is not a fresh quote (fail closed, S-6)");
  const at0 = at; const at2 = (m, f) => at0(m, f, NOW - 500); // execution-time read is strictly newer
  assert.equal(lock.text, "About 4.1 MON → $12 for this Gift · fee $0.08"); assert.equal(Object.isFrozen(lock), true);
  assert.equal(G.reconcileQuote(lock, at2("4.1")).ok, true);
  assert.equal(G.reconcileQuote(lock, at2("4.0")).ok, true, "better than the lock passes");
  assert.equal(G.reconcileQuote(lock, at2("4.2")).reason, "requote_needed", "worse with no injected tolerance -> show again and ask");
  assert.equal(G.reconcileQuote(lock, at2("4.2"), { toleranceBps: 300 }).ok, true, "within the injected tolerance");
  assert.equal(G.reconcileQuote(lock, at2("4.3"), { toleranceBps: 300 }).reason, "requote_needed");
  assert.equal(G.reconcileQuote(null, at("4.1")).reason, "no_lock");
  assert.equal(G.reconcileQuote(lock, ev(d, { holdings: H, market: MARKET({ receivedAtMs: NOW - 500 }), gas: GAS })).reason, "requote_needed");
  assert.equal(G.GIFT_SEND_CONFIG.quoteRefreshMs, null); assert.equal(G.GIFT_SEND_CONFIG.quoteToleranceBps, null);
  assert.equal(G.quoteRefreshDue({ lastAtMs: 0, nowMs: 10 }), false, "no interval -> never auto-refresh");
  assert.equal(G.quoteRefreshDue({ lastAtMs: 0, nowMs: 10, intervalMs: 5 }), true);
  assert.equal(G.quoteRefreshDue({ lastAtMs: 8, nowMs: 10, intervalMs: 5 }), false);
});
await check("D3 fees named apart: Gift gas cost (sender, from giftGasBudget + injected fees) vs Araso fee = 0 / not adopted", () => {
  const e = ev(mk(20), { market: MARKET(), gas: GAS });
  assert.deepEqual(e.fees.giftGasCost, { usd: "0.08", known: true });
  assert.deepEqual(e.fees.arasoFee, { adopted: false, bps: 0, usd: "0" });
  assert.equal(G.GIFT_SEND_COPY.giftGasCost, "Gift gas cost"); assert.equal(G.GIFT_SEND_COPY.arasoFee, "Araso fee");
  assert.equal(Object.isFrozen(G.ARASO_FEE), true);
  // no fee inputs / no price -> unknown, never invented
  assert.deepEqual(ev(mk(20), { market: MARKET(), gas: { ...GAS, feeInputs: null } }).fees.giftGasCost, { usd: null, known: false });
  assert.deepEqual(ev(mk(20), { market: null, gas: GAS }).fees.giftGasCost, { usd: null, known: false });
  // the sender pays the gas; the recipient needs no MON
  assert.equal(VS.GIFT_GAS_POLICY.payer, "sender"); assert.equal(VS.GIFT_GAS_POLICY.recipientMonRequired, 0n);
  // the view always carries both names
  const v = G.giftSendView(mk(20), e);
  assert.equal(v.fees.arasoFee.adopted, false);
});
await check("D4 the link plan carries exactly the preset: no Araso fee is deducted or added; payer == sender", async () => {
  const d = mk(50, { message: "hello" });
  const plan = await G.planGiftSend({ draft: d, senderAddress: PAYER.address, expiry: 1_900_000_000, gas: GAS, origin: "https://example.test" });
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.escrowCreateArgs.amount, VS.GIFT_VALUE_PRESET_ATOMIC_AMOUNTS[1] ?? 50_000_000n);
  assert.equal(String(plan.escrowCreateArgs.amount), "50000000");
  assert.deepEqual(plan.arasoFee, { adopted: false, bps: 0, usd: "0" });
  assert.equal(plan.gasPayer, "sender");
  assert.equal(plan.gasBudget.payer, "sender"); assert.equal(plan.gasBudget.recipientMonRequired, 0n);
  assert.equal(Object.keys(plan.escrowCreateArgs).some((k) => /fee/i.test(k)), false);
  assert.ok(plan.claimUrl.startsWith("https://example.test"));
  assert.equal((await G.planGiftSend({ draft: d, senderAddress: OTHER.address, expiry: 1_900_000_000 })).reason, "sender_is_not_payer");
  assert.equal((await G.planGiftSend({ draft: mk(), senderAddress: PAYER.address, expiry: 1_900_000_000 })).reason, "explicit_selection_required");
  const src = SRC("gift-send-paper.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/arasoFee\s*[+\-*]=|bps\s*[*]|feeBps|araso.*deduct/i.test(src), false, "no code path computes an Araso fee");
});
await check("E1 live seams null: executor unavailable -> stage unavailable, no link; no network", () => {
  for (const k of Object.keys(G.GIFT_SEND_CONFIG)) assert.equal(G.GIFT_SEND_CONFIG[k], null, k);
  let d = G.giftSendReduce(mk(20), { type: "faceid_start", lock: G.lockQuote(ev(mk(20), { market: MARKET(), gas: GAS }), { nowMs: NOW }) });
  d = G.giftSendReduce(d, { type: "faceid_result", ok: true, signerAddress: PAYER.address });
  const u = G.giftSendReduce(d, { type: "executed", result: { ok: false, reason: "executor_unavailable" } });
  assert.equal(u.stage, "unavailable"); assert.equal(u.link, null);
  assert.equal(G.giftSendView(u, ev(u)).link, null);
  const done = G.giftSendReduce(d, { type: "executed", result: { ok: true, link: "https://x.test/#g" } });
  assert.equal(done.stage, "done");
  assert.equal(G.giftSendReduce(d, { type: "executed", result: { ok: false, reason: "requote_needed" } }).stage, "requote");
  assert.equal(fetchCalls, 0);
});
await check("E2 draft fields: one line capped at 140; faceid stage freezes edits", () => {
  const d = G.giftSendReduce(mk(20), { type: "set_message", value: "x".repeat(300) });
  assert.equal(d.message.length, 135, "140 note channel minus the 5-char frame (front + 3 separators)");
  const f = G.giftSendReduce(d, { type: "faceid_start", lock: { text: "t" } });
  assert.equal(G.giftSendReduce(f, { type: "set_message", value: "y" }).message.length, 135);
  assert.equal(G.giftSendReduce(f, { type: "set_preset", preset: 50 }).preset, 20);
});
await check("F1 fronts: three ids, no default, pick flips to the letter, Face ID needs a front, from is optional", () => {
  assert.deepEqual([...G.GIFT_FRONTS], ["01", "02", "04"]);
  let d = G.openGiftSend({ piggy: PAYER, selected: PAYER, chainScope: "s", nowMs: NOW }).draft;
  d = G.giftSendReduce(d, { type: "set_preset", preset: 20 });
  let v = G.giftSendView(d, ev(d, { market: MARKET(), gas: GAS }));
  assert.equal(v.picked, null); assert.equal(v.flipped, false); assert.deepEqual(v.fronts.map((f) => f.id), ["01", "02", "04"]);
  assert.equal(v.canFaceId, false); assert.equal(v.blockedReason, "front_required");
  assert.equal(G.giftSendReduce(d, { type: "pick_front", front: "03" }).front, null);
  d = G.giftSendReduce(d, { type: "pick_front", front: "02" });
  v = G.giftSendView(d, ev(d, { market: MARKET(), gas: GAS }));
  assert.equal(v.picked, "02"); assert.equal(v.flipped, false, "step 1 = lift only"); assert.equal(v.fronts[1].selected, true); assert.equal(v.fields.from, "");
  d = G.giftSendReduce(d, { type: "flip_front" });
  assert.equal(G.giftSendView(d, ev(d)).flipped, true, "step 2 = flip");
  assert.equal(G.giftSendView(d, ev(d, { market: MARKET(), gas: GAS })).canFaceId, true);
  d = G.giftSendReduce(d, { type: "set_from", value: "Sam" });
  assert.equal(G.giftSendView(d, ev(d)).fields.from, "Sam");
  const html = G.giftSendPaperMarkup(G.giftSendView(d, ev(d, { market: MARKET(), gas: GAS })));
  assert.ok(html.includes('data-a898-act="gift-front"') && html.includes('data-a898-arg="04"'));
});

// ── review fixes: entry button, signer teardown, persistence, notices, empty-$ ──────────────────────────────────────
await check("R1 entry not wired (HOLD, Owner deciding per-Piggy-card placement): addMoneyEntryMarkup renders only Add money; sendPiggyEntryMarkup stays defined, uncalled; no first-level Apple Pay label", async () => {
  const HP = await import("../src/home-paper.js");
  const html = HP.addMoneyEntryMarkup();
  assert.ok(html.includes('id="homeAddMoney"')); assert.equal(html.includes("homeSendPiggy"), false, "HOLD: not rendered in MY MONEY");
  // pre-A-905 baseline: sendPiggyEntryMarkup stayed defined (uncalled) with setSendPiggyGate. A-905 removed both; the honey jar -> Money tab replaces the entries.
  assert.equal(HP.sendPiggyEntryMarkup, undefined); assert.equal(HP.setSendPiggyGate, undefined);
  const MAIN = SRC("main.js");
  // pre-A-905 baseline: MAIN.includes('const addMoneyEntry = addMoneyEntryAllowed() ? addMoneyEntryMarkup() : "";') — the line is now empty (jar -> Money tab).
  assert.ok(MAIN.includes('const addMoneyEntry = ""; // [A-905]'), "A-905 line");
  assert.equal(MAIN.includes("setSendPiggyGate"), false, "gate wiring reverted (HOLD)");
  assert.equal(SRC("home-paper.js").includes("Apple Pay"), false, "no first-level Apple Pay label (P5)");
});
await check("R2 an empty value prints nothing, never a bare $ (product config: no market)", () => {
  const d = mk(20);
  const e = ev(d, { holdings: { usdc: "8", mon: "10" }, market: null });
  const html = G.giftSendPaperMarkup(G.giftSendView(d, e));
  assert.equal(/>\s*\$\s*</.test(html), false, "no bare $");
  assert.equal(/unknown/.test(html), false, "no 'unknown' word");
  assert.ok(html.includes("10 MON"));
  const none = G.giftSendPaperMarkup(G.giftSendView(d, { ...e, balanceUsd: null }));
  assert.equal(/>\s*\$\s*</.test(none), false);
});
await check("R3 refusals use the existing grammar `nothing moved.`; Try again only after a failure", async () => {
  let d = G.giftSendReduce(mk(20), { type: "faceid_start", lock: G.lockQuote(ev(mk(20), { market: MARKET(), gas: GAS }), { nowMs: NOW }) });
  d = G.giftSendReduce(d, { type: "faceid_result", ok: false });
  const v = G.giftSendView(d, ev(d));
  assert.equal(v.notice, "nothing moved.");
  assert.ok(G.giftSendPaperMarkup(v).includes("nothing moved."));
  assert.equal(G.giftSendView(mk(20), ev(mk(20))).notice, null);
  assert.equal(G.giftSendView(G.giftSendReduce(mk(), { type: "set_preset", preset: 25 }), ev(mk())).notice, null, "an unsupported amount is not a money refusal");
  let p = FPm.fundingPaperReduce(FPm.openFundingPaper({ piggy: PAYER, chainId: "monad-mainnet" }).paper, { type: "choose_row", row: "crypto" });
  assert.equal(FPm.fundingPaperMarkup(FPm.fundingPaperView(p, { canCheck: true })).includes("Try again"), false, "no Try again before a failure");
  p = FPm.fundingPaperReduce(p, { type: "arrival", result: { status: "failed" } });
  assert.ok(FPm.fundingPaperMarkup(FPm.fundingPaperView(p, { canCheck: true })).includes("Try again"));
  assert.ok(FPm.fundingPaperMarkup(FPm.fundingPaperView(p, { canCheck: true })).includes("nothing moved."));
  const retry = FPm.fundingPaperReduce(p, { type: "arrival", result: { status: "confirmed", chain: "monad-mainnet", asset: "USDC", target: PAYER.address, amount: "5", txHash: "0x1" } });
  assert.equal(retry.stage, "confirmed", "a failed paper can be re-checked");
  const refused = { ...FPm.openFundingPaper({ piggy: PAYER, chainId: "monad-mainnet" }).paper, refusal: "funding_target_unproven" };
  assert.ok(FPm.fundingPaperMarkup(FPm.fundingPaperView(refused)).includes("nothing moved."));
});
await check("R4 draft snapshot / restore: same payer + chain scope only, editable fields only", () => {
  let d = mk(50);
  d = G.giftSendReduce(G.giftSendReduce(G.giftSendReduce(d, { type: "set_to", value: "Dana" }), { type: "set_message", value: "hi" }), { type: "set_from", value: "Sam" });
  const snap = G.giftDraftSnapshot(d);
  assert.ok(!JSON.stringify(snap).match(/lock|token|link|stage/), "no lock / token / link / stage in storage");
  const r = G.giftDraftRestore(JSON.parse(JSON.stringify(snap)), { piggy: PAYER, selected: PAYER, chainScope: "monad-testnet" });
  assert.equal(r.preset, 50); assert.equal(r.front, "01"); assert.equal(r.to, "Dana"); assert.equal(r.message, "hi"); assert.equal(r.from, "Sam"); assert.equal(r.stage, "compose"); assert.equal(r.flipped, false); assert.equal(r.draftId, d.draftId);
  assert.equal(G.giftDraftRestore(snap, { piggy: OTHER, selected: OTHER, chainScope: "monad-testnet" }), null, "another payer never restores");
  assert.equal(G.giftDraftRestore(snap, { piggy: PAYER, selected: PAYER, chainScope: "monad-mainnet" }), null, "another chain scope never restores");
  assert.equal(G.giftDraftRestore({ ...snap, preset: 25, front: "09" }, { piggy: PAYER, selected: PAYER, chainScope: "monad-testnet" }).preset, null, "a tampered preset is dropped");
  assert.equal(G.giftDraftRestore(null, { piggy: PAYER, selected: PAYER, chainScope: "monad-testnet" }), null);
});
await check("R5 a898FaceId always ends the signer: draft closed during the prompt, executor throws, executor ok", async () => {
  const MAIN = SRC("main.js");
  const a = MAIN.indexOf("async function a898FaceId() {"); const b = MAIN.indexOf("async function a898Act(");
  const code = MAIN.slice(a, b);
  const run = async ({ closeDuringPrompt = false, executor = null, throwSigner = false } = {}) => {
    const d = mk(20);
    const state = { giftSend: d, selectedPiggy: PAYER };
    let ended = 0;
    const ctx = {
      state, endSignerSession: () => { ended += 1; }, refreshHomePaperMount() {}, location: { origin: "https://x.test" },
      giftSendReduce: G.giftSendReduce, lockQuote: G.lockQuote, reconcileQuote: () => ({ ok: true }), planGiftSend: async () => ({ ok: true }),
      a898Evaluate: () => ev(state.giftSend || d, { market: MARKET(), gas: GAS }), a898RegistryPiggy: () => PAYER, a898RefreshMarket: async () => {},
      a898ForgetDraft() {}, GIFT_SEND_CONFIG: { executor, gas: null },
      a898SignerForPayer: async () => { if (closeDuringPrompt) state.giftSend = null; if (throwSigner) throw new Error("boom"); return { ok: true, signerAddress: PAYER.address }; },
    };
    const fn = new Function(...Object.keys(ctx), `${code}; return a898FaceId;`)(...Object.values(ctx));
    await fn();
    return { ended, state };
  };
  assert.equal((await run({ closeDuringPrompt: true })).ended, 1, "draft closed during Face ID -> no throw, signer ended");
  assert.equal((await run({ throwSigner: true })).ended, 1, "signer step throws -> ended");
  assert.equal((await run({ executor: async () => { throw new Error("x"); } })).ended, 1, "executor throws -> ended");
  const ok = await run({ executor: async () => ({ ok: true, link: "https://x.test/#g" }) });
  assert.equal(ok.ended, 1); assert.equal(ok.state.giftSend.stage, "done");
  const none = await run();
  assert.equal(none.ended, 1); assert.equal(none.state.giftSend.stage, "unavailable");
  assert.ok(/try\s*\{[\s\S]*\}\s*finally\s*\{\s*endSignerSession\(\);/.test(code));
});
await check("R6 main.js re-reads state after awaits (arrival, crypto proof) and checks the draftId on the close path", () => {
  const MAIN = SRC("main.js");
  const arr = MAIN.slice(MAIN.indexOf("async function a898FundingArrival"), MAIN.indexOf("function a898AfterFunding"));
  assert.ok(arr.includes("now.intent !== paper.intent") && arr.includes("after.intent !== paper.intent"));
  const af = MAIN.slice(MAIN.indexOf("function a898AfterFunding"), MAIN.indexOf("async function a898FaceId"));
  assert.ok(af.includes("paper.draftId !== d.draftId"));
  const act = MAIN.slice(MAIN.indexOf("async function a898Act("), MAIN.indexOf("// ── [A-898] end ──"));
  assert.ok(act.includes("const cur = state.a898Paper;") && act.includes("cur.piggy.address !== paper.piggy.address"));
});

await check("Q5 fee = total cost (Gift gas cost + route cost) as ONE number; USDC-only has no route", () => {
  const d = G.giftSendReduce(mk(20), { type: "pay_with", asset: "mon", offered: true });
  const H = { usdc: "8", mon: "10" };
  const mon = (route) => ev(d, { holdings: H, market: MARKET({ quote: { monIn: "4.1", usdOut: "12", ...(route === undefined ? {} : { routeFeeUsd: route }) } }), gas: GAS });
  assert.equal(mon("0").faceIdLine.text, "About 4.1 MON → $12 for this Gift · fee $0.08");
  assert.equal(mon("0.02").faceIdLine.text, "About 4.1 MON → $12 for this Gift · fee $0.10", "0.07293 + 0.02 = 0.09293 -> rounded UP to cents");
  assert.equal(mon("0.02").faceIdLine.parts.feeUsd, "0.10");
  const unknownRoute = mon(undefined);
  assert.equal(unknownRoute.canFaceId, false); assert.equal(unknownRoute.blockedReason, "fee_unknown"); assert.equal(unknownRoute.faceIdLine.text, null);
  assert.equal(ev(mk(20), { market: MARKET(), gas: GAS }).faceIdLine.text, "$20 for this Gift · fee $0.08", "no route on the USDC-only line");
  assert.equal(ev(mk(20), { market: MARKET(), gas: GAS }).fees.giftGasCost.usd, "0.08");
});
await check("Q7 TO + one line + FROM + front id share the ONE note channel (<=140); round trip; no new field", async () => {
  let d = mk(20);
  d = G.giftSendReduce(G.giftSendReduce(G.giftSendReduce(d, { type: "set_to", value: "Dana" }), { type: "set_message", value: "happy\nbirthday" }), { type: "set_from", value: "Sam" });
  assert.equal(d.message, "happy birthday", "newlines collapse to a space");
  const note = G.packGiftNote(d);
  assert.equal(note, "01\nDana\nhappy birthday\nSam");
  assert.deepEqual(G.unpackGiftNote(note), { front: "01", to: "Dana", message: "happy birthday", from: "Sam" });
  assert.equal(G.packGiftNote({ ...d, front: null }), null, "no front, no note");
  // budget: the three fields together never exceed 140 - 5
  let big = G.giftSendReduce(mk(20), { type: "set_to", value: "t".repeat(80) });
  big = G.giftSendReduce(big, { type: "set_message", value: "m".repeat(140) });
  big = G.giftSendReduce(big, { type: "set_from", value: "f".repeat(40) });
  assert.ok(big.to.length + big.message.length + big.from.length <= 135);
  assert.ok(G.packGiftNote(big).length <= 140);
  const plan = await G.planGiftSend({ draft: d, senderAddress: PAYER.address, expiry: 1_900_000_000, gas: GAS, origin: "https://example.test" });
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.record.note, note, "the packed note rides the existing note channel");
  assert.deepEqual(Object.keys(plan.escrowCreateArgs).sort(), ["amount", "claimTokenHash", "expiry", "giftId", "token"], "no new chain / contract field");
  assert.equal((await G.planGiftSend({ draft: { ...d, front: null }, senderAddress: PAYER.address, expiry: 1_900_000_000 })).reason, "front_required");
});

await check("X1 explanation: one fragment table, exact strings, situations 1-6, slots only from real values, collapsed by default", () => {
  const F = G.EXPLAIN_FRAGMENTS;
  assert.equal(F.USES(), "This one uses MON."); assert.equal(F.NEED(), "Gifts are sent in USDC, a digital dollar (1 USDC ≈ $1).");
  assert.equal(F.MOVES(), "MON price can move."); assert.equal(F.MAY_DIFFER(), "Prices move, so the final amount can be a little different.");
  assert.equal(F.WAIT(), "We'll show it here once it arrives."); assert.equal(F.COSTLY(), "Sending costs more than usual right now."); assert.equal(F.SLOW(), "It's taking longer than usual right now.");
  assert.equal(F.HAVE({ have: "4.1" }), "You have 4.1 MON."); assert.equal(F.CHANGE({ mon: "4.1", usd: "12" }), "We'll turn about 4.1 MON into $12 for this Gift.");
  assert.equal(F.FEE({ fee: "0.08" }), "Sending costs about $0.08. You pay this."); assert.equal(F.MOVE_FEE({ fee: "0.08" }), "Moving it here costs about $0.08.");
  assert.equal(F.FROM({ place: "Base" }), "This money is coming in from somewhere else (Base).");
  assert.deepEqual(G.assembleExplanation(1, { mon: "4.1", usd: "12" }), ["This one uses MON.", "Gifts are sent in USDC, a digital dollar (1 USDC ≈ $1).", "We'll turn about 4.1 MON into $12 for this Gift.", "MON price can move.", "Prices move, so the final amount can be a little different."]);
  assert.deepEqual(G.assembleExplanation(2, { have: "4.1" }), ["You have 4.1 MON.", "MON price can move."]);
  assert.deepEqual(G.assembleExplanation(3, {}), ["MON price can move.", "We'll show it here once it arrives."]);
  assert.deepEqual(G.assembleExplanation(4, { place: "Base", fee: "0.5", mon: "1", usd: "3" }), ["This money is coming in from somewhere else (Base).", "Moving it here costs about $0.5.", "We'll turn about 1 MON into $3 for this Gift.", "We'll show it here once it arrives."]);
  assert.deepEqual(G.assembleExplanation(5, { costly: true, fee: "0.3" }), ["Sending costs more than usual right now.", "Sending costs about $0.3. You pay this."]);
  assert.deepEqual(G.assembleExplanation(5, { slow: true, fee: "0.3" }), ["It's taking longer than usual right now.", "Sending costs about $0.3. You pay this."]);
  assert.deepEqual(G.assembleExplanation(6, { mon: "1", usd: "1" }), [], "USDC direct: no explanation");
  // a missing slot omits the fragment, never invents a number
  assert.deepEqual(G.assembleExplanation(1, {}), ["This one uses MON.", "Gifts are sent in USDC, a digital dollar (1 USDC ≈ $1).", "MON price can move.", "Prices move, so the final amount can be a little different."]);
  assert.deepEqual(G.assembleExplanation(2, {}), ["MON price can move."]);
  // view: collapsed by default; expanded only on the exact MON line; nothing on USDC direct
  let d = G.giftSendReduce(mk(20), { type: "pay_with", asset: "mon", offered: true });
  const e = ev(d, { holdings: { usdc: "8", mon: "10" }, market: MARKET({ quote: { monIn: "4.1", routeFeeUsd: "0", usdOut: "12" } }), gas: GAS });
  assert.deepEqual(G.giftSendView(d, e).explain, { open: false, lines: [] });
  assert.equal(G.giftSendPaperMarkup(G.giftSendView(d, e)).includes("data-a898-explain"), false);
  d = G.giftSendReduce(d, { type: "toggle_explain" });
  const v = G.giftSendView(d, e);
  assert.equal(v.explain.open, true); assert.equal(v.explain.lines.length, 5);
  assert.ok(G.giftSendPaperMarkup(v).includes("We&#39;ll turn") || G.giftSendPaperMarkup(v).includes("We'll turn about 4.1 MON into $12"));
  const usdc = G.giftSendReduce(G.giftSendReduce(mk(20), { type: "toggle_explain" }), { type: "toggle_explain" });
  assert.deepEqual(G.giftSendView(G.giftSendReduce(mk(20), { type: "toggle_explain" }), ev(mk(20), { market: MARKET(), gas: GAS })).explain.lines, []);
  void usdc;
});
await check("X2 one fee number on screen: the gas-only row is blank when the Face ID line already carries a different total", () => {
  let d = G.giftSendReduce(mk(20), { type: "pay_with", asset: "mon", offered: true });
  const e = ev(d, { holdings: { usdc: "8", mon: "10" }, market: MARKET({ quote: { monIn: "4.1", routeFeeUsd: "0.02", usdOut: "12" } }), gas: GAS });
  const html = G.giftSendPaperMarkup(G.giftSendView(d, e));
  assert.ok(html.includes("fee $0.10"));
  assert.equal(/<dt>Gift gas cost<\/dt><dd>\$0\.08/.test(html), false);
  assert.ok(html.includes("<dt>Gift gas cost</dt><dd></dd>"));
  const same = G.giftSendPaperMarkup(G.giftSendView(mk(20), ev(mk(20), { market: MARKET(), gas: GAS })));
  assert.ok(same.includes("<dt>Gift gas cost</dt><dd>$0.08</dd>"), "USDC-only: total == gas, so the row agrees");
});
await check("X3 requote has a way out (Try again, existing copy); step_back flips to the front then back to the fan", () => {
  let d = G.giftSendReduce(mk(20), { type: "faceid_start", lock: G.lockQuote(ev(mk(20), { market: MARKET(), gas: GAS }), { nowMs: NOW }) });
  d = G.giftSendReduce(G.giftSendReduce(d, { type: "faceid_result", ok: true, signerAddress: PAYER.address }), { type: "executed", result: { ok: false, reason: "requote_needed" } });
  assert.equal(d.stage, "requote");
  const html = G.giftSendPaperMarkup(G.giftSendView(d, ev(d)));
  assert.ok(html.includes('data-a898-act="gift-requote"') && html.includes("Try again"));
  const back = G.giftSendReduce(d, { type: "requote" });
  assert.equal(back.stage, "compose"); assert.equal(back.preset, 20); assert.equal(back.lock, null);
  let c = G.giftSendReduce(G.giftSendReduce(mk(20), { type: "tap_front", front: "02" }), { type: "flip_front" });
  c = G.giftSendReduce(c, { type: "step_back" });
  assert.equal(c.front, "02"); assert.equal(c.flipped, false, "first step: the front of the same card");
  c = G.giftSendReduce(c, { type: "step_back" });
  assert.equal(c.front, null, "second step: back to the fan");
});
await check("X4 restore applies the combined 135 budget (a hand-edited snapshot can't pass Face ID then fail to pack)", () => {
  const snap = { v: 1, draftId: "d", payerId: PAYER.id, payerAddress: PAYER.address, chainScope: "monad-testnet", preset: 20, front: "01", to: "t".repeat(80), message: "m".repeat(140), from: "f".repeat(40) };
  const r = G.giftDraftRestore(snap, { piggy: PAYER, selected: PAYER, chainScope: "monad-testnet" });
  assert.ok(r.to.length + r.message.length + r.from.length <= 135);
  assert.notEqual(G.packGiftNote(r), null);
});
await check("X5 address copy is an icon: no on-screen text, aria copy / copied, gold check path, reset event", () => {
  let p = FPm.fundingPaperReduce(FPm.openFundingPaper({ piggy: PAYER, chainId: "monad-mainnet" }).paper, { type: "choose_row", row: "crypto" });
  let html = FPm.fundingPaperMarkup(FPm.fundingPaperView(p));
  assert.ok(/<button class="a898-copy"[^>]*data-a898-act="funding-copy"[^>]*data-copied="0"[^>]*aria-label="copy"><svg/.test(html));
  assert.equal(/>copy</.test(html), false, "no text label");
  assert.ok(html.includes("feTurbulence") && html.includes('stroke="#E0B100"') && html.includes('stroke-linecap="round"'));
  p = FPm.fundingPaperReduce(p, { type: "copied" });
  assert.ok(/data-copied="1"[^>]*aria-label="copied"/.test(FPm.fundingPaperMarkup(FPm.fundingPaperView(p))));
  p = FPm.fundingPaperReduce(p, { type: "copy_reset" });
  assert.ok(/data-copied="0"[^>]*aria-label="copy"/.test(FPm.fundingPaperMarkup(FPm.fundingPaperView(p))));
  const MAIN = SRC("main.js");
  assert.ok(MAIN.includes("}, 1500);") && MAIN.includes('"copy_reset"'));
  assert.equal(/#b3261e/i.test(SRC("style.css")), false, "error red is the brand brick #8C3A2E only");
});
await check("X6 main.js: Face ID repaints on every exit; requote hook wired", () => {
  const MAIN = SRC("main.js");
  const f = MAIN.slice(MAIN.indexOf("async function a898FaceId() {"), MAIN.indexOf("async function a898Act("));
  assert.ok(/finally\s*\{\s*endSignerSession\(\);\s*refreshHomePaperMount\(\);/.test(f));
  assert.ok(MAIN.includes('act === "gift-requote"'));
});
await check("E3 main.js: Send a Piggy is wired from the selected Piggy only, payer/selection re-checked before Face ID", () => {
  const MAIN = SRC("main.js");
  const b = MAIN.slice(MAIN.indexOf("// ── [A-898] Funding Paper"), MAIN.indexOf("// ── [A-898] end ──"));
  assert.ok(b.includes("openGiftSend({ piggy, selected: state.selectedPiggy"));
  assert.ok(b.includes("state.selectedPiggy.id !== d0.payer.id"));
  assert.ok(/async function a898FaceId[\s\S]*lockQuote\(ev0\)[\s\S]*a898SignerForPayer\(piggy, \{ fresh: true \}\)[\s\S]*faceid_result/.test(b)); // [A-1298] Face ID every Gift Send
  assert.ok(b.includes("GIFT_SEND_CONFIG.executor") && b.includes("reconcileQuote(lock"));
  assert.ok(b.includes("#homeSendPiggy") === false && MAIN.includes('closest("#homeSendPiggy")'));
  assert.equal(/\*\//.test(b), false);
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
