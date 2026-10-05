// Mainnet Job lane — Aave v3 USDC facts (supply, then withdraw to the same Piggy).
//
// Move-only extraction from mainnet-job-lane.js: the constants, ABIs, selectors and the reserve
// configuration decoder that belong to the Aave Job and to no other protocol. mainnet-job-lane.js
// re-exports every public name here unchanged, so existing imports keep working.
//
// Nothing here is a reader, a writer or an executor. MAINNET_LANE_CONFIG stays reader:null /
// liveExecution:false (defined in mainnet-job-lane.js). These values must not be reused as the shape
// of any other protocol: a non-Aave Job carries its own evidenced facts in its own module.

import { EVIDENCE_LABEL } from "./second-job-readiness.js";
import { CHAIN_PROFILE_ID, isProfileActive } from "./chain-profile.js";
import { ADDR } from "./mainnet-job-common.js";

export const LANE_JOB_ID = "aave-usdc";
export const LANE_ACTION = "grow_stable_roundtrip";
// The Explore destination this Job stands behind (job-feed.js fixture with an immediate return model).
export const LANE_DESTINATION_ID = "aave-like-grow-supply";
export const LANE_ERRAND_IDS = Object.freeze(["grow"]);
export const LANE_JIT_QUESTION_ID = "return_tolerance";

// The Pool's receipt token for USDC, re-derived on chain from getReserveData(USDC).aTokenAddress
// at the pinned fork block and equal to the recorded value.
export const LANE_RECEIPT_TOKEN = Object.freeze({
  symbol: "aMonUSDC",
  address: "0x35a73BAcb179d3740395A3ceCc87FF2e581d6042",
  decimals: 6,
});

// Fork evidence this lane was built from (mainnet fork, chain 143, no time warp).
export const LANE_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM,
  chainId: 143,
  block: 108999816,
  blockTimestamp: "2026-09-29T09:24:32Z",
  sentRaw: "5000000",
  returnedRaw: "4999999",
  deltaRaw: "-1",
  gasUsed: Object.freeze({ approve: 55437, supply: 197122, withdraw: 177464 }),
  exit: "immediate",
  revertProbe: Object.freeze({ step: "withdraw with zero position", selector: "0x47bc4b2c", name: "NotEnoughAvailableUserBalance()" }),
  unmeasured: Object.freeze(["supplyApr", "gasUsd"]),
});

// The only size proven end to end on the fork. A different cap is an Owner decision.
export const LANE_AMOUNT_CAP_RAW = "5000000";

export const ERC20_ABI = Object.freeze([
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
]);

export const POOL_ABI = Object.freeze([
  { type: "function", name: "supply", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "onBehalfOf", type: "address" }, { name: "referralCode", type: "uint16" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "to", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getReserveData", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ type: "tuple", components: [
    { name: "configuration", type: "uint256" }, { name: "liquidityIndex", type: "uint128" }, { name: "currentLiquidityRate", type: "uint128" },
    { name: "variableBorrowIndex", type: "uint128" }, { name: "currentVariableBorrowRate", type: "uint128" }, { name: "currentStableBorrowRate", type: "uint128" },
    { name: "lastUpdateTimestamp", type: "uint40" }, { name: "id", type: "uint16" }, { name: "aTokenAddress", type: "address" },
    { name: "stableDebtTokenAddress", type: "address" }, { name: "variableDebtTokenAddress", type: "address" }, { name: "interestRateStrategyAddress", type: "address" },
    { name: "accruedToTreasury", type: "uint128" }, { name: "unbacked", type: "uint128" }, { name: "isolationModeTotalDebt", type: "uint128" }] }] },
]);

export const LANE_SELECTORS = Object.freeze({
  approve: "0x095ea7b3",
  supply: "0x617ba037",
  withdraw: "0x69328dec",
  getReserveData: "0x35ea6a75",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
});

/** The running profile is the mainnet profile and names THIS Job with a USDC token. */
export function isAaveLaneProfile(profile) {
  return isProfileActive(profile) && profile.id === CHAIN_PROFILE_ID.MAINNET && profile.jobId === LANE_JOB_ID
    && !!profile.usdc && ADDR.test(profile.usdc.address);
}

/** Reserve configuration bitmap: decimals bits 48-55, active 56, frozen 57, paused 60. */
export function decodeReserveConfiguration(word) {
  if (typeof word !== "bigint" || word < 0n) return null;
  return {
    decimals: Number((word >> 48n) & 0xffn),
    active: ((word >> 56n) & 1n) === 1n,
    frozen: ((word >> 57n) & 1n) === 1n,
    paused: ((word >> 60n) & 1n) === 1n,
  };
}
