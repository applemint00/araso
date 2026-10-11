// [A-951 B2] Kuru executor model (mainnet-job-kuru.js): calldata byte-equal to the lane-B fork harness encoding (market sell, market buy,
// limit place, cancel), constants = the run record, the gate never allows, readiness never ready, pinned targets / caps / own-order cancel
// refusals. Node only, no network, no tx.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, toEventSelector } from "viem";
import * as K from "../src/mainnet-job-kuru.js";
import { privatePath, PRIVATE_RE } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-951 test: network forbidden"); };
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIGGY = "0xb701520e24343cbd399a6d7bbd2a5634a7c542e6"; // the harness USER fixture, lowercase
const OTHER = "0x024b1756906435a5eae53bb84dc8a8fb37c4d450"; // the harness CALLER fixture (non-owner)
// The harness's own ABI strings (a787-laneB-run.mjs :24 · :26-30 · :35), copied verbatim — encoding with these is the harness encoding.
const H_ERC20 = parseAbi(["function approve(address,uint256) returns (bool)"]);
const H_OB = parseAbi([
  "function addBuyOrder(uint32 _price,uint96 size,bool _postOnly)",
  "function batchCancelOrders(uint40[] _orderIds)",
  "function placeAndExecuteMarketBuy(uint96 _quoteSize,uint256 _minAmountOut,bool _isMargin,bool _isFillOrKill) payable returns (uint256)",
  "function placeAndExecuteMarketSell(uint96 _size,uint256 _minAmountOut,bool _isMargin,bool _isFillOrKill) payable returns (uint256)",
]);
const H_MA = parseAbi(["function deposit(address _user,address _token,uint256 _amount) payable", "function withdraw(uint256 _amount,address _token)"]);
const E = K.KURU_FORK_EVIDENCE;
const MARKET = E.market, MARGIN = E.marginAccount, USDC = E.usdc.address, ROUTER = E.router;
const call = (step, args) => { const r = K.encodeKuruStep(step, { piggyAddress: PIGGY, ...args }); assert.equal(r.error, null, r.error); return r.call; };
const orderLog = (owner, orderId = 119614971n, address = MARKET) => ({
  address,
  topics: [toEventSelector("OrderCreated(uint40,address,uint96,uint32,bool)")],
  data: encodeAbiParameters(parseAbiParameters("uint40,address,uint96,uint32,bool"), [orderId, owner, 2000000000000n, 3172500, true]),
});

// (a) calldata byte-equal to the harness
check("sell native MON == harness placeAndExecuteMarketSell(2e12, quote×995/1000, false, true) value 200 MON", () => {
  const c = call("sellMon", { monWei: E.sell.monWei, quoteUsdcRaw: E.sell.quoteUsdcRaw });
  assert.equal(c.to, MARKET); assert.equal(c.value, "200000000000000000000"); assert.equal(c.minUsdcRaw, "6377154");
  assert.equal(c.data, encodeFunctionData({ abi: H_OB, functionName: "placeAndExecuteMarketSell", args: [2000000000000n, (6409200n * 995n) / 1000n, false, true] }));
  assert.equal(c.data.slice(0, 10), "0x532c46db");
});
check("buy MON with 5 USDC == harness placeAndExecuteMarketBuy(5×PP, quote×995/1000, false, true)", () => {
  const c = call("buyMon", { amountRaw: "5000000", quoteMonWei: E.buy.quoteMonWei });
  assert.equal(c.to, MARKET); assert.equal(c.value, "0"); assert.equal(c.quoteSizePP, "500000000");
  assert.equal(c.data, encodeFunctionData({ abi: H_OB, functionName: "placeAndExecuteMarketBuy", args: [5n * 100000000n, (155797214345800000000n * 995n) / 1000n, false, true] }));
  assert.equal(c.data.slice(0, 10), "0x7c51d6cf");
});
check("limit place == harness addBuyOrder(floor(bid×PP/1e18×0.99 / tick)×tick, minSize, post-only) = (3172500, 2e12, true)", () => {
  const c = call("placeLimit", { bestBidRaw: E.bestBidAskAtPin.bid, sizeRaw: E.marketParams.minSize, marginBalanceRaw: E.limit.depositRaw });
  const bidP = (32046000000000000n * 100000000n) / 10n ** 18n; const px = ((bidP * 99n / 100n) / 100n) * 100n;
  assert.equal(px, 3172500n); assert.equal(c.priceUnitsPP, "3172500"); assert.equal(c.approxQuoteNeededRaw, "6345002");
  assert.equal(c.data, encodeFunctionData({ abi: H_OB, functionName: "addBuyOrder", args: [Number(px), 2000000000000n, true] }));
  assert.equal(c.data.slice(0, 10), "0xa09e9040");
});
check("cancel == harness batchCancelOrders([orderId from own OrderCreated])", () => {
  const { order, error } = K.kuruOrderFromLog(orderLog(PIGGY), PIGGY); assert.equal(error, null, error);
  assert.equal(order.orderId, "119614971");
  const c = call("cancelLimit", { order });
  assert.equal(c.to, MARKET);
  assert.equal(c.data, encodeFunctionData({ abi: H_OB, functionName: "batchCancelOrders", args: [[119614971n]] }));
  assert.equal(c.data.slice(0, 10), "0x23afbff3");
});
check("margin deposit / withdraw == harness deposit(user, USDC, 8e6) / withdraw(8e6, USDC)", () => {
  assert.equal(call("depositMargin", { amountRaw: "8000000" }).data, encodeFunctionData({ abi: H_MA, functionName: "deposit", args: [PIGGY, USDC, 8000000n] }));
  assert.equal(call("withdrawMargin", { amountRaw: "8000000" }).data, encodeFunctionData({ abi: H_MA, functionName: "withdraw", args: [8000000n, USDC] }));
});
check("revokes == harness approve(market, 0) / approve(MarginAccount, 0)", () => {
  assert.equal(call("revokeMarket", {}).data, encodeFunctionData({ abi: H_ERC20, functionName: "approve", args: [MARKET, 0n] }));
  assert.equal(call("revokeMargin", {}).data, encodeFunctionData({ abi: H_ERC20, functionName: "approve", args: [MARGIN, 0n] }));
});
check("approvals are exact (harness over-approved 10 USDC on purpose; the app approves exactly the amount)", () => {
  const a = call("approveMarket", { amountRaw: "5000000" }); assert.equal(a.to, USDC);
  assert.equal(a.data, encodeFunctionData({ abi: H_ERC20, functionName: "approve", args: [MARKET, 5000000n] }));
  const m = call("approveMargin", { amountRaw: "8000000" });
  assert.equal(m.data, encodeFunctionData({ abi: H_ERC20, functionName: "approve", args: [MARGIN, 8000000n] }));
  assert.ok(!a.data.endsWith("f".repeat(64)) && !m.data.endsWith("f".repeat(64)));
  assert.equal(K.encodeKuruStep("approveMarket", { piggyAddress: PIGGY, amountRaw: "10000000" }).error, "amount_above_fork_proven_size");
});
check("sell-back carries a measured minimum (harness used 0 there; the app never sends minimum 0)", () => {
  const c = call("sellBack", { monWei: E.buy.monReceivedWei, quoteUsdcRaw: E.buy.sellBackQuoteUsdcRaw });
  assert.equal(c.sizeRaw, E.buy.sellBackSizeRaw); assert.equal(c.value, E.buy.monReceivedWei);
  assert.equal(c.data, encodeFunctionData({ abi: H_OB, functionName: "placeAndExecuteMarketSell", args: [1557972143458n, (4992677n * 995n) / 1000n, false, true] }));
});
check("every built call passes the pinned re-read", () => {
  const { order } = K.kuruOrderFromLog(orderLog(PIGGY), PIGGY);
  const built = {
    sellMon: call("sellMon", { monWei: E.sell.monWei, quoteUsdcRaw: "1000" }), approveMarket: call("approveMarket", { amountRaw: "5000000" }),
    buyMon: call("buyMon", { amountRaw: "5000000", quoteMonWei: "1000" }), revokeMarket: call("revokeMarket", {}),
    sellBack: call("sellBack", { monWei: E.buy.monReceivedWei, quoteUsdcRaw: "1000" }), approveMargin: call("approveMargin", { amountRaw: "8000000" }),
    depositMargin: call("depositMargin", { amountRaw: "8000000" }), placeLimit: call("placeLimit", { bestBidRaw: E.bestBidAskAtPin.bid, sizeRaw: "2000000000000", marginBalanceRaw: "8000000" }),
    cancelLimit: call("cancelLimit", { order }), withdrawMargin: call("withdrawMargin", { amountRaw: "8000000" }), revokeMargin: call("revokeMargin", {}),
  };
  for (const [s, c] of Object.entries(built)) assert.equal(K.kuruCallProblem(s, c, PIGGY), null, s);
});

// (b) constants = recorded values
check("selectors in the step table == viem selectors of the harness ABI", () => {
  const sel = (abi, fn, args) => encodeFunctionData({ abi, functionName: fn, args }).slice(0, 10);
  assert.equal(K.KURU_STEPS.sellMon.selector, sel(H_OB, "placeAndExecuteMarketSell", [1n, 1n, false, true]));
  assert.equal(K.KURU_STEPS.buyMon.selector, sel(H_OB, "placeAndExecuteMarketBuy", [1n, 1n, false, true]));
  assert.equal(K.KURU_STEPS.placeLimit.selector, sel(H_OB, "addBuyOrder", [1, 1n, true]));
  assert.equal(K.KURU_STEPS.cancelLimit.selector, sel(H_OB, "batchCancelOrders", [[1n]]));
  assert.equal(K.KURU_STEPS.depositMargin.selector, sel(H_MA, "deposit", [PIGGY, USDC, 1n]));
  assert.equal(K.KURU_STEPS.withdrawMargin.selector, sel(H_MA, "withdraw", [1n, USDC]));
});
const RUN = privatePath("ops/receipts/A787_second_broad_fork/laneB/raw/laneB_run.json"); // [A-1033] one root; pre-A-1033: walked up 6 parents for the repo-relative path
if (existsSync(RUN)) {
  const r = JSON.parse(readFileSync(RUN, "utf8"));
  const scn = (n) => r.scenarios.find((s) => s.scenario === n);
  check("constants == the lane-B run record (block · addresses · market params · bid/ask · code sizes)", () => {
    assert.equal(r.chainId, E.chainId); assert.equal(r.forkBlock, E.block); assert.equal(r.forkBlockTimestamp, E.blockTimestampUnix);
    assert.equal(new Date(r.forkBlockTimestamp * 1000).toISOString().replace(".000", ""), E.blockTimestamp);
    assert.equal(r.identity.market.address, MARKET); assert.equal(r.identity.margin.address, MARGIN); assert.equal(r.identity.router.address, ROUTER); assert.equal(r.identity.USDC.address, USDC);
    assert.deepEqual({ market: r.identity.market.codeBytes, marginAccount: r.identity.margin.codeBytes, router: r.identity.router.codeBytes }, { ...E.codeBytes });
    const mp = r.identity.kuruMarketParams;
    for (const k of ["pricePrecision", "sizePrecision", "baseAsset", "quoteAsset", "tickSize", "minSize", "maxSize", "takerFeeBps", "makerFeeBps"]) assert.equal(String(mp[k]), String(E.marketParams[k]), k);
    assert.equal(Number(mp.baseDecimals), E.marketParams.baseDecimals); assert.equal(Number(mp.quoteDecimals), E.marketParams.quoteDecimals);
    assert.equal(r.identity.kuruBestBidAsk_vaultPrecision1e18.bid, E.bestBidAskAtPin.bid); assert.equal(r.identity.kuruBestBidAsk_vaultPrecision1e18.ask, E.bestBidAskAtPin.ask);
    assert.equal(r.derived.bidPricePP, E.bestBidAskAtPin.bidPricePP); assert.equal(r.derived.askPricePP, E.bestBidAskAtPin.askPricePP);
  });
  check("constants == the lane-B scenario records (amounts · order · ledger · gas)", () => {
    const s = scn("kuru_market_sell_native_MON"), b = scn("kuru_market_buy_USDC_to_MON_then_sell_back_and_revoke"), l = scn("kuru_limit_buy_place_cancel_withdraw");
    for (const x of [s, b, l]) assert.equal(x.label, "PASS_FORK_SIM");
    assert.equal(s.monSoldWei, E.sell.monWei); assert.equal(s.quoteUsdcRaw, E.sell.quoteUsdcRaw); assert.equal(s.usdcReceivedRaw, E.sell.usdcReceivedRaw);
    assert.equal(b.usdcSpentRaw, E.buy.usdcRaw); assert.equal(b.buyQuoteBaseWei, E.buy.quoteMonWei); assert.equal(b.monReceivedWeiApprox, E.buy.monReceivedWei);
    assert.equal(b.sellBack.sellSizeSizePrec, E.buy.sellBackSizeRaw); assert.equal(b.sellBack.quoteRaw, E.buy.sellBackQuoteUsdcRaw); assert.equal(b.sellBack.usdcReceivedRaw, E.buy.sellBackUsdcReceivedRaw);
    assert.equal(l.priceUnits_pp, E.limit.priceUnitsPP); assert.equal(l.sizeUnits_sp, E.limit.sizeRaw); assert.equal(l.orderCreated.orderId, E.limit.orderIdAtPin);
    assert.equal(l.ledgerRaw.walletStart, E.limit.walletStartRaw); assert.equal(l.ledgerRaw.marginAfterDeposit, E.limit.depositRaw); assert.equal(l.ledgerRaw.marginAfterPlace, E.limit.marginAfterPlaceRaw);
    assert.equal(l.ledgerRaw.marginAfterCancel, E.limit.marginAfterCancelRaw); assert.equal(l.ledgerRaw.walletAfterWithdraw, E.limit.walletAfterWithdrawRaw);
    assert.equal(l.nonOwnerCancel.status, "estimate_reverted"); assert.equal(l.nonOwnerCancel.data, "0xa0cdd781");
    const g = E.gasUsed;
    assert.deepEqual([s.tx.gasUsed, b.approve.gasUsed, b.buy.gasUsed, b.revoke.gasUsed, b.sellBack.tx.gasUsed, l.approve.gasUsed, l.deposit.gasUsed, l.place.gasUsed, l.cancel.gasUsed, l.withdraw.gasUsed, l.revoke.gasUsed].map(Number),
      [g.sellMon, g.approveMarket, g.buyMon, g.revokeMarket, g.sellBack, g.approveMargin, g.depositMargin, g.placeLimit, g.cancelLimit, g.withdrawMargin, g.revokeMargin]);
  });
} else console.log("SKIP  constants vs the private lane-B run record (public checkout)");

// (c) gate refuses with live off (and with live on); readiness never ready
const liveProfile = { id: "monad-mainnet", status: "active", numericChainId: 143, scope: "monad-mainnet", jobId: K.KURU_JOB_ID, liveExecution: true, usdc: { symbol: "USDC", address: USDC, decimals: 6 } };
const forkExec = { kind: "local_fork", chainId: 143, forkBlock: 110746900, send: () => {}, receipt: () => {} };
const piggy = { id: "p", address: PIGGY };
check("gate never allows: live on refused; live off + local fork executor still refused", () => {
  assert.equal(K.kuruExecutionGate({ profile: liveProfile, piggy, executor: forkExec, step: "sellMon" }).allowed, false);
  for (const step of Object.keys(K.KURU_STEPS)) {
    const g = K.kuruExecutionGate({ profile: { ...liveProfile, liveExecution: false }, piggy, executor: forkExec, step });
    assert.equal(g.allowed, false); assert.equal(g.liveExecution, false); assert.equal(g.executionPermission, false); assert.ok(g.reason.length > 0);
  }
  assert.equal(K.kuruExecutionGate({ profile: { ...liveProfile, liveExecution: false }, piggy, executor: { ...forkExec, kind: "live" }, step: "buyMon" }).reason, "live_execution_disabled");
  assert.equal(K.kuruExecutionGate({ profile: { ...liveProfile, liveExecution: false, jobId: "curve-ausd-usdc-usdt0-lp" }, piggy, executor: forkExec, step: "buyMon" }).reason, "profile_not_kuru_lane");
});
check("readiness never ready / executable / live; fork review conditions open", () => {
  const r = K.kuruReadiness({ stage: "margin_allowance_revoked", profile: liveProfile, piggy, executor: forkExec });
  assert.equal(r.ready, false); assert.equal(r.executable, false); assert.equal(r.liveExecution, false); assert.equal(r.createsPermission, false);
  assert.ok(r.blockedBy.includes("fork_review_conditions_open")); assert.ok(r.blockedBy.includes("kuru_lane_not_wired"));
  assert.equal(K.kuruReadiness({ stage: "bogus" }).stage, "unknown");
});
check("permission request issues nothing; native MON sell not modelled", () => {
  const off = { ...liveProfile, liveExecution: false };
  const { request, error } = K.kuruPermissionRequest({ profile: off, piggy, action: K.KURU_ACTION.BUY, amountRaw: "5000000", eventId: "e1" });
  assert.equal(error, null, error); assert.equal(request.permission, null); assert.equal(request.createsPermission, false); assert.equal(request.destination, MARKET); assert.equal(request.amountDisplay, "5.000000 USDC");
  assert.equal(K.kuruPermissionRequest({ profile: off, piggy, action: K.KURU_ACTION.LIMIT, amountRaw: "8000000" }).request.destination, MARGIN);
  assert.equal(K.kuruPermissionRequest({ profile: off, piggy, action: K.KURU_ACTION.BUY, amountRaw: "5000001" }).error, "amount_above_fork_proven_size");
  assert.equal(K.kuruPermissionRequest({ profile: off, piggy, action: K.KURU_ACTION.SELL, amountRaw: "1" }).error, "native_mon_permission_not_modelled");
});

// (d) pinned targets / caps / own-order cancel
const refuse = [
  ["sellMon", { monWei: "200000000100000000000", quoteUsdcRaw: "1" }, "amount_above_fork_proven_size"],
  ["sellMon", { monWei: "150000000000000000001", quoteUsdcRaw: "1" }, "amount_not_size_aligned"],
  ["sellMon", { monWei: E.sell.monWei }, "usdc_quote_not_measured"],
  ["sellMon", { monWei: E.sell.monWei, quoteUsdcRaw: "0" }, "usdc_quote_not_measured"],
  ["sellMon", { monWei: E.sell.monWei, quoteUsdcRaw: "1" }, "usdc_quote_not_measured"],
  ["buyMon", { amountRaw: "5000001", quoteMonWei: "1" }, "amount_above_fork_proven_size"],
  ["buyMon", { amountRaw: "5000000" }, "mon_quote_not_measured"],
  ["buyMon", { amountRaw: "1.5", quoteMonWei: "1" }, "amount_not_exact"],
  ["approveMargin", { amountRaw: "8000001" }, "amount_above_fork_proven_size"],
  ["depositMargin", { amountRaw: "10000000" }, "amount_above_fork_proven_size"],
  ["withdrawMargin", { amountRaw: "0" }, "margin_not_measured"],
  ["placeLimit", { bestBidRaw: E.bestBidAskAtPin.bid, sizeRaw: "2000000000001", marginBalanceRaw: "8000000" }, "size_above_fork_proven_size"],
  ["placeLimit", { bestBidRaw: E.bestBidAskAtPin.bid, sizeRaw: "1000000000000", marginBalanceRaw: "8000000" }, "size_below_market_min"],
  ["placeLimit", { sizeRaw: "2000000000000", marginBalanceRaw: "8000000" }, "best_bid_not_measured"],
  ["placeLimit", { bestBidRaw: E.bestBidAskAtPin.bid, sizeRaw: "2000000000000", marginBalanceRaw: "6000000" }, "margin_below_order_need"],
  ["approveMarket", { amountRaw: "1", market: "0x" + "1".repeat(40) }, "market_not_fork_evidence"],
  ["depositMargin", { amountRaw: "1", marginAccount: MARKET }, "margin_account_not_fork_evidence"],
  ["approveMarket", { amountRaw: "1", token: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a" }, "token_not_fork_evidence"],
  ["buyMon", { amountRaw: "1", quoteMonWei: "1", router: ROUTER }, "router_not_on_this_lane"],
  ["limitFill", {}, "unproven_step:limitFill"],
  ["aggregatorSwap", {}, "unproven_step:aggregatorSwap"],
  ["relayCancel", {}, "unproven_step:relayCancel"],
  ["swap", {}, "unknown_step"],
];
for (const [step, args, want] of refuse) check(`refuse ${step} ${JSON.stringify(args).slice(0, 90)} → ${want}`, () => assert.equal(K.encodeKuruStep(step, { piggyAddress: PIGGY, ...args }).error, want));
check("refuse a missing / bad Piggy address", () => { assert.equal(K.encodeKuruStep("revokeMarket", {}).error, "missing_piggy_address"); assert.equal(K.encodeKuruStep("revokeMarket", { piggyAddress: ["0x" + "1".repeat(40)] }).error, "missing_piggy_address"); });
check("cancel refused for an order not created by this Piggy", () => {
  assert.equal(K.kuruOrderFromLog(orderLog(OTHER), PIGGY).error, "order_not_created_by_this_piggy");
  assert.equal(K.kuruOrderFromLog(orderLog(PIGGY, 1n, "0x" + "2".repeat(40)), PIGGY).error, "market_not_fork_evidence");
  assert.equal(K.kuruOrderFromLog({ ...orderLog(PIGGY), topics: ["0x" + "0".repeat(64)] }, PIGGY).error, "order_log_not_order_created");
  const { order: theirs } = K.kuruOrderFromLog(orderLog(OTHER), OTHER);
  assert.equal(K.encodeKuruStep("cancelLimit", { piggyAddress: PIGGY, order: theirs }).error, "order_not_created_by_this_piggy");
  assert.equal(K.encodeKuruStep("cancelLimit", { piggyAddress: PIGGY }).error, "order_not_created_by_this_piggy");
  const { order: mine } = K.kuruOrderFromLog(orderLog(PIGGY), PIGGY);
  assert.equal(K.encodeKuruStep("cancelLimit", { piggyAddress: PIGGY, order: mine, orderId: "119614972" }).error, "order_not_created_by_this_piggy");
  assert.equal(K.encodeKuruStep("cancelLimit", { piggyAddress: PIGGY, order: { ...mine, market: ROUTER } }).error, "market_not_fork_evidence");
});
check("pinned re-read refuses a wrong target / spender / token / value / zero minimum", () => {
  const buy = call("buyMon", { amountRaw: "5000000", quoteMonWei: "1000" });
  assert.equal(K.kuruCallProblem("buyMon", { ...buy, to: ROUTER }, PIGGY), "target_not_fork_evidence");
  assert.equal(K.kuruCallProblem("buyMon", { ...buy, value: "1" }, PIGGY), "value_not_allowed");
  assert.equal(K.kuruCallProblem("approveMarket", { to: USDC, value: "0", data: encodeFunctionData({ abi: H_ERC20, functionName: "approve", args: [ROUTER, 1n] }) }, PIGGY), "spender_not_fork_evidence");
  assert.equal(K.kuruCallProblem("withdrawMargin", { to: MARGIN, value: "0", data: encodeFunctionData({ abi: H_MA, functionName: "withdraw", args: [1n, "0x00000000efe302beaa2b3e6e1b18d08d69a9012a"] }) }, PIGGY), "token_not_fork_evidence");
  assert.equal(K.kuruCallProblem("depositMargin", { to: MARGIN, value: "0", data: encodeFunctionData({ abi: H_MA, functionName: "deposit", args: [OTHER, USDC, 1n] }) }, PIGGY), "deposit_not_for_this_piggy_usdc");
  assert.equal(K.kuruCallProblem("sellBack", { to: MARKET, value: E.buy.monReceivedWei, data: encodeFunctionData({ abi: H_OB, functionName: "placeAndExecuteMarketSell", args: [1557972143458n, 0n, false, true] }) }, PIGGY), "market_order_shape_not_fork_evidence");
  const sell = call("sellMon", { monWei: E.sell.monWei, quoteUsdcRaw: "1000" });
  assert.equal(K.kuruCallProblem("sellMon", { ...sell, value: "1" }, PIGGY), "value_not_size");
});
check("stage machine: only fork-proven transitions", () => {
  const walk = (steps) => { let s = K.KURU_STAGE.NONE; for (const step of steps) { const r = K.kuruStageAfter(s, step); assert.equal(r.error, null, `${step}: ${r.error}`); s = r.stage; } return s; };
  assert.equal(walk(["sellMon"]), K.KURU_STAGE.SOLD_MON);
  assert.equal(walk(["approveMarket", "buyMon", "revokeMarket", "sellBack"]), K.KURU_STAGE.SOLD_BACK);
  assert.equal(walk(["approveMargin", "depositMargin", "placeLimit", "cancelLimit", "withdrawMargin", "revokeMargin"]), K.KURU_STAGE.MARGIN_REVOKED);
  assert.equal(K.kuruStageAfter(K.KURU_STAGE.NONE, "cancelLimit").error, "step_not_valid_from_stage");
  assert.equal(K.kuruStageAfter(K.KURU_STAGE.ORDER_RESTING, "withdrawMargin").error, "step_not_valid_from_stage");
  assert.equal(K.kuruStageAfter(K.KURU_STAGE.ORDER_RESTING, "limitFill").error, "unproven_step:limitFill");
});
check("fields: unproven = UNKNOWN", () => { assert.equal(K.kuruField("restingOrderFill"), "UNKNOWN"); assert.equal(K.kuruField("nope"), "UNKNOWN"); assert.equal(K.kuruField("market"), MARKET); });
const SRC = readFileSync(path.join(HERE, "..", "src", "mainnet-job-kuru.js"), "utf8");
check("header keeps the 9 fork review conditions OPEN", () => { assert.equal((SRC.match(/^\/\/ {3}\[ \] [1-9] /gm) || []).length, 9); assert.ok(!/\[x\]/i.test(SRC)); });
check("module imports no executor / signer / network", () => {
  assert.ok(!/money-executor|executeMoneyStep|issuePermission|fetch\(|createWalletClient|sendTransaction/.test(SRC.replace(/^\/\/.*$/gm, "")));
  const imports = [...SRC.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./chain-profile.js", "./mainnet-job-common.js", "./permission-envelope.js", "./second-job-readiness.js", "viem"]);
});
check("no private path / card id / yield wording in the module", () => {
  assert.equal(PRIVATE_RE.test(SRC), false); assert.equal(/\bA-\d{3}\b/.test(SRC), false);
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.equal(/\b(apy|yield|venue)\b|["'`>](safe|instant)\b/i.test(code), false);
});
check("network calls = 0", () => assert.equal(fetchCalls, 0));
// [A-951 money-path review] the second check (kuruCallProblem) also caps a hand-built approve: max-uint / 0 / above the fork size refused.
{
  const { encodeFunctionData: encA } = await import("viem");
  const ABI = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] }];
  const PIG = "0x" + "a".repeat(40);
  for (const [step, spender, cap] of [["approveMarket", K.KURU_FORK_EVIDENCE.market, K.KURU_FORK_CAPS.buyUsdcRaw], ["approveMargin", K.KURU_FORK_EVIDENCE.marginAccount, K.KURU_FORK_CAPS.marginDepositRaw]]) {
    const call = (amt) => ({ to: K.KURU_FORK_EVIDENCE.usdc.address, data: encA({ abi: ABI, functionName: "approve", args: [spender, amt] }), value: 0n });
    for (const bad of [2n ** 256n - 1n, 0n, BigInt(cap) + 1n]) {
      const r = K.kuruCallProblem(step, call(bad), PIG);
      if (r !== "approve_amount_not_capped") throw new Error(`${step} ${bad}: ${r}`);
    }
    if (K.kuruCallProblem(step, call(BigInt(cap)), PIG) !== null) throw new Error(`${step} at cap should pass`);
  }
  console.log("PASS  kuruCallProblem caps a hand-built approve (max-uint / 0 / above fork size refused)");
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
