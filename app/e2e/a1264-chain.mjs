// [A-1264b] In-memory Monad testnet stand-in for the rehearsal runner. Answers the JSON-RPC calls the
// first journey makes (balance · nonce · fees · shMON deposit/redeem · receipts) with no network.
import { decodeFunctionData, keccak256, pad, parseAbi, parseTransaction, recoverTransactionAddress, toHex } from "viem";

const SHMON = "0x282bddff5e58793acab65438b257dbd15a8745c9";
const ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) payable returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function previewDeposit(uint256) view returns (uint256)",
  "function previewRedeem(uint256) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function convertToShares(uint256) view returns (uint256)",
]);
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const APPROVAL = keccak256(new TextEncoder().encode("Approval(address,address,uint256)"));
const GAS_PRICE = 50_000_000_000n;
const GAS_USED = 120_000n;
const hex = (n) => toHex(BigInt(n));
const word = (n) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;

// erc20: { defaultAllowance, defaultBalance } — a token's allowance/balance reads start from these until a tx changes them
export function createChain({ chainId = 10143, guard = null, erc20 = null } = {}) {
  const allowance = new Map();
  const balance = new Map();
  const shares = new Map();
  const nonce = new Map();
  const receipts = new Map();
  const txs = new Map();
  const faults = { sendErrors: [] }; // queue of -32000 refusals for eth_sendRawTransaction
  const log = [];
  const unknown = [];
  let block = 1000n;
  const key = (a) => String(a || "").toLowerCase();
  const get = (m, a) => m.get(key(a)) || 0n;

  function fund(address, wei) { balance.set(key(address), get(balance, address) + BigInt(wei)); }
  function blockObj(n = block) {
    return { number: hex(n), hash: word(n), parentHash: word(n - 1n), timestamp: hex(1760000000n + n), baseFeePerGas: hex(GAS_PRICE / 2n), gasLimit: hex(30_000_000n), gasUsed: "0x0", transactions: [], miner: `0x${"0".repeat(40)}`, difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x", size: "0x0", nonce: "0x0000000000000000", sha3Uncles: word(0), logsBloom: `0x${"0".repeat(512)}`, transactionsRoot: word(0), stateRoot: word(0), receiptsRoot: word(0), uncles: [], mixHash: word(0) };
  }
  function call({ to, data }) {
    if (key(to) !== SHMON && erc20 && data) {
      try {
        const { functionName, args } = decodeFunctionData({ abi: ERC20, data });
        if (functionName === "allowance") { const k = `${key(to)}|${key(args[0])}|${key(args[1])}`; return word(allowance.has(k) ? allowance.get(k) : erc20.defaultAllowance || 0n); }
        if (functionName === "balanceOf") return word(erc20.defaultBalance || 0n);
      } catch {}
    }
    if (key(to) !== SHMON || !data) { unknown.push(`eth_call ${to} ${String(data).slice(0, 10)}`); return word(0); }
    const { functionName, args } = decodeFunctionData({ abi: ABI, data });
    if (functionName === "balanceOf") return word(get(shares, args[0]));
    if (["previewDeposit", "previewRedeem", "convertToAssets", "convertToShares", "deposit", "redeem"].includes(functionName)) return word(args[0]);
    unknown.push(`eth_call shMON ${functionName}`); return word(0);
  }
  async function sendRaw(raw) {
    if (faults.sendErrors.length) { faults.sendErrors.shift(); log.push("sendRaw refused -32000"); return { error: { code: -32000, message: "a1264 injected refusal" } }; }
    const tx = parseTransaction(raw);
    const from = key(await recoverTransactionAddress({ serializedTransaction: raw }));
    const hash = keccak256(raw);
    if (receipts.has(hash)) return { result: hash };
    if (Number(tx.nonce) !== Number(get(nonce, from))) return { error: { code: -32000, message: "nonce too low" } };
    nonce.set(from, get(nonce, from) + 1n);
    const value = tx.value || 0n;
    balance.set(from, get(balance, from) - value - GAS_USED * GAS_PRICE);
    const logs = [];
    let approved = null;
    if (erc20 && key(tx.to) !== SHMON && tx.data) { try { approved = decodeFunctionData({ abi: ERC20, data: tx.data }); } catch {} }
    if (approved?.functionName === "approve") {
      allowance.set(`${key(tx.to)}|${from}|${key(approved.args[0])}`, approved.args[1]);
      logs.push({ address: tx.to, topics: [APPROVAL, pad(from), pad(key(approved.args[0]))], data: word(approved.args[1]) });
      log.push(`sendRaw approve ${approved.args[0]}=${approved.args[1]} nonce=${tx.nonce}`);
    } else if (key(tx.to) === SHMON && tx.data) {
      const { functionName, args } = decodeFunctionData({ abi: ABI, data: tx.data });
      if (functionName === "deposit") shares.set(key(args[1]), get(shares, args[1]) + value);
      if (functionName === "redeem") { shares.set(from, get(shares, from) - args[0]); balance.set(key(args[1]), get(balance, args[1]) + args[0]); }
      log.push(`sendRaw ${functionName} nonce=${tx.nonce}`);
    } else log.push(`sendRaw other nonce=${tx.nonce}`);
    block += 1n;
    txs.set(hash, { hash, from, to: tx.to, input: tx.data || "0x", value: hex(value), nonce: hex(tx.nonce), blockNumber: hex(block), blockHash: word(block), transactionIndex: "0x0", gas: hex(tx.gas || GAS_USED), gasPrice: hex(GAS_PRICE), chainId: hex(chainId), type: "0x0", v: "0x0", r: word(1), s: word(1) });
    receipts.set(hash, { transactionHash: hash, from, to: tx.to, status: "0x1", blockNumber: hex(block), blockHash: word(block), transactionIndex: "0x0", gasUsed: hex(GAS_USED), cumulativeGasUsed: hex(GAS_USED), effectiveGasPrice: hex(GAS_PRICE),
      logs: logs.map((l, i) => ({ ...l, blockNumber: hex(block), blockHash: word(block), transactionHash: hash, transactionIndex: "0x0", logIndex: hex(i), removed: false })), logsBloom: `0x${"0".repeat(512)}`, contractAddress: null, type: "0x0" });
    return { result: hash };
  }
  const calls = [];
  async function answer(req) {
    const p = req.params || [];
    calls.push(req.method);
    switch (req.method) {
      case "eth_chainId": return { result: hex(chainId) };
      case "net_version": return { result: String(chainId) };
      case "eth_blockNumber": return { result: hex(block) };
      case "eth_getBalance": return { result: hex(get(balance, p[0])) };
      case "eth_getTransactionCount": return { result: hex(get(nonce, p[0])) };
      case "eth_gasPrice": return { result: hex(GAS_PRICE) };
      case "eth_maxPriorityFeePerGas": return { result: hex(1_000_000_000n) };
      case "eth_estimateGas": return { result: hex(GAS_USED) };
      case "eth_getBlockByNumber": return { result: blockObj() };
      case "eth_feeHistory": return { result: { oldestBlock: hex(block), baseFeePerGas: [hex(GAS_PRICE / 2n), hex(GAS_PRICE / 2n)], gasUsedRatio: [0.5], reward: [[hex(1_000_000_000n)]] } };
      case "eth_call": return { result: call(p[0] || {}) };
      case "eth_sendRawTransaction": return sendRaw(p[0]);
      case "eth_getTransactionReceipt": return { result: receipts.get(key(p[0])) || null };
      case "eth_getTransactionByHash": return { result: txs.get(key(p[0])) || null };
      case "eth_getCode": return { result: "0x00" };
      case "araso_guardInfo": return guard ? { result: guard } : { error: { code: -32601, message: "not a guard" } };
      default: unknown.push(req.method); return { error: { code: -32601, message: "a1264 stub: method not handled" } };
    }
  }
  async function handle(bodyText) {
    const body = JSON.parse(bodyText || "null");
    const one = async (r) => ({ jsonrpc: "2.0", id: r.id, ...(await answer(r)) });
    return Array.isArray(body) ? Promise.all(body.map(one)) : one(body);
  }
  return { calls, handle, fund, faults, log, unknown, nonceOf: (a) => Number(get(nonce, a)), sharesOf: (a) => get(shares, a), balanceOf: (a) => get(balance, a) };
}
