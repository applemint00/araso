// [A-694] Vendored VIEW-ONLY ABI fragments for the Second S1 current reader.
// Only functions that read state appear here. No approve / supply / withdraw / deposit / redeem:
// this reader cannot encode a state-changing call because the fragment does not exist.
// Vendored on purpose: mainnet-job-lane.js keeps its ABIs private and this card does not touch it.

export const ERC20_VIEW_ABI = Object.freeze([
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
]);

export const POOL_VIEW_ABI = Object.freeze([
  { type: "function", name: "getReserveData", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ type: "tuple", components: [
    { name: "configuration", type: "uint256" }, { name: "liquidityIndex", type: "uint128" }, { name: "currentLiquidityRate", type: "uint128" },
    { name: "variableBorrowIndex", type: "uint128" }, { name: "currentVariableBorrowRate", type: "uint128" }, { name: "currentStableBorrowRate", type: "uint128" },
    { name: "lastUpdateTimestamp", type: "uint40" }, { name: "id", type: "uint16" }, { name: "aTokenAddress", type: "address" },
    { name: "stableDebtTokenAddress", type: "address" }, { name: "variableDebtTokenAddress", type: "address" }, { name: "interestRateStrategyAddress", type: "address" },
    { name: "accruedToTreasury", type: "uint128" }, { name: "unbacked", type: "uint128" }, { name: "isolationModeTotalDebt", type: "uint128" }] }] },
]);

export const ERC4626_VIEW_ABI = Object.freeze([
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "convertToAssets", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
]);
