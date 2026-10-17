// A small Monad-testnet stand-in for the Journey 1 chain search: blocks hold this Piggy's txs in nonce order; the account nonce at a past
// block is the count of its txs mined at or before it; reads older than `historyFloor` fail like a node without that state.
export const SHMON = "0x282bddff5e58793acab65438b257dbd15a8745c9";
export const SEL = Object.freeze({ deposit: "0x6e553f65", redeem: "0xba087652", other: "0xa9059cbb" });
const word = (hexNoPrefix) => hexNoPrefix.padStart(64, "0");
const hex = (n) => "0x" + BigInt(n).toString(16);

/** txs: [{ block, kind: "deposit" | "redeem" | "other", status = 1, to = SHMON }] in nonce order. */
export function fakeJ1Chain({ piggy, txs, latest = 4_000_000, historyFloor = 0, chainId = 10143 }) {
  const me = piggy.toLowerCase();
  const rows = txs.map((t, nonce) => {
    const hash = "0x" + (nonce + 1).toString(16).padStart(8, "0") + "ab".repeat(28);
    const amount = word("2386f26fc10000");
    const input = t.kind === "deposit" ? SEL.deposit + amount + word(me.slice(2))
      : t.kind === "redeem" ? SEL.redeem + amount + word(me.slice(2)) + word(me.slice(2))
        : SEL.other + word(me.slice(2)) + amount;
    return { ...t, nonce, hash, input, to: (t.to || SHMON).toLowerCase(), status: t.status ?? 1 };
  });
  const calls = [];
  const fail = (code) => { const e = new Error(code); e.code = code; e.answered = true; throw e; }; // the node answered with an error
  const blockArg = (v) => (v === "latest" ? latest : Number(BigInt(v)));
  async function rpc(method, params = []) {
    calls.push(method);
    if (method === "eth_chainId") return hex(chainId);
    if (method === "eth_blockNumber") return hex(latest);
    if (method === "eth_getTransactionCount") {
      if (String(params[0]).toLowerCase() !== me) return "0x0";
      const b = blockArg(params[1]);
      if (b < historyFloor) fail("missing trie node");
      return hex(rows.filter((r) => r.block <= b).length);
    }
    if (method === "eth_getBlockByNumber") {
      const b = blockArg(params[0]);
      return { number: hex(b), transactions: rows.filter((r) => r.block === b).map((r) => ({ hash: r.hash, from: me, to: r.to, nonce: hex(r.nonce), input: r.input, blockNumber: hex(b) })) };
    }
    if (method === "eth_getTransactionReceipt") {
      const r = rows.find((x) => x.hash === params[0]);
      return r ? { transactionHash: r.hash, from: me, to: r.to, status: hex(r.status), blockNumber: hex(r.block) } : null;
    }
    fail("method not found");
  }
  return { rpc, calls, rows };
}
