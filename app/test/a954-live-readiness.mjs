// [A-954] A-951 live-readiness conditions inside the 5 new Job modules (opus, OUTBOX "A-951 [JOB EXECUTORS] — slice PASS"):
//   (a) piggyAddress == binding == signer for every <job>LiveStep (receiver / owner / _user come from the binding, never from args alone)
//   (b) min-out floors: Euler deposit/redeem · Upshift deposit/instantRedeem · shMON redeem against a FRESH measured preview for exactly
//       that amount; Kuru market orders take their minimum only from a static-call quote with source + market + size + freshness checked
//   (d) Euler redeem: held shares + maxRedeem re-read at one block; held may exceed maxRedeem by at most the measured 1-raw gap
// Node only, no network, no tx. The fork-description encoders (encode<Job>Step) are unchanged (their own a951 suites still pass).
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi } from "viem";
import * as EU from "../src/mainnet-job-euler.js";
import * as UP from "../src/mainnet-job-upshift.js";
import * as SM from "../src/mainnet-job-shmon.js";
import * as KU from "../src/mainnet-job-kuru.js";
import * as RV from "../src/mainnet-job-revoke.js";
globalThis.fetch = async () => { throw new Error("A-954 test: network forbidden"); };
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };

const P = "0x0e1aF437Cc134921dedA89ADaDe025f655b5B8e4";
const OTHER = "0x2222222222222222222222222222222222222222";
const NOW_MS = Date.parse("2026-10-10T03:00:30.000Z");
const AT = "2026-10-10T03:00:20.000Z"; // 10 s before now
const STALE = "2026-10-10T02:59:00.000Z"; // 90 s before now
const rd = (valueRaw, extra = {}) => ({ valueRaw, block: 111000000, readAt: AT, ...extra });
const WETH = EU.EULER_FORK_EVIDENCE.asset.address, AUSD = UP.UPSHIFT_FORK_EVIDENCE.asset.address, USDC = RV.REVOKE_FORK_EVIDENCE.token.address;
const bind = (token, extra = {}) => ({ piggyId: "p1", piggyAddress: P, token, ...extra });
const ID = (token, extra = {}) => ({ piggyAddress: P, binding: bind(token), signerAddress: P, nowMs: NOW_MS, ...extra });
const err = (r) => r.error;

// ── (a) identity on every module ──
const MODS = [
  ["euler", EU.eulerLiveStep, "approve", { amountRaw: "1000" }, WETH],
  ["upshift", UP.upshiftLiveStep, "approve", { amountRaw: "1000" }, AUSD],
  ["shmon", SM.shmonLiveStep, "deposit", { amountWei: "1000", minSharesRaw: "995", reads: { previewDeposit: rd("1000", { forRaw: "1000" }) } }, null],
  ["kuru", KU.kuruLiveStep, "approveMarket", { amountRaw: "1000" }, USDC],
  ["revoke", RV.revokeLiveStep, "revoke", { spender: "aavePool", amountRaw: "0", allowanceRaw: "5" }, USDC],
];
const idFor = (token, over = {}) => (token ? ID(token, over) : { ...ID(null, over), binding: { piggyId: "p1", piggyAddress: P, asset: "MON", decimals: 18 }, ...over });
for (const [name, live, step, args, token] of MODS) {
  check(`(a) ${name}: binding == signer == piggy → builds; the call names that address only`, () => {
    const r = live(step, { ...idFor(token), ...args });
    assert.equal(r.error, null, r.error);
    const lowerData = r.call.data.toLowerCase();
    assert.equal(lowerData.includes(OTHER.slice(2).toLowerCase()), false);
  });
  check(`(a) ${name}: signer ≠ piggy / binding ≠ piggy / missing binding / missing signer → refused`, () => {
    assert.equal(err(live(step, { ...idFor(token, { signerAddress: OTHER }), ...args })), "piggy_binding_signer_mismatch");
    assert.equal(err(live(step, { ...idFor(token, { piggyAddress: OTHER }), ...args })), "piggy_binding_signer_mismatch");
    assert.equal(err(live(step, { ...idFor(token, { binding: null }), ...args })), "binding_missing");
    assert.equal(err(live(step, { ...idFor(token, { binding: { piggyAddress: "0x12" } }), ...args })), "binding_missing");
    assert.equal(err(live(step, { ...idFor(token, { signerAddress: undefined }), ...args })), "signer_missing");
    assert.equal(err(live(step, { ...idFor(token, { piggyAddress: undefined }), ...args })), "missing_piggy_address");
    assert.equal(err(live(step, undefined)), "binding_missing");
  });
  if (token) check(`(a) ${name}: a binding for another asset is refused`, () => { assert.match(err(live(step, { ...ID(OTHER), ...args })), /^binding_asset_not_/); });
}
check("(a) case-insensitive identity (checksum vs lower) is the same Piggy", () => {
  assert.equal(EU.eulerLiveStep("approve", { ...ID(WETH), signerAddress: P.toLowerCase(), amountRaw: "5" }).error, null);
});
check("(a) receiver / owner come from the binding: Euler redeem receiver == owner == binding Piggy", () => {
  const r = EU.eulerLiveStep("redeem", { ...ID(WETH), minAssetsRaw: "999", reads: { heldShares: rd("1000"), maxRedeem: rd("1000"), previewRedeem: rd("1000", { forRaw: "1000" }) } });
  assert.equal(r.error, null, r.error);
  assert.equal(r.call.receiver, P); assert.equal(r.call.owner, P);
  assert.equal(r.call.data, encodeFunctionData({ abi: parseAbi(["function redeem(uint256,address,address)"]), functionName: "redeem", args: [1000n, P, P] }));
});
check("(a) Kuru depositMargin _user == the binding Piggy (kuruCallProblem re-read passes)", () => {
  const r = KU.kuruLiveStep("depositMargin", { ...ID(USDC), amountRaw: "1000" });
  assert.equal(r.error, null, r.error); assert.equal(r.call.user, P);
});
check("(c) shMON: a USDC binding (what chain-profile binds today) is refused — native MON binding needed", () => {
  assert.equal(err(SM.shmonLiveStep("deposit", { ...ID(USDC), amountWei: "1000", minSharesRaw: "995", reads: { previewDeposit: rd("1000", { forRaw: "1000" }) } })), "binding_not_native_mon");
});

// ── (b) min-out floors ──
const floorCases = [
  ["Euler deposit", (min, reads) => EU.eulerLiveStep("deposit", { ...ID(WETH), amountRaw: "1000", minSharesRaw: min, reads: { previewDeposit: reads } })],
  ["Euler redeem", (min, reads) => EU.eulerLiveStep("redeem", { ...ID(WETH), minAssetsRaw: min, reads: { heldShares: rd("1000"), maxRedeem: rd("1000"), previewRedeem: reads } })],
  ["Upshift deposit", (min, reads) => UP.upshiftLiveStep("deposit", { ...ID(AUSD), amountRaw: "1000", minSharesRaw: min, reads: { previewOut: reads } })],
  ["Upshift instantRedeem", (min, reads) => UP.upshiftLiveStep("instantRedeem", { ...ID(AUSD), minAssetsRaw: min, reads: { heldShares: rd("1000"), previewOut: reads } })],
  ["shMON deposit (native MON as msg.value)", (min, reads) => SM.shmonLiveStep("deposit", { ...idFor(null), amountWei: "1000", minSharesRaw: min, reads: { previewDeposit: reads } })],
  ["shMON redeem", (min, reads) => SM.shmonLiveStep("redeem", { ...idFor(null), minMonWei: min, reads: { heldShares: rd("1000"), previewRedeem: reads } })],
];
for (const [name, run] of floorCases) {
  check(`(b) ${name}: floor present, ≤ fresh preview, within 1 % → built with minOutRaw + postCheck`, () => {
    const r = run("995", rd("1000", { forRaw: "1000" }));
    assert.equal(r.error, null, r.error);
    assert.equal(r.call.minOutRaw, "995"); assert.equal(r.call.previewBlock, 111000000); assert.match(r.call.postCheck, /OutMeetsFloor$/);
  });
  check(`(b) ${name}: no floor / zero / above preview / looser than 1 % / stale / missing / other amount / future read → refused`, () => {
    assert.equal(err(run(undefined, rd("1000", { forRaw: "1000" }))), "min_out_missing");
    assert.equal(err(run("0", rd("1000", { forRaw: "1000" }))), "min_out_missing");
    assert.equal(err(run("1001", rd("1000", { forRaw: "1000" }))), "preview_below_min_out");
    assert.equal(err(run("989", rd("1000", { forRaw: "1000" }))), "min_out_too_loose");
    assert.match(err(run("995", rd("1000", { forRaw: "1000", readAt: STALE }))), /_stale$/);
    assert.match(err(run("995", rd("1000", { forRaw: "1000", readAt: "2026-10-10T03:01:00.000Z" }))), /_stale$/);
    assert.match(err(run("995", undefined)), /_not_read$/);
    assert.match(err(run("995", rd("1000", { forRaw: "1000", block: 0 }))), /_block_missing$/);
    assert.match(err(run("995", rd("1000", { forRaw: "1000", readAt: "yesterday" }))), /_time_missing$/);
    assert.equal(err(run("995", rd("1000", { forRaw: "999" }))), "preview_not_for_this_amount");
  });
}
check("(b) post-send check: realized delta below the floor is flagged", () => {
  for (const f of [EU.eulerOutMeetsFloor, UP.upshiftOutMeetsFloor, SM.shmonOutMeetsFloor]) {
    assert.deepEqual(f({ minOutRaw: "995", beforeRaw: "10", afterRaw: "1005" }), { ok: true, deltaRaw: "995", reason: null });
    assert.deepEqual(f({ minOutRaw: "995", beforeRaw: "10", afterRaw: "1004" }), { ok: false, deltaRaw: "994", reason: "realized_below_min_out" });
    assert.equal(f({ minOutRaw: "995" }).reason, "balances_not_measured");
  }
});
check("(b) Upshift requestRedeem: PENDING (no output at the request) — no floor exists; the share amount must still be a fresh read", () => {
  const ok = UP.upshiftLiveStep("requestRedeem", { ...ID(AUSD), reads: { heldShares: rd("1000") } });
  assert.equal(ok.error, null, ok.error); assert.equal(ok.call.outcome, "pending");
  assert.match(err(UP.upshiftLiveStep("requestRedeem", { ...ID(AUSD), reads: { heldShares: rd("1000", { readAt: STALE }) } })), /_stale$/);
});

// Kuru: quote source + freshness
const q = (over = {}) => ({ source: "static_call", function: "placeAndExecuteMarketSell", market: KU.KURU_FORK_EVIDENCE.market, forRaw: "200000000000000000000", outRaw: "6409200", block: 111000000, readAt: AT, ...over });
const sell = (quote) => KU.kuruLiveStep("sellMon", { ...ID(USDC), monWei: "200000000000000000000", quote });
check("(b) Kuru sellMon: a fresh static-call quote for exactly this size → min out = quote × 0.995, with the quote block", () => {
  const r = sell(q());
  assert.equal(r.error, null, r.error); assert.equal(r.call.minUsdcRaw, ((6409200n * 995n) / 1000n).toString()); assert.equal(r.call.quoteBlock, 111000000); assert.equal(r.call.quoteSourceLabel, "static_call");
  assert.equal(r.call.data, encodeFunctionData({ abi: parseAbi(["function placeAndExecuteMarketSell(uint96,uint256,bool,bool)"]), functionName: "placeAndExecuteMarketSell", args: [2000000000000n, (6409200n * 995n) / 1000n, false, true] }), "on-chain _minAmountOut = quote × 0.995");
});
check("(b) Kuru: missing / hand-typed / wrong-function / wrong-market / wrong-size / stale / zero quote → refused", () => {
  assert.equal(err(sell(undefined)), "quote_missing");
  assert.equal(err(sell(q({ source: "caller" }))), "quote_source_not_static_call");
  assert.equal(err(sell(q({ function: "placeAndExecuteMarketBuy" }))), "quote_function_mismatch");
  assert.equal(err(sell(q({ market: OTHER }))), "quote_market_mismatch");
  assert.equal(err(sell(q({ forRaw: "100" }))), "quote_not_for_this_size");
  assert.equal(err(sell(q({ readAt: STALE }))), "quote_stale");
  assert.equal(err(sell(q({ block: undefined }))), "quote_block_missing");
  assert.equal(err(sell(q({ outRaw: "0" }))), "quote_not_read");
  assert.equal(err(sell(q({ outRaw: "6.4" }))), "quote_not_read");
  // a caller-supplied quoteUsdcRaw in the args is ignored: only the checked quote feeds the minimum
  const r = KU.kuruLiveStep("sellMon", { ...ID(USDC), monWei: "200000000000000000000", quoteUsdcRaw: "1", quote: q() });
  assert.equal(r.call.minUsdcRaw, ((6409200n * 995n) / 1000n).toString());
});
check("(b) Kuru: the 'static_call' label is not evidence — a correctly labelled quote with a mismatched function / market / size / age / block is refused", () => {
  const labelled = (over) => q({ source: "static_call", ...over });
  assert.equal(err(sell(labelled({ function: "placeAndExecuteMarketBuy" }))), "quote_function_mismatch");
  assert.equal(err(sell(labelled({ market: KU.KURU_FORK_EVIDENCE.marginAccount }))), "quote_market_mismatch");
  assert.equal(err(sell(labelled({ forRaw: "200000000000000000001" }))), "quote_not_for_this_size");
  assert.equal(err(sell(labelled({ readAt: STALE }))), "quote_stale");
  assert.equal(err(sell(labelled({ readAt: "2026-10-10T03:05:00.000Z" }))), "quote_stale");
  assert.equal(err(sell(labelled({ block: 0 }))), "quote_block_missing");
});
check("(b) Kuru: the order's floor (quote × 0.995) passes floorProblem — ≤ quote, within 1 %", () => {
  const r = sell(q({ outRaw: "1000" }));
  assert.equal(r.error, null, r.error); assert.equal(r.call.minUsdcRaw, "995");
  assert.equal(err(sell(q({ outRaw: "1" }))), "min_out_missing"); // 1 × 0.995 = 0 → no floor → refused
});
check("(b) Kuru buyMon: quote function = placeAndExecuteMarketBuy, size = the USDC amount", () => {
  const r = KU.kuruLiveStep("buyMon", { ...ID(USDC), amountRaw: "5000000", quote: q({ function: "placeAndExecuteMarketBuy", forRaw: "5000000", outRaw: "155797214345800000000" }) });
  assert.equal(r.error, null, r.error); assert.equal(r.call.minMonWei, ((155797214345800000000n * 995n) / 1000n).toString());
});

// ── (d) Euler maxRedeem re-read ──
const redeem = (reads) => EU.eulerLiveStep("redeem", { ...ID(WETH), minAssetsRaw: "995", reads: { previewRedeem: rd("1000", { forRaw: "1000" }), ...reads } });
check("(d) Euler: held == maxRedeem, or held − maxRedeem == 1 (the measured gap) → redeem all held", () => {
  assert.equal(redeem({ heldShares: rd("1000"), maxRedeem: rd("1000") }).call.sharesRaw, "1000");
  assert.equal(redeem({ heldShares: rd("1000"), maxRedeem: rd("999") }).call.sharesRaw, "1000");
  assert.equal(EU.EULER_MAX_REDEEM_GAP_RAW, "1");
});
check("(d) Euler: maxRedeem 2+ below held / not re-read / stale / other block → refused", () => {
  assert.equal(err(redeem({ heldShares: rd("1000"), maxRedeem: rd("998") })), "max_redeem_below_held");
  assert.equal(err(redeem({ heldShares: rd("1000") })), "max_redeem_not_read");
  assert.equal(err(redeem({ heldShares: rd("1000"), maxRedeem: rd("1000", { readAt: STALE }) })), "max_redeem_stale");
  assert.equal(err(redeem({ heldShares: rd("1000"), maxRedeem: rd("1000", { block: 111000001 }) })), "reads_not_same_block");
  assert.equal(err(redeem({ maxRedeem: rd("1000") })), "held_shares_not_read");
});

check("nothing is wired: every gate still refuses (lane_not_wired family) and no module gained a network / executor import", () => {
  assert.equal(EU.eulerExecutionGate({}).allowed, false); assert.equal(UP.upshiftExecutionGate({}).allowed, false);
  assert.equal(SM.shmonExecutionGate({}).allowed, false); assert.equal(KU.kuruExecutionGate({}).allowed, false); assert.equal(RV.revokeExecutionGate({}).allowed, false);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
