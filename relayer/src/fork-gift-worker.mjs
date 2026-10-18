// Railway fork-only worker. No new signer: A-961 runtime + A-913 queue/steps.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createTransport, HttpRequestError, http as transport, isAddress, getAddress } from "viem";
import { readGiftSponsorForkEnv, buildGiftSponsorForkRuntime, giftSponsorForkChainDef } from "../../api/_lib/gift-sponsor-runtime.js";
import { createGiftSponsorRoute } from "./gift-sponsor-service.mjs";
import { openForkGiftJournal, readForkCheckpoint } from "./fork-gift-state.mjs";

export const FORK_GIFT_ORIGIN = "https://arasoo.vercel.app";
export const FORK_GIFT_PATH = "/gift-sponsor";
const FORK_ID = 31337143;
const unavailable = () => ({ status: 503, body: { ok: false, error: "unavailable_not_sent" } });
const bad = () => ({ status: 400, body: { ok: false, error: "bad_request" } });

export function forkGiftReadyMessage(sponsor) {
  if (typeof sponsor !== "string" || !isAddress(sponsor)) throw new Error("FORK_SPONSOR_ADDRESS_INVALID");
  return { type: "fork-gift-ready", sponsor: getAddress(sponsor) };
}

// One queue for ALL worker RPC: startup audit, runtime sends and reconciliation.
// 110ms leaves headroom below Guard's 20/s and 600/min loopback quotas.
export function forkGiftRpcTransport(url, { now = () => performance.now(), wallNow = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), fetchFn } = {}) {
  return (options) => {
    const base = transport(url, { retryCount: 0, timeout: 10000, batch: false, fetchFn,
      async onFetchResponse(response) {
        if (response.status !== 429) return;
        // Preserve HTTP status even when Guard returns a JSON-RPC error body.
        try { await response.body?.cancel(); } catch { /* no body needed */ }
        throw new HttpRequestError({ status: 429, headers: response.headers, url });
      },
    })(options);
    let tail = Promise.resolve(), next = 0;
    return createTransport({ key: "fork-gift-paced", name: "Fork Gift paced HTTP", type: "http", retryCount: 0,
      request(args, requestOptions) {
        const run = tail.then(async () => {
          for (let attempt = 0; ; attempt++) {
            while (now() < next) await sleep(Math.ceil(next - now()));
            next = now() + 110;
            try { return await base.request(args, { ...requestOptions, retryCount: 0 }); }
            catch (error) {
              // Only explicit Guard rejection is safe to retry; never replay an
              // ambiguous timeout/network/5xx send or a JSON-RPC execution error.
              if (!(error instanceof HttpRequestError) || error.status !== 429 || attempt >= 3) throw error;
              const header = error.headers?.get("retry-after")?.trim();
              let delay = 1000;
              if (header && /^\d+$/.test(header)) delay = Number(header) * 1000;
              else if (header && Number.isFinite(Date.parse(header))) delay = Math.max(0, Date.parse(header) - wallNow());
              // Long daily/closed-Guard waits fail closed, not an early retry.
              if (!Number.isFinite(delay) || delay > 60000) throw error;
              next = Math.max(next, now() + delay);
            }
          }
        });
        tail = run.catch(() => {});
        return run;
      },
    }, base.value);
  };
}

export function forkGiftWorkerEnv(env, stateDir, instanceId) {
  if (env.GIFT_SPONSOR_PRIVATE_KEY) throw new Error("MAINNET_KEY_FORBIDDEN_ON_FORK_HOST");
  const out = { PATH: env.PATH, NODE_ENV: "production", STATE_DIR: stateDir, GIFT_SPONSOR_FORK_INSTANCE_ID: instanceId };
  for (const [k, v] of Object.entries(env)) if (/^GIFT_SPONSOR_FORK_/.test(k)) out[k] = v;
  // Never allow a config override to replace the measured instance or durable path.
  out.GIFT_SPONSOR_FORK_INSTANCE_ID = instanceId;
  out.GIFT_SPONSOR_FORK_LEDGER_DIR = path.join(stateDir, "gift-sponsor");
  out.GIFT_SPONSOR_FORK_RPC_URL = "http://127.0.0.1:18549";
  return out;
}

export function forkJournalInspector(client, escrow) {
  const receipt = async (hash) => {
    try { return await client.getTransactionReceipt({ hash }); }
    catch (e) { if (e?.name === "TransactionReceiptNotFoundError") return null; throw e; }
  };
  return async (row) => {
    if (row.needsHuman) return "unknown";
    const confirmed = [row.registrationTx, row.plan?.depositTx, row.installTx, row.commitTx, row.revokeTx, row.claimTx].filter(Boolean);
    const hashes = [...confirmed, row.inflight?.txHash, row.revokeInflight?.txHash].filter(Boolean);
    // Even terminal rows are read, and every recorded hash must still exist.
    for (const hash of hashes) {
      const r = await receipt(hash);
      if (!r) return "absent";
      if (confirmed.includes(hash) && r.status !== "success") return "unknown";
      const block = await client.getBlock({ blockNumber: r.blockNumber });
      if (block.hash !== r.blockHash) return "unknown";
    }
    if (row.registrationTx) return "ok";
    if (!row.plan || row.inflight && !row.inflight.txHash || row.revokeInflight && !row.revokeInflight.txHash) return "unknown";
    if (row.state !== "RESERVED" && ![row.installTx, row.commitTx, row.revokeTx, row.claimTx, row.inflight?.txHash, row.revokeInflight?.txHash].some(Boolean)) return "unknown";
    if (row.state === "INSTALLED" || row.state === "REVOKED") {
      const code = (await client.getCode({ address: row.plan.delegation.delegator }) ?? "0x").toLowerCase();
      const expected = row.state === "REVOKED" ? "0x" : `0xef0100${row.plan.authorization.address.slice(2).toLowerCase()}`;
      if (code !== expected) return "unknown";
    }
    // A receipt remaining after a rollback is not enough: a committed row must
    // still have its commit effect, unless a claim consumed it.
    if (row.commitTx && row.state !== "CLAIMED") {
      const gift = await client.readContract({ address: escrow, abi: [{ type: "function", name: "gifts", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "bool" }, { type: "bytes32" }], stateMutability: "view" }], functionName: "gifts", args: [row.giftId] });
      if (!gift[4]) {
        const commit = await client.readContract({ address: escrow, abi: [{ type: "function", name: "commits", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bytes32" }, { type: "uint256" }], stateMutability: "view" }], functionName: "commits", args: [row.giftId, row.plan.delegation.delegator] });
        if (commit[0]?.toLowerCase() !== row.plan.commitHash?.toLowerCase()) return "unknown";
      }
    }
    if (row.state === "CLAIMED") {
      if (!row.claimTx) return "unknown";
      const r = await receipt(row.claimTx);
      if (r.status !== "success") return "unknown";
      const gift = await client.readContract({ address: escrow, abi: [{ type: "function", name: "gifts", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "bool" }, { type: "bytes32" }], stateMutability: "view" }], functionName: "gifts", args: [row.giftId] });
      if (gift[4] !== true) return "unknown";
    }
    return "ok";
  };
}

export function createForkGiftController({ runtime, instanceId, identityCheck, intervalMs, setTimer = setInterval, clearTimer = clearInterval }) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 60000) throw new Error("RECONCILE_INTERVAL_REQUIRED");
  let accepting = true, timer = null, recovering = false;
  const pending = new Set();
  const track = (fn) => { const p = Promise.resolve().then(fn); pending.add(p); p.then(() => pending.delete(p), () => pending.delete(p)); return p; };
  const handle = (body) => {
    if (!accepting || pending.size >= 8) return Promise.resolve(unavailable());
    return track(async () => {
      if (!body || typeof body !== "object" || Array.isArray(body)) return bad();
      const { forkInstanceId, escrowAddress, ...payload } = body;
      if (forkInstanceId !== instanceId || typeof escrowAddress !== "string" || escrowAddress.toLowerCase() !== runtime.policy.escrow) return bad();
      if (!(await identityCheck())) { accepting = false; return unavailable(); }
      // Registration has no signer; read-only registration still requires fork preflight.
      if (payload.action === "register_gas_tx") {
        if (!(await runtime.preflight())) return unavailable();
        return runtime.service.register(payload);
      }
      // [A-1407] Letter read has no signer and no gas; read-only like registration, so the same fork preflight (the escrow it reads is the checked one).
      if (payload.action === "read_letter") {
        if (!(await runtime.preflight())) return unavailable();
        return runtime.service.readLetter(payload); // same shape as api/gift-sponsor.js reading → rt.service.readLetter
      }
      if (Number(payload.authorization?.chainId) !== FORK_ID || Number(payload.revokeAuthorization?.chainId) !== FORK_ID) return bad();
      return runtime.service.handle(payload); // G1–G11 bind actual signed chain/escrow.
    }).catch(() => unavailable());
  };
  const recover = () => {
    if (!accepting || recovering) return Promise.resolve();
    recovering = true;
    return track(async () => {
      if (!(await identityCheck())) { accepting = false; return; }
      const report = await runtime.reconciler.run(); // SAME runtime.service.runExclusive queue
      if (!Array.isArray(report?.results) || report.results.some((r) => r.step === "HUMAN")) accepting = false;
    }).catch(() => { accepting = false; }).finally(() => { recovering = false; });
  };
  return {
    handle, recover,
    start() {
      timer = setTimer(() => { void recover(); }, intervalMs); timer.unref?.();
    },
    async drain() { accepting = false; if (timer) clearTimer(timer); await Promise.allSettled([...pending]); await runtime.service.runExclusive(async () => {}); runtime.store.close(); },
    status: () => ({ accepting, needsHuman: !accepting }),
  };
}

export function createForkGiftHttpHandler(controller, { perMinute, now = Date.now } = {}) {
  if (!Number.isSafeInteger(perMinute) || perMinute < 1) throw new Error("GIFT_RATE_REQUIRED");
  let window = -1, count = 0; // global bound; no attacker-controlled unbounded IP map
  const route = createGiftSponsorRoute({ service: { handle: controller.handle }, allowedOrigins: [FORK_GIFT_ORIGIN], authorize: () => true });
  return (req, res) => {
    const answer = (status) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ ok: false, error: "unavailable" })); req.resume(); };
    if (req.url !== FORK_GIFT_PATH) return answer(404);
    if (req.headers.origin !== FORK_GIFT_ORIGIN) return answer(403);
    if (req.method !== "POST") return answer(405);
    const w = Math.floor(now() / 60000); if (w !== window) { window = w; count = 0; }
    if (++count > perMinute) return answer(429);
    return route(req, res);
  };
}

export async function startForkGiftWorker(env = process.env) {
  const cfg = readGiftSponsorForkEnv(env);
  if (!cfg) throw new Error("FORK_GIFT_OFF");
  const stateDir = path.resolve(env.STATE_DIR || "/data");
  if (cfg.rpcUrl !== "http://127.0.0.1:18549" || cfg.ledgerDir !== path.join(stateDir, "gift-sponsor")) throw new Error("FORK_WORKER_LOCAL_ONLY");
  const checkpoint = readForkCheckpoint(path.join(stateDir, "fork-state.json"));
  const instanceId = env.GIFT_SPONSOR_FORK_INSTANCE_ID;
  if (checkpoint.forkInstanceId !== instanceId) throw new Error("FORK_INSTANCE_MISMATCH");
  const client = createPublicClient({ chain: giftSponsorForkChainDef(cfg.rpcUrl), transport: forkGiftRpcTransport(cfg.rpcUrl) });
  const identityCheck = async () => {
    const info = await client.request({ method: "araso_guardInfo", params: [] });
    return info?.guard === "araso-a949-public-guard" && info?.forkInstanceId === instanceId && Number(info.chainId) === FORK_ID && await client.getChainId() === FORK_ID;
  };
  if (!(await identityCheck())) throw new Error("FORK_INSTANCE_MISMATCH");
  if (await client.getBlockNumber() < BigInt(checkpoint.block)) throw new Error("FORK_CHECKPOINT_AHEAD");
  const store = await openForkGiftJournal({ dir: cfg.ledgerDir, checkpoint, inspect: forkJournalInspector(client, cfg.escrow) });
  try {
    const runtime = buildGiftSponsorForkRuntime(cfg, { publicClient: client, store, readChainId: async () => await identityCheck() ? FORK_ID : 0 });
    const readyMessage = forkGiftReadyMessage(runtime.sponsor.address);
    const controller = createForkGiftController({ runtime, instanceId, identityCheck, intervalMs: Number(env.GIFT_SPONSOR_FORK_RECONCILE_MS) });
    const server = http.createServer(createForkGiftHttpHandler(controller, { perMinute: Number(env.GIFT_SPONSOR_FORK_REQUESTS_PER_MINUTE) }));
    server.headersTimeout = 15000; server.requestTimeout = 15000;
    await controller.recover();
    if (!controller.status().accepting) throw new Error("FORK_RECOVERY_FAILED");
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(18551, "127.0.0.1", resolve); });
    try { controller.start(); } catch (e) { server.close(); throw e; }
    let stopping = false;
    const stop = async () => {
      if (stopping) return; stopping = true;
      server.close(); server.closeIdleConnections?.();
      await controller.drain(); // all sends finish; journal closes BEFORE parent snapshots
      process.send?.({ type: "fork-gift-drained" });
      process.exit(0);
    };
    process.on("message", (m) => { if (m?.type === "drain") void stop(); });
    process.on("SIGTERM", () => { void stop(); });
    process.on("SIGINT", () => { void stop(); });
    process.send?.(readyMessage);
    return { server, controller };
  } catch (e) { store.close(); throw e; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startForkGiftWorker().catch(() => { process.send?.({ type: "fork-gift-off", needsHuman: true }); process.exit(2); });
}
