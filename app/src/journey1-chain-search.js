// Finds a Piggy's Journey 1 shMON deposit → redeem on Monad testnet when this device has no receipts (a recovered phone, a private tab).
// There is no indexer and eth_getLogs spans only 100 blocks, so it reads the account nonce at past blocks instead: the nonce at block B is
// how many txs the Piggy had sent by then, so a binary search finds the block that holds nonce k, and that block's tx list gives the hash.
// The server still verifies everything (api/_lib/fork-entry.js verifyJourney1); this only points at two hashes. Bounded by calls and time.
const ADDR_RE = /^0x[0-9a-f]{40}$/;
export const JOURNEY1_SELECTORS = Object.freeze({ deposit: "0x6e553f65", redeem: "0xba087652" }); // = verifyJourney1's selectors
const low = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const big = (v) => { try { return typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) ? BigInt(v) : null; } catch { return null; } };
const hex = (n) => "0x" + n.toString(16);
const wordAddr = (input, k) => { const w = low(input).slice(10 + 64 * k, 10 + 64 * (k + 1)); return /^0{24}[0-9a-f]{40}$/.test(w) ? `0x${w.slice(24)}` : null; };

class Stop extends Error { constructor(reason) { super(reason); this.reason = reason; } }

/**
 * -> { ok: true, depositTxHash, redeemTxHash } | { ok: false, reason }
 * reason: bad_input · wrong_chain · unreadable · too_few (under 2 txs) · out_of_window (older than the node's history) · not_found · limit
 * rpc(method, params) returns the result or throws; an error the node itself answered carries `answered: true` (a past-state read the
 * node no longer holds), anything else (network, timeout) stops the search as unreadable.
 */
export async function findJourney1Pointers({ rpc, address, target, chainId = 10143, maxCalls = 60, maxMs = 15000, now = () => Date.now() } = {}) {
  const me = low(address); const to = low(target);
  if (typeof rpc !== "function" || !ADDR_RE.test(me) || !ADDR_RE.test(to)) return { ok: false, reason: "bad_input" };
  const t0 = now(); let calls = 0;
  const call = async (method, params, { answeredAsNull = false } = {}) => {
    const left = maxMs - (now() - t0);
    if (calls >= maxCalls || left <= 0) throw new Stop("limit");
    calls += 1;
    let timer = null;
    try {
      return await Promise.race([rpc(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(new Stop("limit")), left); })]);
    } catch (e) {
      if (e instanceof Stop) throw e;
      if (answeredAsNull && e?.answered === true) return undefined;
      throw new Stop("unreadable");
    } finally { if (timer) clearTimeout(timer); }
  };
  const counts = new Map(); // block → nonce after that block; null = the node no longer holds that block's state
  const countAt = async (b) => {
    if (counts.has(b)) return counts.get(b);
    const c = big(await call("eth_getTransactionCount", [me, hex(b)], { answeredAsNull: true }));
    counts.set(b, c);
    return c;
  };
  const read = async (b) => { const c = await countAt(b); if (c === null) throw new Stop("unreadable"); return c; };
  // the block whose txs include nonce k: the first block where the count passes k (lo has count ≤ k, hi has count > k). The cache keeps
  // every probe, so after the first search the next nonce starts from blocks already close to it.
  const blockOf = async (k) => {
    let lo = -1n, hi = -1n;
    for (const [b, c] of counts) { if (c === null) continue; if (c <= k && b > lo) lo = b; if (c > k && (hi < 0n || b < hi)) hi = b; }
    while (hi - lo > 1n) { const mid = (lo + hi) / 2n; if ((await read(mid)) > k) hi = mid; else lo = mid; }
    return hi;
  };
  const blocks = new Map();
  const txAt = async (k) => {
    const b = await blockOf(k);
    if (!blocks.has(b)) blocks.set(b, await call("eth_getBlockByNumber", [hex(b), true]));
    const block = blocks.get(b);
    const tx = Array.isArray(block?.transactions) ? block.transactions.find((t) => t && low(t.from) === me && big(t.nonce) === k) : null;
    if (!tx) throw new Stop("unreadable");
    return tx;
  };
  const kind = (tx) => {
    if (low(tx.to) !== to) return null;
    const sel = low(tx.input).slice(0, 10);
    if (sel === JOURNEY1_SELECTORS.deposit && wordAddr(tx.input, 1) === me) return "deposit";
    if (sel === JOURNEY1_SELECTORS.redeem && wordAddr(tx.input, 1) === me && wordAddr(tx.input, 2) === me) return "redeem";
    return null;
  };
  const receipts = new Map();
  const succeeded = async (tx) => {
    if (!receipts.has(tx.hash)) receipts.set(tx.hash, low((await call("eth_getTransactionReceipt", [tx.hash]))?.status) === "0x1");
    return receipts.get(tx.hash);
  };
  try {
    const cid = big(await call("eth_chainId", []));
    if (cid === null) return { ok: false, reason: "unreadable" };
    if (cid !== BigInt(chainId)) return { ok: false, reason: "wrong_chain" };
    const latest = big(await call("eth_blockNumber", []));
    if (latest === null) return { ok: false, reason: "unreadable" };
    const total = await read(latest);
    if (total < 2n) return { ok: false, reason: "too_few" };
    // walk back (doubling) to a block before the first tx, or to the oldest block this node can still answer for
    let floor = null, good = latest, gone = null;
    for (let d = 1024n; ; d *= 2n) {
      const b = latest > d ? latest - d : 0n;
      const c = await countAt(b);
      if (c === null) { gone = b; break; }
      floor = c; good = b;
      if (c === 0n || b === 0n) break;
    }
    // the node's history ended between `gone` and `good`: a few halvings move the floor closer to that edge
    for (let i = 0; gone !== null && floor !== 0n && i < 4; i += 1) {
      const mid = (gone + good) / 2n;
      const c = await countAt(mid);
      if (c === null) gone = mid; else { floor = c; good = mid; }
    }
    if (floor === null || total - floor < 2n) return { ok: false, reason: "out_of_window" };
    // any succeeded deposit before a succeeded redeem is a pair the server accepts; failed txs in between are skipped
    const deposits = [];
    for (let k = floor; k < total; k += 1n) {
      const tx = await txAt(k);
      const what = kind(tx);
      if (what === "deposit") deposits.push(tx);
      else if (what === "redeem" && deposits.length && await succeeded(tx)) {
        for (let i = deposits.length - 1; i >= 0; i -= 1) if (await succeeded(deposits[i])) return { ok: true, depositTxHash: low(deposits[i].hash), redeemTxHash: low(tx.hash) };
      }
    }
    return { ok: false, reason: floor > 0n ? "out_of_window" : "not_found" };
  } catch (e) {
    return { ok: false, reason: e instanceof Stop ? e.reason : "unreadable" };
  }
}
