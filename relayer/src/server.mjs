// Araso relayer — 엔드포인트 정확히 2개: GET /health, POST /grant.
// 실제 tx 제출은 "submitter" 로 추상화해서 주입한다 — smoke 테스트는 가짜 submitter 로
// 네트워크·키 접촉 없이 서버 로직(검증·원장·상한·잠금)만 검증한다.
//
// 키는 process.env.RELAYER_PRIVATE_KEY 에서만 읽는다 — 로그·응답에 절대 넣지 않는다.

import { createServer as createHttpServer } from "node:http";
import { createPublicClient, createWalletClient, defineChain, http as viemHttp } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHAIN_ID,
  GRANT_GAS,
  GRANT_WEI,
  MAX_BODY_BYTES,
  RELAYER_MIN_BALANCE_WEI,
  RPC_URL,
  createGrantPolicy,
  validateGrantRequest,
} from "./policy.mjs";
import { createLock, openLedger } from "./ledger.mjs";

export const monadTestnet = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

function respond(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * @param {object} opts
 * @param {{ getBalance: () => Promise<bigint>, send: (args: { to: string, valueWei: bigint }) => Promise<string> }} opts.submitter
 * @param {ReturnType<typeof openLedger> | null} opts.ledger  null = 원장 로드 실패, /grant 전부 거부(fail-closed)
 * @param {string | null} opts.ledgerError  ledger 가 null 인 이유(응답에 담을 사유)
 * @param {(msg: string) => void} [opts.log]
 * @param {number | null} [opts.chainId]  [A-439] RPC 로 **검증된** chainId 만. 없으면 health ok:false.
 * @param {ReturnType<typeof createGrantPolicy>} [opts.policy]  [A-439] 실행 한정 지급 정책. null = /grant 전부 거부.
 */
export function createRelayServer({ submitter, ledger, ledgerError = null, log = () => {}, chainId = null, policy = null }) {
  const lock = createLock();

  return createHttpServer((req, res) => {
    if (req.url === "/health") {
      if (req.method !== "GET") return respond(res, 405, { ok: false, error: "method not allowed" });
      // [A-439] 검증 전·다른 chain 값으로 준비 성공을 말하지 않는다.
      const verified = chainId === CHAIN_ID;
      return respond(res, 200, { ok: verified, chainId: verified ? chainId : null, grantPolicy: !!policy });
    }

    if (req.url !== "/grant") {
      return respond(res, 404, { ok: false, error: "not found" });
    }
    if (req.method !== "POST") {
      return respond(res, 405, { ok: false, error: "method not allowed" });
    }

    let raw = "";
    let closed = false;

    req.on("data", (chunk) => {
      if (closed) return;
      if (raw.length + chunk.length > MAX_BODY_BYTES) {
        closed = true;
        respond(res, 413, { ok: false, error: "payload too large" });
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on("end", () => {
      if (closed) return;
      void (async () => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return respond(res, 400, { ok: false, error: "invalid json" });
        }

        const valid = validateGrantRequest(parsed);
        if (!valid.ok) {
          return respond(res, 400, { ok: false, error: valid.error });
        }
        const address = valid.address;
        const short = `${address.slice(0, 10)}…`; // 로그에는 주소 앞부분만, 키는 절대 안 나온다

        if (!ledger) {
          log(`grant rejected(ledger unavailable) address=${short}`);
          return respond(res, 500, { ok: false, error: `ledger unavailable: ${ledgerError ?? "unknown"}` });
        }
        // [A-439] 정책 없음·허용 주소 밖 = 지급 거부(send 호출 0).
        if (!policy) {
          log(`grant rejected(no grant policy) address=${short}`);
          return respond(res, 403, { ok: false, error: "no grant policy" });
        }
        if (!policy.allows(address)) {
          log(`grant rejected(address not allowed) address=${short}`);
          return respond(res, 403, { ok: false, error: "address not allowed" });
        }

        // read → check → reserve → send 를 통째로 직렬화 — 동시 요청의 이중 지급 차단.
        await lock(async () => {
          if (ledger.has(address)) {
            log(`grant rejected(already granted) address=${short}`);
            return respond(res, 409, { ok: false, error: "already granted" });
          }
          // [A-439] 원장 전체 상한(건수·금액) — lock 안에서 보므로 동시 다른 주소도 1건만.
          if (ledger.count() >= policy.maxGrants || ledger.totalWei() + GRANT_WEI > policy.totalCapWei) {
            log(`grant rejected(total cap reached) address=${short}`);
            return respond(res, 403, { ok: false, error: "total grant cap reached" });
          }

          let balance;
          try {
            balance = await submitter.getBalance();
          } catch {
            log(`grant rejected(balance check failed) address=${short}`);
            return respond(res, 502, { ok: false, error: "balance check failed" });
          }
          if (balance < RELAYER_MIN_BALANCE_WEI) {
            log(`grant rejected(insufficient relayer balance) address=${short}`);
            return respond(res, 503, { ok: false, error: "insufficient relayer balance" });
          }

          // 예약을 먼저 durable 하게 쓴다 — 이 write 가 실패하면 tx 는 나가지 않는다.
          try {
            ledger.reserve(address, GRANT_WEI);
          } catch (e) {
            log(`grant rejected(ledger reserve failed) address=${short}`);
            return respond(res, 502, { ok: false, error: "ledger write failed" });
          }

          try {
            const txHash = await submitter.send({ to: address, valueWei: GRANT_WEI });
            ledger.confirm(address, txHash);
            log(`grant confirmed address=${short} tx=${txHash}`);
            return respond(res, 200, { ok: true, txHash });
          } catch {
            // 실패해도 예약은 남긴다. tx 가 실제로 나갔는지 모르는 상태이므로 자동 재시도 금지.
            // 온체인 확인 후 원장을 손으로 정리하는 것이 유일한 해제 경로.
            try {
              ledger.fail(address);
            } catch {
              /* 원장 정리 실패는 삼킨다 — 예약은 이미 durable 하므로 상한은 유지된다 */
            }
            log(`grant failed address=${short} (reservation kept)`);
            return respond(res, 502, { ok: false, error: "grant failed" });
          }
        });
      })();
    });
  });
}

/** [A-439] 실험 relayer 는 루프백에만 bind 한다 — host override 없음. */
export const BIND_HOST = "127.0.0.1";
export function listenLocal(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, BIND_HOST, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

/** 실제 viem 기반 submitter. server.mjs 를 직접 실행할 때만 만든다 — smoke 는 가짜 submitter 를 쓴다. */
function createViemSubmitter({ walletClient, publicClient }) {
  return {
    getBalance: () => publicClient.getBalance({ address: walletClient.account.address }),
    send: async ({ to, valueWei }) => {
      const txHash = await walletClient.sendTransaction({ to, value: valueWei, gas: GRANT_GAS });
      // broadcast ≠ 성공 — receipt 확정까지 기다리고 revert 면 실패로 던진다.
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("TX_REVERTED");
      return txHash;
    },
  };
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

async function main() {
  // 키가 없으면 기동 자체를 거부한다(fail-closed).
  const account = privateKeyToAccount(readRequiredEnv("RELAYER_PRIVATE_KEY"));
  const transport = viemHttp(monadTestnet.rpcUrls.default.http[0]);
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport });
  const publicClient = createPublicClient({ chain: monadTestnet, transport });

  const chainId = await publicClient.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`CHAIN_MISMATCH: rpc=${chainId} expected=${CHAIN_ID}`);

  const ledgerPath = process.env.GRANT_LEDGER ?? ".grant-ledger.json";
  let ledger = null;
  let ledgerError = null;
  try {
    ledger = openLedger(ledgerPath);
  } catch (e) {
    // [A-439] 다른 writer 가 같은 원장을 잡고 있으면 기동 자체를 거부한다(fail-closed, lock 자동삭제 0).
    if (String(e.message).startsWith("LEDGER_LOCKED")) throw e;
    // 원장이 손상돼 있어도 서버는 뜬다(health 는 살아있어야 운영자가 확인할 수 있다) —
    // 다만 /grant 는 전부 거부하고 사유를 응답에 담는다(fail-closed).
    ledgerError = e.message;
    console.error(`LEDGER_ERROR: ${e.message} — /grant will reject all requests`);
  }

  // [A-439] 실행 한정 허용 주소(쉼표 구분). 없거나 틀리면 정책 null → /grant 전부 403.
  const policy = createGrantPolicy(process.env.ARASO_GRANT_ALLOWLIST ?? "");
  if (!policy) console.error("NO_GRANT_POLICY: ARASO_GRANT_ALLOWLIST missing/invalid — /grant will reject all requests");

  const submitter = createViemSubmitter({ walletClient, publicClient });
  const balance = await submitter.getBalance();

  const server = createRelayServer({ submitter, ledger, ledgerError, log: console.log, chainId, policy });
  const port = Number(process.env.PORT ?? 8787);
  const shutdown = () => {
    server.close(() => {
      ledger?.close(); // 자기 writer lock 만 푼다
      process.exit(0);
    });
    server.closeAllConnections?.(); // keep-alive 연결 때문에 종료가 늦어지지 않게
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  await listenLocal(server, port);
  console.log(`araso relayer on ${BIND_HOST}:${port} (chain ${chainId}, ledger ${ledgerPath}, allowlist ${policy ? policy.size : 0})`);
  console.log(`relayer address = ${account.address}`);
  console.log(`relayer balance = ${balance} wei`);
  if (balance < RELAYER_MIN_BALANCE_WEI) console.log("WARNING: underfunded — /grant will answer 503");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
