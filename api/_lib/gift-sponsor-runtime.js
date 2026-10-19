// [A-913] Gift sponsor runtime for the Vercel functions (api/gift-sponsor.js = request path, api/gift-sponsor-reconcile.js = Cron recovery path).
// Builds policy + store + chain adapter + sender + preflight + service + reconciler from server-side env. Default OFF: GIFT_SPONSOR_PRIVATE_KEY unset => null.
// The sponsor key lives only in server env (never VITE_), is read here once, and never appears in a log, response or ledger. All reads go through viem's public client.
// Numbers that are UNKNOWN are env-injected and fail closed when missing: gas units, buffer bps, lease seconds, escrow address. Nothing is defaulted to a price.

import { createPublicClient, defineChain, http as viemHttp, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  GIFT_SPONSOR_MAX_EXPIRY_SECONDS, GIFT_SPONSOR_PIN_TABLE, createGiftSponsorPolicy, createGiftSponsorService, openGiftSponsorLedger,
} from "../../relayer/src/gift-sponsor-service.mjs";
import { createPreflightGate } from "../../relayer/src/gift-sponsor-preflight.mjs";
import { createGiftSponsorReconciler } from "../../relayer/src/gift-sponsor-reconcile.mjs";
import { createVercelKvGiftSponsorStore } from "./gift-sponsor-kv-store.js";

/** Function max duration (seconds) declared in vercel.json for both sponsor functions. The sponsor lease must outlive it (a dead function frees the lease on expiry). */
export const SPONSOR_FUNCTION_MAX_DURATION_SECONDS = 60;

const ESCROW_READ_ABI = [
  { type: "function", name: "commits", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ name: "hash", type: "bytes32" }, { name: "blockNumber", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "gifts", inputs: [{ type: "bytes32" }], outputs: [{ name: "sender", type: "address" }, { name: "token", type: "address" }, { name: "amount", type: "uint256" }, { name: "expiry", type: "uint64" }, { name: "claimed", type: "bool" }, { name: "claimTokenHash", type: "bytes32" }], stateMutability: "view" },
  { type: "event", name: "Committed", inputs: [{ name: "giftId", type: "bytes32", indexed: true }, { name: "committer", type: "address", indexed: true }, { name: "commitHash", type: "bytes32", indexed: false }] }, // matches harness/gift-mainnet-fork-native GiftPiggyUSDC
];
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/** Read-only chain adapter (viem public client; no key). Nothing here sends a signed authorization to eth_call / eth_estimateGas except the redeem simulation
 *  (which carries none): state-override simulation is for the redeem only. */
export function createViemGiftSponsorChain({ publicClient, policy }) {
  const escrow = policy.escrow; const sponsor = policy.sponsorAddress;
  const getCommit = async (giftId, committer) => {
    const [hash, blockNumber] = await publicClient.readContract({ address: escrow, abi: ESCROW_READ_ABI, functionName: "commits", args: [giftId, committer] });
    return { hash, blockNumber };
  };
  return {
    async getGift(giftId) {
      const [senderAddr, token, amount, expiry, claimed, claimTokenHash] = await publicClient.readContract({ address: escrow, abi: ESCROW_READ_ABI, functionName: "gifts", args: [giftId] });
      return { exists: senderAddr.toLowerCase() !== ZERO_ADDR, claimed, sender: senderAddr, token, amount: BigInt(amount), expiry: BigInt(expiry), claimTokenHash };
    },
    getCode: async (address) => (await publicClient.getCode({ address })) ?? "0x",
    getNonce: (address) => publicClient.getTransactionCount({ address, blockTag: "latest" }).then(BigInt),
    getTimestamp: async () => (await publicClient.getBlock({ blockTag: "latest" })).timestamp,
    async simulate({ from, to, data, value, stateOverride }) {
      const so = stateOverride ? Object.entries(stateOverride).map(([address, o]) => ({ address, code: o.code })) : undefined;
      await publicClient.call({ account: from, to, data, value, ...(so ? { stateOverride: so } : {}) });
    },
    async waitBlockAfter(n) {
      for (let i = 0; i < 40; i += 1) { if ((await publicClient.getBlockNumber()) > BigInt(n)) return; await new Promise((r) => setTimeout(r, 400)); }
      throw new Error("NO_BLOCK_AFTER");
    },
    getCommit,
    async confirmCommit({ txHash, giftId, delegator, commitHash }) {
      const rc = await publicClient.getTransactionReceipt({ hash: txHash });
      if (rc.status !== "success") return false;
      const logged = rc.logs.some((l) => { try {
        if (l.address.toLowerCase() !== escrow) return false;
        const ev = parseEventLogs({ abi: ESCROW_READ_ABI, logs: [l], eventName: "Committed" })[0];
        return !!ev && ev.args.giftId === giftId && ev.args.committer.toLowerCase() === delegator.toLowerCase() && ev.args.commitHash === commitHash;
      } catch { return false; } });
      if (!logged) return false;
      return (await getCommit(giftId, delegator)).hash.toLowerCase() === commitHash.toLowerCase();
    },
    async getReceipt(hash) { try { const r = await publicClient.getTransactionReceipt({ hash }); return { status: r.status }; } catch { return null; } },
    async getSponsorNonces() {
      const [latest, pending] = await Promise.all([publicClient.getTransactionCount({ address: sponsor, blockTag: "latest" }), publicClient.getTransactionCount({ address: sponsor, blockTag: "pending" })]);
      return { latest: BigInt(latest), pending: BigInt(pending) };
    },
    getSponsorBalance: () => publicClient.getBalance({ address: sponsor }),
    /** Fee input for the per-Gift minimum deposit and the health floor (current gas price). Throws/zero => the service refuses (never a default price). */
    getFeePerGasWei: () => publicClient.getGasPrice(),
    /** [G10] the sender's gas deposit tx: a plain Piggy -> sponsor transfer identified by its hash, read from tx + receipt. null when unknown / pending. */
    async getGasDepositTx(hash) {
      const [tx, rc] = await Promise.all([publicClient.getTransaction({ hash }), publicClient.getTransactionReceipt({ hash })]);
      if (!tx || !rc) return null;
      return { from: tx.from, to: tx.to, value: tx.value, data: tx.input, status: rc.status };
    },
  };
}

/** Sponsor tx sender: the ONLY place the sponsor key signs. [F-1 / A-814 REVIEW F2] Everything viem would otherwise ask the RPC to fill is explicit and the tx is SIGNED LOCALLY and sent
 *  raw, so a Piggy-signed authorizationList reaches the network only inside eth_sendRawTransaction (the broadcast itself), never in eth_fillTransaction / eth_estimateGas / eth_call:
 *    gas   = policy gas units for the kind x (1 + gasBufferBps)  (Monad bills the gas LIMIT, so this is also what the sender's deposit covers)
 *    fees  = maxFeePerGas 2 x current gas price (a cap; the base fee is what is charged), maxPriorityFeePerGas 0
 *    nonce = the sponsor's PENDING transaction count (the lease already serializes drivers)
 *  install and revoke are type-4 (authorizationList); redeem and claim are plain type-2. value is always 0n. */
export function createViemGiftSponsorSender({ publicClient, account, policy }) {
  const unitsOf = { install: policy.gasUnits.install, redeem: policy.gasUnits.commit, revoke: policy.gasUnits.revoke, claim: policy.gasUnits.claim };
  const gasLimit = (kind) => { const u = unitsOf[kind]; if (typeof u !== "bigint") throw new Error("SPONSOR_UNKNOWN_KIND"); return (u * BigInt(10000 + policy.gasBufferBps) + 9999n) / 10000n; };
  return {
    address: account.address,
    async send({ kind, to, data, value, authorizationList }, { onBroadcast } = {}) {
      if (value !== 0n) throw new Error("SPONSOR_VALUE_NONZERO");
      const withAuth = kind === "install" || kind === "revoke";
      if (withAuth !== Array.isArray(authorizationList)) throw new Error("SPONSOR_AUTHORIZATION_SHAPE");
      const gas = gasLimit(kind);
      const [nonce, gasPrice] = await Promise.all([publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }), publicClient.getGasPrice()]);
      if (!(gasPrice > 0n)) throw new Error("SPONSOR_NO_FEE_INPUT");
      const tx = { chainId: policy.chainId, nonce, gas, maxFeePerGas: gasPrice * 2n, maxPriorityFeePerGas: 0n, to, data, value: 0n,
        ...(withAuth ? { type: "eip7702", authorizationList } : { type: "eip1559" }) };
      const serializedTransaction = await account.signTransaction(tx);
      const hash = await publicClient.sendRawTransaction({ serializedTransaction });
      try { await onBroadcast?.(hash); } catch { /* best effort */ }
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      return { txHash: hash, blockNumber: rc.blockNumber, status: rc.status === "success" ? "success" : "reverted" };
    },
  };
}

const posInt = (v) => (typeof v === "string" && /^[1-9][0-9]{0,15}$/.test(v) ? Number(v) : null);

/** Parse env. null when GIFT_SPONSOR_PRIVATE_KEY is absent (default OFF). Throws MISSING_x or BAD_x for anything else wrong, so a half-configured deploy never runs. */
export function readGiftSponsorEnv(env = process.env) {
  const key = env.GIFT_SPONSOR_PRIVATE_KEY;
  if (!key) return null;
  const need = (n) => { if (!env[n]) throw new Error(`MISSING_${n}`); return env[n]; };
  const parts = String(need("GIFT_SPONSOR_GAS_UNITS")).split(",").map((x) => x.trim());   // install,commit,revoke,claim (A-814 estimates 46429,174887,46382,<fork-measured claim>)
  if (parts.length !== 4 || parts.some((x) => !/^[1-9][0-9]{0,15}$/.test(x))) throw new Error("BAD_GIFT_SPONSOR_GAS_UNITS");
  const buf = need("GIFT_SPONSOR_GAS_BUFFER_BPS");
  if (!/^(0|[1-9][0-9]{0,3})$/.test(buf)) throw new Error("BAD_GIFT_SPONSOR_GAS_BUFFER_BPS");
  const lease = posInt(need("GIFT_SPONSOR_LEASE_SECONDS"));
  if (lease === null || lease <= SPONSOR_FUNCTION_MAX_DURATION_SECONDS) throw new Error("BAD_GIFT_SPONSOR_LEASE_SECONDS"); // must outlive the function
  // [F-6] optional rate limits (UNKNOWN numbers => disabled unless injected). All-or-nothing: a limit without its window (or a window without a limit) is a config error => OFF.
  const rl = { perIp: env.GIFT_SPONSOR_RATE_PER_IP, perGift: env.GIFT_SPONSOR_RATE_PER_GIFT, windowSeconds: env.GIFT_SPONSOR_RATE_WINDOW_SECONDS };
  let rate = null;
  if (rl.perIp || rl.perGift || rl.windowSeconds) {
    const w = posInt(rl.windowSeconds); const ip = rl.perIp ? posInt(rl.perIp) : null; const pg = rl.perGift ? posInt(rl.perGift) : null;
    if (w === null || (!ip && !pg) || (rl.perIp && ip === null) || (rl.perGift && pg === null)) throw new Error("BAD_GIFT_SPONSOR_RATE_LIMIT");
    rate = { perIp: ip, perGift: pg, windowSeconds: w };
  }
  return {
    rate, privateKey: key, rpcUrl: need("MONAD_RPC_URL"), escrow: need("GIFT_SPONSOR_ESCROW_ADDRESS"),
    gasUnits: { install: parts[0], commit: parts[1], revoke: parts[2], claim: parts[3] }, gasBufferBps: Number(buf),
    leaseSeconds: lease,
    revokeMaxFailures: env.GIFT_SPONSOR_REVOKE_MAX_FAILURES ? posInt(env.GIFT_SPONSOR_REVOKE_MAX_FAILURES) : null, revokeBackoffSeconds: env.GIFT_SPONSOR_REVOKE_BACKOFF_SECONDS ? posInt(env.GIFT_SPONSOR_REVOKE_BACKOFF_SECONDS) : null, // UNKNOWN numbers: unset => the first mined revoke failure is final
    inflightGraceSeconds: env.GIFT_SPONSOR_INFLIGHT_GRACE_SECONDS ? posInt(env.GIFT_SPONSOR_INFLIGHT_GRACE_SECONDS) : GIFT_SPONSOR_MAX_EXPIRY_SECONDS, // 300 = the expiry cap reused (pending Owner)
    kvUrl: env.KV_REST_API_URL ?? null, kvToken: env.KV_REST_API_TOKEN ?? null, ledgerDir: env.GIFT_SPONSOR_LEDGER_DIR ?? null,
  };
}

/** Assemble everything. `deps` lets tests inject clients/store/fetch; production passes nothing (viem clients + KV store from env). */
export function buildGiftSponsorRuntime(cfg, deps = {}) {
  const account = deps.account ?? privateKeyToAccount(cfg.privateKey);
  const chainDef = defineChain({ id: 143, name: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } });
  const transport = viemHttp(cfg.rpcUrl);
  const publicClient = deps.publicClient ?? createPublicClient({ chain: chainDef, transport });
  const T = GIFT_SPONSOR_PIN_TABLE;
  const policy = createGiftSponsorPolicy({
    chainId: 143, escrow: cfg.escrow, sponsorAddress: account.address, ...T.addresses, ...T.hashes[143],
    maxExpirySeconds: GIFT_SPONSOR_MAX_EXPIRY_SECONDS, gasUnits: cfg.gasUnits, gasBufferBps: cfg.gasBufferBps,
  });
  if (!policy) throw new Error("GIFT_SPONSOR_POLICY_INVALID");
  const store = deps.store ?? (cfg.kvUrl ? createVercelKvGiftSponsorStore({ url: cfg.kvUrl, token: cfg.kvToken, fetchImpl: deps.fetchImpl }) : (cfg.ledgerDir ? openGiftSponsorLedger(`${cfg.ledgerDir.replace(/\/+$/, "")}/gift-sponsor-ledger.json`) : null));
  if (!store) throw new Error("MISSING_GIFT_SPONSOR_STORE"); // KV_REST_API_URL + KV_REST_API_TOKEN (production) or GIFT_SPONSOR_LEDGER_DIR (local only)
  const log = deps.log ?? (() => {});
  const chain = deps.chain ?? createViemGiftSponsorChain({ publicClient, policy });
  const sponsor = deps.sponsor ?? createViemGiftSponsorSender({ publicClient, account, policy });
  const preflight = createPreflightGate({ policy, getCode: chain.getCode, log });
  const service = createGiftSponsorService({ ledger: store, policy, chain, sponsor, preflight, log, leaseSeconds: cfg.leaseSeconds, revokeMaxFailures: cfg.revokeMaxFailures, revokeBackoffSeconds: cfg.revokeBackoffSeconds });
  const reconciler = createGiftSponsorReconciler({ ledger: store, policy, chain, steps: service.steps, runExclusive: service.runExclusive, log, inflightGraceSeconds: cfg.inflightGraceSeconds, revokeBackoffSeconds: cfg.revokeBackoffSeconds });
  const rate = cfg.rate ?? null;
  /** Fixed-window per-IP / per-gift limiter on the store. true = allowed. Configured but the store cannot count => throws (the handler fails closed with 503). */
  const rateLimit = rate ? async ({ ip, giftId }) => {
    if (typeof store.hit !== "function") throw new Error("RATE_LIMIT_STORE_UNSUPPORTED");
    if (rate.perIp && (await store.hit(`ip:${ip}`, rate.windowSeconds)) > rate.perIp) return false;
    if (rate.perGift && /^0x[0-9a-f]{64}$/.test(String(giftId)) && (await store.hit(`gift:${giftId}`, rate.windowSeconds)) > rate.perGift) return false;
    return true;
  } : null;
  return { policy, chain, sponsor, store, preflight, service, reconciler, rateLimit };
}

let cached = null;
/** Warm-instance cache of the runtime (null when OFF). Misconfiguration throws every time (never a half-running sponsor). */
export function getGiftSponsorRuntime(env = process.env, deps = {}) {
  if (cached && !deps.noCache) return cached;
  const cfg = readGiftSponsorEnv(env);
  if (!cfg) return null;
  const rt = buildGiftSponsorRuntime(cfg, deps);
  if (!deps.noCache) cached = rt;
  return rt;
}
export function resetGiftSponsorRuntimeCache() { cached = null; }

// ── [A-946] Shared mainnet fork (Journey 2) — its own chain definition and policy, separate objects from the 143 runtime above ──
// The 143 code path above is unchanged. The fork copies mainnet state, so the same delegation contracts (addresses + code hashes) exist
// there: the fork pins are the 143 pins re-keyed to the fork id, passed as the policy's own `pins` table (relayer allowlist untouched).
// Not wired to any route yet (Gift on the fork = a later card). Its RPC is server config (an admin URL never reaches the browser bundle).
export const GIFT_SPONSOR_FORK_CHAIN_ID = 31337143; // = app/src/funding-context.js FORK_CHAIN_ID (pinned by app/test/a946 test)
export const GIFT_SPONSOR_FORK_PINS = Object.freeze({
  addresses: GIFT_SPONSOR_PIN_TABLE.addresses,
  hashes: Object.freeze({ [GIFT_SPONSOR_FORK_CHAIN_ID]: GIFT_SPONSOR_PIN_TABLE.hashes[143] }),
});

/** The fork's viem chain definition (never id 143). */
export function giftSponsorForkChainDef(rpcUrl) {
  return defineChain({ id: GIFT_SPONSOR_FORK_CHAIN_ID, name: "Monad mainnet fork", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
}

/** The fork policy: same checks as 143, fork id, fork pins table. null when anything is missing (same contract as createGiftSponsorPolicy). */
export function buildGiftSponsorForkPolicy({ escrow, sponsorAddress, gasUnits, gasBufferBps } = {}) {
  const T = GIFT_SPONSOR_FORK_PINS;
  return createGiftSponsorPolicy({
    chainId: GIFT_SPONSOR_FORK_CHAIN_ID, escrow, sponsorAddress, ...T.addresses, ...T.hashes[GIFT_SPONSOR_FORK_CHAIN_ID],
    maxExpirySeconds: GIFT_SPONSOR_MAX_EXPIRY_SECONDS, gasUnits, gasBufferBps,
  }, T);
}

// ── [A-961] Fork sponsor RUNTIME (local fork only) — its own env names, chain-id check and escrow-code pin; the 143 runtime above is unchanged ──
// Server env only (never VITE_; the fork escrow address enters through server config, never the build):
//   GIFT_SPONSOR_FORK_PRIVATE_KEY (unset => OFF) · GIFT_SPONSOR_FORK_RPC_URL · GIFT_SPONSOR_FORK_ESCROW_ADDRESS · GIFT_SPONSOR_FORK_GAS_UNITS ·
//   GIFT_SPONSOR_FORK_GAS_BUFFER_BPS · GIFT_SPONSOR_FORK_LEASE_SECONDS · GIFT_SPONSOR_FORK_LEDGER_DIR (+ the optional FORK_ revoke / grace names). No rate limiter on the fork (local only).
// The 143 names (GIFT_SPONSOR_PRIVATE_KEY, MONAD_RPC_URL, ...) are never read here, and the fork names are never read by the 143 runtime.
// No KV on the fork (file or injected store). Every send is preceded by: eth_chainId == 31337143 · escrow runtime keccak == the A-935 5-arg escrow · the five pins.
import { keccak256 } from "viem"; // (ESM imports are hoisted; kept inside this block so every line above stays byte-identical)
/** keccak256 of the A-935 5-arg escrow RUNTIME code (DEPLOY_PACKET: 5,301 bytes; no constructor, no immutables). */
export const GIFT_SPONSOR_FORK_ESCROW_RUNTIME_KECCAK = "0x17dd2f39734a57dc27ade3adbf463b61cabfcb5b108c7a6ece980e900b89c033";
const FORK_ENV_NAMES = Object.freeze({
  GIFT_SPONSOR_PRIVATE_KEY: "GIFT_SPONSOR_FORK_PRIVATE_KEY", MONAD_RPC_URL: "GIFT_SPONSOR_FORK_RPC_URL", GIFT_SPONSOR_ESCROW_ADDRESS: "GIFT_SPONSOR_FORK_ESCROW_ADDRESS",
  GIFT_SPONSOR_GAS_UNITS: "GIFT_SPONSOR_FORK_GAS_UNITS", GIFT_SPONSOR_GAS_BUFFER_BPS: "GIFT_SPONSOR_FORK_GAS_BUFFER_BPS", GIFT_SPONSOR_LEASE_SECONDS: "GIFT_SPONSOR_FORK_LEASE_SECONDS",
  GIFT_SPONSOR_LEDGER_DIR: "GIFT_SPONSOR_FORK_LEDGER_DIR", GIFT_SPONSOR_REVOKE_MAX_FAILURES: "GIFT_SPONSOR_FORK_REVOKE_MAX_FAILURES",
  GIFT_SPONSOR_REVOKE_BACKOFF_SECONDS: "GIFT_SPONSOR_FORK_REVOKE_BACKOFF_SECONDS", GIFT_SPONSOR_INFLIGHT_GRACE_SECONDS: "GIFT_SPONSOR_FORK_INFLIGHT_GRACE_SECONDS",
});

/** Fork env -> the same config shape as readGiftSponsorEnv (same parser, same fail-closed rules). null when GIFT_SPONSOR_FORK_PRIVATE_KEY is unset. */
export function readGiftSponsorForkEnv(env = process.env) {
  if (!env.GIFT_SPONSOR_FORK_PRIVATE_KEY) return null;
  const mapped = {};
  for (const [name, forkName] of Object.entries(FORK_ENV_NAMES)) if (env[forkName] !== undefined) mapped[name] = env[forkName];
  let cfg;
  try { cfg = readGiftSponsorEnv(mapped); } catch (e) { const m = String(e?.message || e); const name = Object.keys(FORK_ENV_NAMES).find((n) => m.endsWith(`_${n}`)); throw new Error(name ? `${m.slice(0, -name.length)}${FORK_ENV_NAMES[name]}` : m); }
  // [gift-fork] compared as the sponsor ADDRESS each key controls (a "0x" prefix, case or whitespace cannot hide the same key).
  // previous rule: String(env.GIFT_SPONSOR_PRIVATE_KEY).toLowerCase() === String(cfg.privateKey).toLowerCase()
  if (env.GIFT_SPONSOR_PRIVATE_KEY && sameSponsorKey(env.GIFT_SPONSOR_PRIVATE_KEY, cfg.privateKey)) throw new Error("GIFT_SPONSOR_FORK_KEY_IS_143_KEY");
  return { ...cfg, kvUrl: null, kvToken: null };
}

// [gift-fork] true when both values name the same key: same derived address, or (either one unparseable) the same 64 hex digits after "0x"/case/space
// normalisation. Fail closed: an unreadable pair that normalises equal is treated as the same key.
function sameSponsorKey(a, b) {
  const hex = (k) => String(k ?? "").trim().toLowerCase().replace(/^0x/, "");
  const addr = (k) => { try { return /^[0-9a-f]{64}$/.test(hex(k)) ? privateKeyToAccount(`0x${hex(k)}`).address.toLowerCase() : null; } catch { return null; } };
  const x = addr(a); const y = addr(b);
  if (x && y) return x === y;
  return hex(a) !== "" && hex(a) === hex(b);
}

/** Assemble the fork runtime: same service / steps / reconciler / route contract as the 143 runtime, fork chain + fork policy + fork-only preflight. */
export function buildGiftSponsorForkRuntime(cfg, deps = {}) {
  const account = deps.account ?? privateKeyToAccount(cfg.privateKey);
  const publicClient = deps.publicClient ?? createPublicClient({ chain: giftSponsorForkChainDef(cfg.rpcUrl), transport: viemHttp(cfg.rpcUrl) });
  const policy = buildGiftSponsorForkPolicy({ escrow: cfg.escrow, sponsorAddress: account.address, gasUnits: cfg.gasUnits, gasBufferBps: cfg.gasBufferBps });
  if (!policy) throw new Error("GIFT_SPONSOR_FORK_POLICY_INVALID");
  const store = deps.store ?? (cfg.ledgerDir ? openGiftSponsorLedger(`${cfg.ledgerDir.replace(/\/+$/, "")}/gift-sponsor-fork-ledger.json`) : null);
  if (!store) throw new Error("MISSING_GIFT_SPONSOR_FORK_STORE");
  const log = deps.log ?? (() => {});
  const chain = deps.chain ?? {
    ...createViemGiftSponsorChain({ publicClient, policy }),
    // Match the app's next-block window for admission and recovery on an idle fork.
    getTimestamp: async () => (await publicClient.getBlock({ blockTag: "pending" })).timestamp,
  };
  const sponsor = deps.sponsor ?? createViemGiftSponsorSender({ publicClient, account, policy });
  const readChainId = deps.readChainId ?? (() => publicClient.getChainId());
  const pins = createPreflightGate({ policy, getCode: chain.getCode, log });
  const say = (m) => { try { log(`gift-sponsor fork ${m}`); } catch { /* logger must not break flow */ } };
  const preflight = async () => {
    let id = null; try { id = Number(await readChainId()); } catch { id = null; }
    if (id !== GIFT_SPONSOR_FORK_CHAIN_ID) { say(`preflight FAILED chain_id ${id === null ? "unreadable" : id}`); return false; }
    let code = null; try { code = await chain.getCode(policy.escrow); } catch { code = null; }
    if (typeof code !== "string" || code.length <= 2 || keccak256(code) !== GIFT_SPONSOR_FORK_ESCROW_RUNTIME_KECCAK) { say("preflight FAILED escrow_code"); return false; }
    return pins();
  };
  preflight.status = pins.status;
  const service = createGiftSponsorService({ ledger: store, policy, chain, sponsor, preflight, log, leaseSeconds: cfg.leaseSeconds, revokeMaxFailures: cfg.revokeMaxFailures, revokeBackoffSeconds: cfg.revokeBackoffSeconds });
  const reconciler = createGiftSponsorReconciler({ ledger: store, policy, chain, steps: service.steps, runExclusive: service.runExclusive, log, inflightGraceSeconds: cfg.inflightGraceSeconds, revokeBackoffSeconds: cfg.revokeBackoffSeconds });
  return { policy, chain, sponsor, store, preflight, service, reconciler, rateLimit: null };
}
