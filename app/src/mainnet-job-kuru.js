// Mainnet Job — Kuru MON / USDC order book: market swap (sell native MON, or buy MON with USDC) and a post-only limit buy that is
// placed and then cancelled. Local model of what is PROVEN on one mainnet fork run, nothing more. Same lane shape as the other mainnet
// Job modules.
//
// Evidence: one mainnet fork run, chain 143, block 110746900 (2026-10-05T12:01:37Z), anvil fork, fixture actors, no time warp, each scenario
// in its own snapshot. Contract identity: the vendor's published mainnet address table, plus getMarketParams read on-chain at the pin
// (base = native MON 18 dp, quote = USDC 6 dp, tick 100, min size 2e12 = 200 MON, maker / taker fee 0 / 0). Evidence class PASS_FORK_SIM —
// a fork run is never product readiness, permission, a price or a mainnet transaction.
//
//   PROVEN on the fork (success):
//     sell     placeAndExecuteMarketSell(2e12, quote × 0.995, false, true) value 200 MON → 6.409200 USDC to the wallet, no approval
//     buy      approve(market) → placeAndExecuteMarketBuy(5 USDC, quote × 0.995, false, true) → 155.797214 MON → approve(market, 0)
//              → sell the bought MON back → 4.992677 USDC
//     limit    approve(MarginAccount) → deposit(user, USDC, 8 USDC) → addBuyOrder(1 % under best bid, tick-aligned, 2e12, post-only)
//              → batchCancelOrders([own order id]) → withdraw(margin balance, USDC) → approve(MarginAccount, 0); wallet back to the start
//              exactly. A cancel by a non-owner reverted.
//   NOT PROVEN for this lane:  a resting order filling · any size other than the one run per path · depth / price impact at larger sizes ·
//                              a relay / session cancel path · the aggregator route · a sell order on the book · behaviour at another block
//
// Order ids are fork-specific. A cancel is built only for an order this Piggy created, read from that Piggy's own OrderCreated log on the
// fixed market; any other id is refused. A cancel returns the order's USDC to the margin account, not the wallet — withdraw is its own step.
// Every minimum out comes from a caller's MEASURED quote (a static call of the same function for exactly that size), with the fork run's
// 0.995 factor; without that measurement the step is refused. Expected amounts out stay UNKNOWN.
//
// Fork review — 9 conditions, ALL OPEN (never closed here):
//   [ ] 1 separate Owner-GO live-tx card (sizes chosen by the Owner; 200 MON / 5 USDC / 8 USDC are fork vectors, not caps for a person)
//   [ ] 2 grounded MON/USD at the same cutoff, for the value of a swap and for gas
//   [ ] 3 live-head re-read of market params / best bid-ask / depth vs the pin (stop on drift)
//   [ ] 4 Kuru market / MarginAccount / router source and upgrade-admin powers review (all three are small proxies at the pin)
//   [ ] 5 identity beyond the vendor address table (not in prior repo evidence before this run)
//   [ ] 6 resting-order fill behaviour and partial fills not simulated
//   [ ] 7 USDC freeze-blocklist-pause authority, incl. a freeze of the MarginAccount
//   [ ] 8 money-executor design and guard review
//   [ ] 9 product copy (OPEN)
//
// No execution path: this module imports no executor and no permission issuer, builds no signer, holds no storage key and reads no
// network. kuruExecutionGate() runs the existing boundaries and then refuses anyway, because no Kuru lane is wired to the one send
// chokepoint (money-executor.js). The product imports nothing here.

import { decodeEventLog, decodeFunctionData, encodeFunctionData } from "viem";
import { EVIDENCE_LABEL } from "./second-job-readiness.js";
import { NATIVE_ASSET_NOT_ERC20, bindRecordToProfile, chainMatchesExecutor, erc20TokenOfBinding, isProfileActive } from "./chain-profile.js";
import { permissionNonce } from "./permission-envelope.js";
import { ADDR, executorRefusal, formatUnits, isDigits, lower } from "./mainnet-job-common.js";

export const KURU_JOB_ID = "kuru-mon-usdc";
export const KURU_ACTION = Object.freeze({
  SELL: "kuru_market_sell_native_mon",
  BUY: "kuru_market_buy_mon_with_usdc",
  LIMIT: "kuru_limit_buy_place_cancel_withdraw",
});

export const KURU_PROOF = Object.freeze({ PROVEN_FORK: "proven_fork", UNPROVEN: "unproven" });

// Copied from the fork run record, not derived.
export const KURU_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM,
  chainId: 143,
  block: 110746900,
  blockTimestamp: "2026-10-05T12:01:37Z",
  blockTimestampUnix: 1791201697,
  timeWarp: false,
  market: "0x065C9d28E428A0db40191a54d33d5b7c71a9C394",
  marginAccount: "0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5",
  router: "0xd651346d7c789536ebf06dc72aE3C8502cd695CC",
  codeBytes: Object.freeze({ market: 141, marginAccount: 141, router: 141 }),
  usdc: Object.freeze({ symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 }),
  marketParams: Object.freeze({
    pricePrecision: "100000000",
    sizePrecision: "10000000000",
    baseAsset: "0x0000000000000000000000000000000000000000",
    baseDecimals: 18,
    quoteAsset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    quoteDecimals: 6,
    tickSize: "100",
    minSize: "2000000000000",
    maxSize: "2000000000000000000",
    takerFeeBps: "0",
    makerFeeBps: "0",
  }),
  bestBidAskAtPin: Object.freeze({ bid: "32046000000000000", ask: "32093000000000000", bidPricePP: "3204600", askPricePP: "3209300" }),
  minOutFactor: Object.freeze({ numerator: 995, denominator: 1000 }),
  limitPriceFactor: Object.freeze({ numerator: 99, denominator: 100 }),
  sell: Object.freeze({ sizeRaw: "2000000000000", monWei: "200000000000000000000", quoteUsdcRaw: "6409200", usdcReceivedRaw: "6409200" }),
  buy: Object.freeze({
    usdcRaw: "5000000", quoteSizePP: "500000000", quoteMonWei: "155797214345800000000", monReceivedWei: "155797214345800000000",
    sellBackSizeRaw: "1557972143458", sellBackQuoteUsdcRaw: "4992677", sellBackUsdcReceivedRaw: "4992677",
  }),
  limit: Object.freeze({
    walletStartRaw: "20000000", depositRaw: "8000000", priceUnitsPP: "3172500", sizeRaw: "2000000000000", orderIdAtPin: "119614971",
    marginAfterPlaceRaw: "1655000", marginAfterCancelRaw: "8000000", walletAfterWithdrawRaw: "20000000",
    nonOwnerCancel: "reverted (custom error 0xa0cdd781)", cancelRefundsTo: "margin_account",
  }),
  gasUsed: Object.freeze({
    sellMon: 165198, approveMarket: 55437, buyMon: 150219, revokeMarket: 33501, sellBack: 148074,
    approveMargin: 55437, depositMargin: 85880, placeLimit: 178719, cancelLimit: 71037, withdrawMargin: 58270, revokeMargin: 33501,
  }),
  unknown: Object.freeze([
    "resting_order_fill", "depth_above_fork_size", "live_head_drift", "admin_upgrade_powers", "relay_cancel_path", "aggregator_route",
    "freeze_of_margin_account", "gas_fee_usd", "mon_usd", "freshness_window",
  ]),
});

const MP = KURU_FORK_EVIDENCE.marketParams;
const PP = BigInt(MP.pricePrecision);
const SP = BigInt(MP.sizePrecision);
const TICK = BigInt(MP.tickSize);
const MIN_SIZE = BigInt(MP.minSize);
const E18 = 10n ** 18n;
const WEI_PER_SIZE_UNIT = E18 / SP; // 1e8 wei of MON per size-precision unit

// Fork-proven ceilings: the one size run per path. Never a cap for a person, only the edge of what the fork saw.
export const KURU_FORK_CAPS = Object.freeze({
  sellMonWei: KURU_FORK_EVIDENCE.sell.monWei,
  buyUsdcRaw: KURU_FORK_EVIDENCE.buy.usdcRaw,
  sellBackMonWei: KURU_FORK_EVIDENCE.buy.monReceivedWei,
  marginDepositRaw: KURU_FORK_EVIDENCE.limit.depositRaw,
  limitSizeRaw: KURU_FORK_EVIDENCE.limit.sizeRaw,
});

export const KURU_FIELDS = Object.freeze({
  market: Object.freeze({ proof: KURU_PROOF.PROVEN_FORK, value: KURU_FORK_EVIDENCE.market }),
  marginAccount: Object.freeze({ proof: KURU_PROOF.PROVEN_FORK, value: KURU_FORK_EVIDENCE.marginAccount }),
  quoteToken: Object.freeze({ proof: KURU_PROOF.PROVEN_FORK, value: KURU_FORK_EVIDENCE.usdc.address }),
  baseAsset: Object.freeze({ proof: KURU_PROOF.PROVEN_FORK, value: "native MON" }),
  minOutFactor: Object.freeze({ proof: KURU_PROOF.PROVEN_FORK, value: "0.995 of a measured quote" }),
  restingOrderFill: Object.freeze({ proof: KURU_PROOF.UNPROVEN, value: "UNKNOWN" }),
  depthAboveForkSize: Object.freeze({ proof: KURU_PROOF.UNPROVEN, value: "UNKNOWN" }),
  liveHeadDrift: Object.freeze({ proof: KURU_PROOF.UNPROVEN, value: "UNKNOWN" }),
  adminPowers: Object.freeze({ proof: KURU_PROOF.UNPROVEN, value: "UNKNOWN" }),
  relayCancelPath: Object.freeze({ proof: KURU_PROOF.UNPROVEN, value: "UNKNOWN" }),
  aggregatorRoute: Object.freeze({ proof: KURU_PROOF.UNPROVEN, value: "UNKNOWN" }),
  freezeAuthority: Object.freeze({ proof: KURU_PROOF.UNPROVEN, value: "UNKNOWN" }),
  monUsd: Object.freeze({ proof: KURU_PROOF.UNPROVEN, value: "UNKNOWN" }),
  gasFeeUsd: Object.freeze({ proof: KURU_PROOF.UNPROVEN, value: "UNKNOWN" }),
  freshnessWindow: Object.freeze({ proof: KURU_PROOF.UNPROVEN, value: "UNKNOWN" }),
});

export const KURU_UNKNOWN_FIELDS = Object.freeze(Object.keys(KURU_FIELDS).filter((k) => KURU_FIELDS[k].proof !== KURU_PROOF.PROVEN_FORK));

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The value of one protocol field, or "UNKNOWN" for anything not proven or not listed. */
export function kuruField(name) {
  if (typeof name !== "string" || !has(KURU_FIELDS, name)) return "UNKNOWN";
  const f = KURU_FIELDS[name];
  return f.proof === KURU_PROOF.PROVEN_FORK ? f.value : "UNKNOWN";
}

// Writer calls the fork run made successfully, in the exact ABI forms it used. Return values are never decoded here: amounts out are
// read as balances, not trusted.
const PROVEN_ABI = Object.freeze([
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "placeAndExecuteMarketSell", stateMutability: "payable", inputs: [{ name: "_size", type: "uint96" }, { name: "_minAmountOut", type: "uint256" }, { name: "_isMargin", type: "bool" }, { name: "_isFillOrKill", type: "bool" }], outputs: [] },
  { type: "function", name: "placeAndExecuteMarketBuy", stateMutability: "payable", inputs: [{ name: "_quoteSize", type: "uint96" }, { name: "_minAmountOut", type: "uint256" }, { name: "_isMargin", type: "bool" }, { name: "_isFillOrKill", type: "bool" }], outputs: [] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [{ name: "_user", type: "address" }, { name: "_token", type: "address" }, { name: "_amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "addBuyOrder", stateMutability: "nonpayable", inputs: [{ name: "_price", type: "uint32" }, { name: "size", type: "uint96" }, { name: "_postOnly", type: "bool" }], outputs: [] },
  { type: "function", name: "batchCancelOrders", stateMutability: "nonpayable", inputs: [{ name: "_orderIds", type: "uint40[]" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "_amount", type: "uint256" }, { name: "_token", type: "address" }], outputs: [] },
]);
const ORDER_CREATED_ABI = Object.freeze([
  { type: "event", name: "OrderCreated", inputs: [{ name: "orderId", type: "uint40", indexed: false }, { name: "owner", type: "address", indexed: false }, { name: "size", type: "uint96", indexed: false }, { name: "price", type: "uint32", indexed: false }, { name: "isBuy", type: "bool", indexed: false }] },
]);

export const KURU_STAGE = Object.freeze({
  NONE: "none",
  SOLD_MON: "sold_mon",
  MARKET_APPROVED: "market_approved_exact",
  BOUGHT_MON: "bought_mon",
  MARKET_REVOKED: "market_allowance_revoked",
  SOLD_BACK: "sold_back",
  MARGIN_APPROVED: "margin_approved_exact",
  IN_MARGIN: "usdc_in_margin",
  ORDER_RESTING: "order_resting",
  ORDER_CANCELLED: "order_cancelled",
  MARGIN_WITHDRAWN: "margin_withdrawn",
  MARGIN_REVOKED: "margin_allowance_revoked",
  UNKNOWN: "unknown",
});

const S = KURU_STAGE;
const G = KURU_FORK_EVIDENCE.gasUsed;
const proven = (signature, selector, target, from, to, gasUsed, extra = {}) => Object.freeze({ proof: KURU_PROOF.PROVEN_FORK, signature, selector, target, from, to, forkStatus: "success", gasUsed, ...extra });
const unproven = (signature, selector, target, forkStatus) => Object.freeze({ proof: KURU_PROOF.UNPROVEN, signature, selector, target, from: null, to: null, forkStatus });

export const KURU_STEPS = Object.freeze({
  sellMon: proven("placeAndExecuteMarketSell(uint96,uint256,bool,bool)", "0x532c46db", "market", S.NONE, S.SOLD_MON, G.sellMon, { payable: true }),
  approveMarket: proven("approve(address,uint256)", "0x095ea7b3", "usdc", S.NONE, S.MARKET_APPROVED, G.approveMarket),
  buyMon: proven("placeAndExecuteMarketBuy(uint96,uint256,bool,bool)", "0x7c51d6cf", "market", S.MARKET_APPROVED, S.BOUGHT_MON, G.buyMon),
  revokeMarket: proven("approve(address,uint256)", "0x095ea7b3", "usdc", S.BOUGHT_MON, S.MARKET_REVOKED, G.revokeMarket, { amount: "0" }),
  sellBack: proven("placeAndExecuteMarketSell(uint96,uint256,bool,bool)", "0x532c46db", "market", S.MARKET_REVOKED, S.SOLD_BACK, G.sellBack, { payable: true }),
  approveMargin: proven("approve(address,uint256)", "0x095ea7b3", "usdc", S.NONE, S.MARGIN_APPROVED, G.approveMargin),
  depositMargin: proven("deposit(address,address,uint256)", "0x8340f549", "marginAccount", S.MARGIN_APPROVED, S.IN_MARGIN, G.depositMargin),
  placeLimit: proven("addBuyOrder(uint32,uint96,bool)", "0xa09e9040", "market", S.IN_MARGIN, S.ORDER_RESTING, G.placeLimit),
  cancelLimit: proven("batchCancelOrders(uint40[])", "0x23afbff3", "market", S.ORDER_RESTING, S.ORDER_CANCELLED, G.cancelLimit),
  withdrawMargin: proven("withdraw(uint256,address)", "0x00f714ce", "marginAccount", S.ORDER_CANCELLED, S.MARGIN_WITHDRAWN, G.withdrawMargin),
  revokeMargin: proven("approve(address,uint256)", "0x095ea7b3", "usdc", S.MARGIN_WITHDRAWN, S.MARGIN_REVOKED, G.revokeMargin, { amount: "0" }),
  // Not run on this lane path: different claims, unproven.
  limitFill: unproven("addBuyOrder(uint32,uint96,bool)", "0xa09e9040", "market", "never_observed"),
  placeSellLimit: unproven("addSellOrder(uint32,uint96,bool)", "0x40e79b1b", "market", "not_on_this_lane"),
  aggregatorSwap: unproven("UNKNOWN", "UNKNOWN", "UNKNOWN", "not_on_this_lane"),
  relayCancel: unproven("UNKNOWN", "UNKNOWN", "UNKNOWN", "not_on_this_lane"),
});

export const KURU_UNPROVEN_STEPS = Object.freeze(Object.keys(KURU_STEPS).filter((k) => KURU_STEPS[k].proof !== KURU_PROOF.PROVEN_FORK));

const TARGET = Object.freeze({ market: KURU_FORK_EVIDENCE.market, marginAccount: KURU_FORK_EVIDENCE.marginAccount, usdc: KURU_FORK_EVIDENCE.usdc.address });

function stepProblem(step) {
  if (typeof step !== "string" || !has(KURU_STEPS, step)) return "unknown_step";
  if (KURU_STEPS[step].proof !== KURU_PROOF.PROVEN_FORK) return `unproven_step:${step}`;
  return null;
}

/** The stage after one step, only along fork-proven transitions. */
export function kuruStageAfter(stage, step) {
  if (!Object.values(KURU_STAGE).includes(stage) || stage === KURU_STAGE.UNKNOWN) return { stage: null, error: "unknown_stage" };
  const problem = stepProblem(step);
  if (problem) return { stage: null, error: problem };
  const s = KURU_STEPS[step];
  if (stage !== s.from) return { stage: null, error: "step_not_valid_from_stage" };
  return { stage: s.to, error: null };
}

function snapshotPiggy(piggy) {
  if (!piggy || typeof piggy !== "object") return {};
  const id = piggy.id;
  const address = piggy.address;
  return { id: typeof id === "string" ? id : undefined, address: typeof address === "string" ? address : undefined };
}

function exactWithin(v, limit, notExact, above) {
  if (!isDigits(v) || BigInt(v) === 0n) return { amount: null, error: notExact };
  if (BigInt(v) > BigInt(limit)) return { amount: null, error: above };
  return { amount: BigInt(v), error: null };
}
// min out = measured quote × 995 / 1000 (the fork run's factor); a missing / non-integer / zero quote = refused.
function minOutFrom(quote, missing) {
  if (!isDigits(quote) || BigInt(quote) === 0n) return { min: null, error: missing };
  const f = KURU_FORK_EVIDENCE.minOutFactor;
  const min = (BigInt(quote) * BigInt(f.numerator)) / BigInt(f.denominator);
  if (min === 0n) return { min: null, error: missing }; // a minimum of 0 is never sent
  return { min, error: null };
}
// Optional target / token claims from a caller must name exactly the fork-evidence contracts; nothing else is ever substituted.
function pinProblem(a) {
  if (a.market !== undefined && lower(a.market) !== lower(KURU_FORK_EVIDENCE.market)) return "market_not_fork_evidence";
  if (a.marginAccount !== undefined && lower(a.marginAccount) !== lower(KURU_FORK_EVIDENCE.marginAccount)) return "margin_account_not_fork_evidence";
  if (a.token !== undefined && lower(a.token) !== lower(KURU_FORK_EVIDENCE.usdc.address)) return "token_not_fork_evidence";
  if (a.router !== undefined) return "router_not_on_this_lane";
  return null;
}

/**
 * The order record a Piggy may cancel: decoded from ONE OrderCreated log emitted by the fixed market, owned by that Piggy.
 * Anything else (another contract, another owner, a non-OrderCreated log, a malformed log) is refused.
 * @returns {{order: object|null, error: string|null}}
 */
export function kuruOrderFromLog(log, piggyAddress) {
  if (typeof piggyAddress !== "string" || !ADDR.test(piggyAddress)) return { order: null, error: "missing_piggy_address" };
  if (!log || typeof log !== "object" || typeof log.address !== "string") return { order: null, error: "order_log_missing" };
  if (lower(log.address) !== lower(KURU_FORK_EVIDENCE.market)) return { order: null, error: "market_not_fork_evidence" };
  let ev;
  try { ev = decodeEventLog({ abi: ORDER_CREATED_ABI, data: log.data, topics: log.topics }); } catch { return { order: null, error: "order_log_not_order_created" }; }
  if (ev.eventName !== "OrderCreated") return { order: null, error: "order_log_not_order_created" };
  if (lower(ev.args.owner) !== lower(piggyAddress)) return { order: null, error: "order_not_created_by_this_piggy" };
  return {
    order: Object.freeze({ market: KURU_FORK_EVIDENCE.market, orderId: ev.args.orderId.toString(), owner: ev.args.owner, sizeRaw: ev.args.size.toString(), priceUnitsPP: ev.args.price.toString(), isBuy: ev.args.isBuy }),
    error: null,
  };
}

const describe = (step, to, value, data, extra) => ({ call: Object.freeze({ step, to, value, ...extra, data }), error: null });

/**
 * Calldata for ONE fork-proven step. Every argument is explicit: approvals are exactly the amount (never unlimited) and revokes are 0;
 * every market order carries a minimum out from a caller's measured quote (fill-or-kill, wallet not margin); the limit price is 1 %
 * under a caller's measured best bid, tick-aligned and post-only, at the fork-run size; a cancel names only an order this Piggy created
 * on the fixed market; withdraw takes a measured margin balance. A description of a call, not a permission and not a send.
 * @returns {{call: object|null, error: string|null}}
 */
export function encodeKuruStep(step, args) {
  const problem = stepProblem(step);
  if (problem) return { call: null, error: problem };
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  if (typeof a.piggyAddress !== "string" || !ADDR.test(a.piggyAddress)) return { call: null, error: "missing_piggy_address" };
  const pin = pinProblem(a);
  if (pin) return { call: null, error: pin };
  const enc = (fn, fnArgs) => encodeFunctionData({ abi: PROVEN_ABI, functionName: fn, args: fnArgs });

  if (step === "revokeMarket" || step === "revokeMargin") {
    const spender = step === "revokeMarket" ? TARGET.market : TARGET.marginAccount;
    return describe(step, TARGET.usdc, "0", enc("approve", [spender, 0n]), { spender, amountRaw: "0" });
  }
  if (step === "sellMon" || step === "sellBack") {
    const cap = step === "sellMon" ? KURU_FORK_CAPS.sellMonWei : KURU_FORK_CAPS.sellBackMonWei;
    const mon = exactWithin(a.monWei, cap, "amount_not_exact", "amount_above_fork_proven_size");
    if (mon.error) return { call: null, error: mon.error };
    if (mon.amount % WEI_PER_SIZE_UNIT !== 0n) return { call: null, error: "amount_not_size_aligned" };
    const size = mon.amount / WEI_PER_SIZE_UNIT;
    const { min, error } = minOutFrom(a.quoteUsdcRaw, "usdc_quote_not_measured");
    if (error) return { call: null, error };
    return describe(step, TARGET.market, mon.amount.toString(), enc("placeAndExecuteMarketSell", [size, min, false, true]),
      { sizeRaw: size.toString(), monWei: mon.amount.toString(), minUsdcRaw: min.toString(), isMargin: false, fillOrKill: true, expectedUsdcRaw: "UNKNOWN" });
  }
  if (step === "approveMarket" || step === "buyMon") {
    const usdc = exactWithin(a.amountRaw, KURU_FORK_CAPS.buyUsdcRaw, "amount_not_exact", "amount_above_fork_proven_size");
    if (usdc.error) return { call: null, error: usdc.error };
    if (step === "approveMarket") return describe(step, TARGET.usdc, "0", enc("approve", [TARGET.market, usdc.amount]), { spender: TARGET.market, amountRaw: usdc.amount.toString() });
    const quoteSize = (usdc.amount * PP) / 10n ** BigInt(KURU_FORK_EVIDENCE.usdc.decimals);
    const { min, error } = minOutFrom(a.quoteMonWei, "mon_quote_not_measured");
    if (error) return { call: null, error };
    return describe(step, TARGET.market, "0", enc("placeAndExecuteMarketBuy", [quoteSize, min, false, true]),
      { amountRaw: usdc.amount.toString(), quoteSizePP: quoteSize.toString(), minMonWei: min.toString(), isMargin: false, fillOrKill: true, expectedMonWei: "UNKNOWN" });
  }
  if (step === "approveMargin" || step === "depositMargin" || step === "withdrawMargin") {
    const usdc = exactWithin(a.amountRaw, KURU_FORK_CAPS.marginDepositRaw, step === "withdrawMargin" ? "margin_not_measured" : "amount_not_exact", "amount_above_fork_proven_size");
    if (usdc.error) return { call: null, error: usdc.error };
    if (step === "approveMargin") return describe(step, TARGET.usdc, "0", enc("approve", [TARGET.marginAccount, usdc.amount]), { spender: TARGET.marginAccount, amountRaw: usdc.amount.toString() });
    if (step === "depositMargin") return describe(step, TARGET.marginAccount, "0", enc("deposit", [a.piggyAddress, TARGET.usdc, usdc.amount]), { user: a.piggyAddress, token: TARGET.usdc, amountRaw: usdc.amount.toString() });
    return describe(step, TARGET.marginAccount, "0", enc("withdraw", [usdc.amount, TARGET.usdc]), { token: TARGET.usdc, amountRaw: usdc.amount.toString() });
  }
  if (step === "placeLimit") {
    const size = exactWithin(a.sizeRaw, KURU_FORK_CAPS.limitSizeRaw, "size_not_exact", "size_above_fork_proven_size");
    if (size.error) return { call: null, error: size.error };
    if (size.amount < MIN_SIZE) return { call: null, error: "size_below_market_min" };
    if (!isDigits(a.bestBidRaw) || BigInt(a.bestBidRaw) === 0n) return { call: null, error: "best_bid_not_measured" };
    const bidPP = (BigInt(a.bestBidRaw) * PP) / E18;
    const f = KURU_FORK_EVIDENCE.limitPriceFactor;
    const price = (((bidPP * BigInt(f.numerator)) / BigInt(f.denominator)) / TICK) * TICK;
    if (price === 0n || price >= 2n ** 32n) return { call: null, error: "price_out_of_range" };
    const margin = exactWithin(a.marginBalanceRaw, KURU_FORK_CAPS.marginDepositRaw, "margin_not_measured", "amount_above_fork_proven_size");
    if (margin.error) return { call: null, error: margin.error };
    // USDC the order locks (rounded up by 1 raw unit per division); must fit the measured margin balance.
    const needRaw = ((size.amount * price) / SP) * 10n ** BigInt(KURU_FORK_EVIDENCE.usdc.decimals) / PP + 2n;
    if (needRaw > margin.amount) return { call: null, error: "margin_below_order_need" };
    return describe(step, TARGET.market, "0", enc("addBuyOrder", [Number(price), size.amount, true]),
      { priceUnitsPP: price.toString(), sizeRaw: size.amount.toString(), postOnly: true, isBuy: true, approxQuoteNeededRaw: needRaw.toString(), fillOutcome: "UNKNOWN" });
  }
  // cancelLimit — only an order this Piggy created on the fixed market (a record from kuruOrderFromLog).
  const o = a.order && typeof a.order === "object" ? a.order : null;
  if (!o) return { call: null, error: "order_not_created_by_this_piggy" };
  if (lower(o.market) !== lower(KURU_FORK_EVIDENCE.market)) return { call: null, error: "market_not_fork_evidence" };
  if (typeof o.owner !== "string" || lower(o.owner) !== lower(a.piggyAddress)) return { call: null, error: "order_not_created_by_this_piggy" };
  if (!isDigits(o.orderId) || BigInt(o.orderId) === 0n || BigInt(o.orderId) >= 2n ** 40n) return { call: null, error: "order_id_invalid" };
  if (a.orderId !== undefined && String(a.orderId) !== o.orderId) return { call: null, error: "order_not_created_by_this_piggy" };
  return describe(step, TARGET.market, "0", enc("batchCancelOrders", [[BigInt(o.orderId)]]), { orderIds: Object.freeze([o.orderId]), refundTo: "margin_account" });
}

/**
 * Re-reads a built call against the fixed targets (target, selector, spender, token, receiver, value). Returns a refusal or null.
 * A second look, not a permission.
 */
export function kuruCallProblem(step, call, piggyAddress) {
  const problem = stepProblem(step);
  if (problem) return problem;
  if (!call || typeof call !== "object" || typeof call.data !== "string" || typeof call.to !== "string") return "call_missing";
  if (typeof piggyAddress !== "string" || !ADDR.test(piggyAddress)) return "missing_piggy_address";
  const s = KURU_STEPS[step];
  if (lower(call.to) !== lower(TARGET[s.target])) return "target_not_fork_evidence";
  if (call.data.slice(0, 10).toLowerCase() !== s.selector) return "selector_not_step";
  let d;
  try { d = decodeFunctionData({ abi: PROVEN_ABI, data: call.data }); } catch { return "calldata_unreadable"; }
  const value = call.value === undefined ? "0" : String(call.value);
  if (s.payable !== true && value !== "0") return "value_not_allowed";
  if (d.functionName === "approve") {
    const spender = step === "approveMarket" || step === "revokeMarket" ? TARGET.market : TARGET.marginAccount;
    if (lower(d.args[0]) !== lower(spender)) return "spender_not_fork_evidence";
    if (step.startsWith("revoke") && d.args[1] !== 0n) return "revoke_not_zero";
    // an approve built anywhere must stay within the fork-proven size of its path (never max-uint, never 0)
    if (!step.startsWith("revoke")) {
      const cap = BigInt(step === "approveMarket" ? KURU_FORK_CAPS.buyUsdcRaw : KURU_FORK_CAPS.marginDepositRaw);
      if (d.args[1] <= 0n || d.args[1] > cap) return "approve_amount_not_capped";
    }
  }
  if (d.functionName === "deposit" && (lower(d.args[0]) !== lower(piggyAddress) || lower(d.args[1]) !== lower(TARGET.usdc))) return "deposit_not_for_this_piggy_usdc";
  if (d.functionName === "withdraw" && lower(d.args[1]) !== lower(TARGET.usdc)) return "token_not_fork_evidence";
  if (d.functionName.startsWith("placeAndExecute") && (d.args[2] !== false || d.args[3] !== true || d.args[1] === 0n)) return "market_order_shape_not_fork_evidence";
  if (d.functionName === "placeAndExecuteMarketSell" && BigInt(value) !== BigInt(d.args[0]) * WEI_PER_SIZE_UNIT) return "value_not_size";
  if (d.functionName === "addBuyOrder" && d.args[2] !== true) return "limit_not_post_only";
  return null;
}

const PERMISSION_SHAPE = Object.freeze({
  [KURU_ACTION.BUY]: Object.freeze({ cap: KURU_FORK_CAPS.buyUsdcRaw, destination: KURU_FORK_EVIDENCE.market }),
  [KURU_ACTION.LIMIT]: Object.freeze({ cap: KURU_FORK_CAPS.marginDepositRaw, destination: KURU_FORK_EVIDENCE.marginAccount }),
});

/**
 * The exact request a permission envelope for a USDC-in Kuru action would have to match. Issues nothing (permission null).
 * The native-MON sell has no USDC binding in a profile: refused, never modelled here.
 */
export function kuruPermissionRequest(input) {
  const { profile, piggy, action, amountRaw, eventId } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  if (action === KURU_ACTION.SELL) return { request: null, error: "native_mon_permission_not_modelled" };
  if (typeof action !== "string" || !has(PERMISSION_SHAPE, action)) return { request: null, error: "unknown_action" };
  if (!isProfileActive(profile)) return { request: null, error: "profile_blocked" };
  if (!chainMatchesExecutor(profile, KURU_FORK_EVIDENCE.chainId)) return { request: null, error: "profile_chain_not_kuru_evidence" }; // [fork-parent]
  const { binding, error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return { request: null, error };
  const usdc = KURU_FORK_EVIDENCE.usdc;
  if (erc20TokenOfBinding(binding).error === NATIVE_ASSET_NOT_ERC20) return { request: null, error: NATIVE_ASSET_NOT_ERC20 };
  if (lower(binding.token) !== lower(usdc.address) || binding.decimals !== usdc.decimals) return { request: null, error: "profile_asset_not_kuru_evidence" };
  const shape = PERMISSION_SHAPE[action];
  const exact = exactWithin(amountRaw, shape.cap, "amount_not_exact", "amount_above_fork_proven_size");
  if (exact.error) return { request: null, error: exact.error };
  const fields = {
    piggyId: binding.piggyId,
    signerAddress: binding.piggyAddress,
    action,
    asset: binding.asset,
    amount: exact.amount.toString(),
    chain: binding.chain,
    destination: shape.destination,
  };
  return {
    request: Object.freeze({
      ...fields,
      destinationRequired: true,
      amountDisplay: `${formatUnits(exact.amount, binding.decimals)} ${binding.asset}`,
      expectedOut: "UNKNOWN",
      nonce: permissionNonce({ ...fields, at: typeof eventId === "string" && eventId ? eventId : "UNKNOWN_EVENT" }),
      permission: null,
      createsPermission: false,
    }),
    error: null,
  };
}

/** Could this step run for this Piggy? Always { allowed: false }. First refusal from the existing boundaries, then "kuru_lane_not_wired". */
export function kuruExecutionGate(input) {
  const { profile, piggy, executor, step } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  const refuse = (reason) => Object.freeze({ allowed: false, action: "none", actionCount: 0, reason, liveExecution: false, executionPermission: false });
  const problem = stepProblem(step);
  if (problem) return refuse(problem);
  if (!isProfileActive(profile)) return refuse("profile_blocked");
  // [live-gate-form] fork-only gate: `!== false` lets exactly false through (to the local_fork executor check below); true / undefined / "true" / 1 refuse. Not the live gate.
  if (profile.liveExecution !== false) return refuse("live_execution_disabled");
  if (profile.jobId !== KURU_JOB_ID) return refuse("profile_not_kuru_lane");
  const { error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return refuse(error);
  const refused = executorRefusal(profile, executor);
  if (refused) return refuse(refused);
  if (KURU_UNKNOWN_FIELDS.length) return refuse(`unknown_field:${KURU_UNKNOWN_FIELDS[0]}`);
  return refuse("kuru_lane_not_wired");
}

/** Readiness of a Kuru errand. Never READY / executable / live / permitted, whatever the input claims. */
export function kuruReadiness(input) {
  const { stage, profile, piggy, executor } = input && typeof input === "object" ? input : {};
  const blockedBy = [];
  for (const s of KURU_UNPROVEN_STEPS) blockedBy.push(`unproven_step:${s}`);
  for (const f of KURU_UNKNOWN_FIELDS) blockedBy.push(`unknown_field:${f}`);
  const gate = kuruExecutionGate({ profile: profile ?? null, piggy, executor, step: "approveMarket" });
  blockedBy.push(gate.reason);
  blockedBy.push("live_execution_disabled", "kuru_lane_not_wired", "fork_review_conditions_open");
  const known = typeof stage === "string" && Object.values(KURU_STAGE).includes(stage) ? stage : (stage === undefined ? KURU_STAGE.NONE : KURU_STAGE.UNKNOWN);
  return Object.freeze({
    jobId: KURU_JOB_ID,
    stage: known,
    decision: "unknown",
    action: "none",
    actionCount: 0,
    ready: false,
    executable: false,
    executionPermission: false,
    createsPermission: false,
    liveExecution: false,
    monAssumedEqualToUsdc: false,
    evidenceClass: KURU_FORK_EVIDENCE.label,
    provenSteps: Object.freeze(Object.keys(KURU_STEPS).filter((k) => KURU_STEPS[k].proof === KURU_PROOF.PROVEN_FORK)),
    unprovenSteps: KURU_UNPROVEN_STEPS,
    unknownFields: KURU_UNKNOWN_FIELDS,
    blockedBy: Object.freeze([...new Set(blockedBy)]),
  });
}

// ── [fork-link] live-readiness checks (job-executor review conditions) ──────────────────────────────────────────────────────────────
// encodeKuruStep() above stays the fork DESCRIPTION and still takes the Piggy from its args. A future live lane must build a step
// ONLY through kuruLiveStep() below:
//   (a) the Piggy in the args == the record binding's Piggy == the signer; receiver / owner / user are then always that one address
//       (taken from the binding, never from the args alone);
//   (b) every market order's minimum out comes from a quote whose SOURCE and FRESHNESS are checked here: a static call of the same
//       function on the fixed market for exactly this order size, read at a known block within maxReadAgeMs. A caller-supplied
//       number without that provenance is refused. The order then carries quote × 0.995 (the fork run's factor), as before.
// Nothing here is wired and nothing reads a network: reads are injected, each with its block and read time. The gate still refuses.
export const KURU_LIVE_LIMITS = Object.freeze({ maxReadAgeMs: 30000, maxSlippageBps: 100 });

const liveRefuse = (error) => ({ call: null, error });
function liveIdentityProblem(piggyAddress, binding, signerAddress) {
  if (!binding || typeof binding !== "object" || !ADDR.test(binding.piggyAddress || "")) return "binding_missing";
  if (typeof signerAddress !== "string" || !ADDR.test(signerAddress)) return "signer_missing";
  if (typeof piggyAddress !== "string" || !ADDR.test(piggyAddress)) return "missing_piggy_address";
  if (lower(binding.piggyAddress) !== lower(piggyAddress) || lower(signerAddress) !== lower(piggyAddress)) return "piggy_binding_signer_mismatch";
  return null;
}
// One injected read: { valueRaw, block, readAt, forRaw? }. Fresh = read within maxReadAgeMs of nowMs (and not from the future).
function freshRead(r, nowMs, name) {
  const L = KURU_LIVE_LIMITS;
  if (!r || typeof r !== "object" || !isDigits(r.valueRaw)) return { value: null, block: null, error: `${name}_not_read` };
  if (!Number.isSafeInteger(r.block) || r.block <= 0) return { value: null, block: null, error: `${name}_block_missing` };
  const at = typeof r.readAt === "string" ? Date.parse(r.readAt) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return { value: null, block: null, error: `${name}_time_missing` };
  if (nowMs - at > L.maxReadAgeMs || at - nowMs > 5000) return { value: null, block: null, error: `${name}_stale` };
  return { value: BigInt(r.valueRaw), block: r.block, error: null };
}
// The floor: present, not above the fresh preview, and not looser than maxSlippageBps under it.
function floorProblem(minOutRaw, preview) {
  if (!isDigits(minOutRaw) || BigInt(minOutRaw) === 0n) return "min_out_missing";
  const min = BigInt(minOutRaw);
  if (min > preview) return "preview_below_min_out";
  if (min * 10000n < preview * BigInt(10000 - KURU_LIVE_LIMITS.maxSlippageBps)) return "min_out_too_loose";
  return null;
}
const withFloor = (out, minOutRaw, outAsset, previewBlock) => (out.error ? out : { call: Object.freeze({ ...out.call, minOutRaw, minOutAsset: outAsset, previewBlock, postCheck: "kuruOutMeetsFloor" }), error: null });

/** After a send: did the realized balance delta (measured before / after, gas excluded by the caller) reach the floor? */
export function kuruOutMeetsFloor({ minOutRaw, beforeRaw, afterRaw } = {}) {
  if (!isDigits(minOutRaw) || !isDigits(beforeRaw) || !isDigits(afterRaw)) return { ok: false, deltaRaw: null, reason: "balances_not_measured" };
  const delta = BigInt(afterRaw) - BigInt(beforeRaw);
  return delta >= BigInt(minOutRaw) ? { ok: true, deltaRaw: delta.toString(), reason: null } : { ok: false, deltaRaw: delta.toString(), reason: "realized_below_min_out" };
}

const KURU_QUOTE_FUNCTION = Object.freeze({ sellMon: "placeAndExecuteMarketSell", sellBack: "placeAndExecuteMarketSell", buyMon: "placeAndExecuteMarketBuy" });

function kuruQuoteProblem(step, quote, sizeRaw, nowMs) {
  if (!quote || typeof quote !== "object") return "quote_missing";
  // `source` is a label the caller writes: it is NOT evidence. What binds the quote to this order is the checks below (function, fixed
  // market, exactly this size, a block, age ≤ maxReadAgeMs) plus the on-chain _minAmountOut = quote × 0.995 (fill-or-kill reverts below it).
  if (quote.source !== "static_call") return "quote_source_not_static_call";
  if (quote.function !== KURU_QUOTE_FUNCTION[step]) return "quote_function_mismatch";
  if (typeof quote.market !== "string" || lower(quote.market) !== lower(KURU_FORK_EVIDENCE.market)) return "quote_market_mismatch";
  if (quote.forRaw !== sizeRaw) return "quote_not_for_this_size";
  const r = freshRead({ valueRaw: quote.outRaw, block: quote.block, readAt: quote.readAt }, nowMs, "quote");
  if (r.error) return r.error;
  if (r.value === 0n) return "quote_not_read";
  return null;
}

/**
 * One step for a live lane, after the job-executor live-readiness checks. input = { piggyAddress, binding, signerAddress, ...the encode args
 * (monWei / amountRaw / sizeRaw / bestBidRaw / marginBalanceRaw / order), quote: { source, function, market, forRaw, outRaw, block,
 * readAt } for sellMon / sellBack / buyMon, nowMs }. The Piggy (and depositMargin's _user) is the binding's address.
 * @returns {{call: object|null, error: string|null}}
 */
export function kuruLiveStep(step, input) {
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const id = liveIdentityProblem(i.piggyAddress, i.binding, i.signerAddress);
  if (id) return liveRefuse(id);
  if (erc20TokenOfBinding(i.binding).error === NATIVE_ASSET_NOT_ERC20) return liveRefuse(NATIVE_ASSET_NOT_ERC20); // native MON never takes the USDC approve / margin-deposit path
  if (lower(i.binding.token) !== lower(KURU_FORK_EVIDENCE.usdc.address)) return liveRefuse("binding_asset_not_kuru_evidence");
  const piggy = i.binding.piggyAddress;
  const args = { ...i, piggyAddress: piggy, quoteUsdcRaw: undefined, quoteMonWei: undefined };
  delete args.binding; delete args.signerAddress; delete args.quote; delete args.nowMs;
  if (has(KURU_QUOTE_FUNCTION, step)) {
    const sizeRaw = step === "buyMon" ? i.amountRaw : i.monWei;
    const q = kuruQuoteProblem(step, i.quote, sizeRaw, i.nowMs);
    if (q) return liveRefuse(q);
    // the floor the order will carry (quote × 0.995) must sit at or under the quote and within maxSlippageBps of it
    const f = floorProblem(minOutFrom(i.quote.outRaw, "quote_not_read").min?.toString(), BigInt(i.quote.outRaw));
    if (f) return liveRefuse(f);
    if (step === "buyMon") args.quoteMonWei = i.quote.outRaw; else args.quoteUsdcRaw = i.quote.outRaw;
  }
  const out = encodeKuruStep(step, args);
  if (out.error) return out;
  const problem = kuruCallProblem(step, out.call, piggy);
  if (problem) return liveRefuse(problem);
  return has(KURU_QUOTE_FUNCTION, step) ? { call: Object.freeze({ ...out.call, quoteBlock: i.quote.block, quoteSourceLabel: "static_call", quoteBoundBy: "function+market+size+block+age, on-chain _minAmountOut" }), error: null } : out;
}
