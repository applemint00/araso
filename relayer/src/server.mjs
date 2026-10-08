// Araso relayer — 엔드포인트 정확히 3개: GET /health, POST /grant, POST /gift-gas([A-874], 기본 503).
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
import { createGiftGasService } from "./gift-gas-service.mjs";
import { createGiftSponsorRoute } from "./gift-sponsor-service.mjs";

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

// ─── [A-874] POST /gift-gas ─────────────────────────────────────────────────────────────────────────
// 라우트는 경계만 맡는다: 메서드·설정·Origin·Content-Type·크기·인증 훅 → 그 다음 A-869 서비스 handle() 에만 위임.
// 원장·체인·서명자는 직접 만지지 않는다(서비스 생성에 넘기기만). /grant 와 원장·정책·락을 공유하지 않는다.
// - 설정(ledger·policy·chain·signer) 중 하나라도 없으면 503(전송 0). main() 은 아무것도 연결하지 않으므로 기본 = 503.
// - 인증 훅 authorize(ctx) 는 주입식이며 기본 = 거부. 정확히 `true` 를 돌려줄 때만 통과, 예외·그 밖의 값 = 401.
//   공개 인증 방식(토큰·쿠키·서명 등)은 여기서 만들지 않는다 — Owner 게이트(A-869 RECEIPT).
// - Origin: 있으면 allowedOrigins 에 정확히 있어야 함("null" 포함 나머지 403). 없으면 비브라우저 호출로 보고
//   인증 훅만이 경계다(Origin 은 위조 가능 — A-865). Sec-Fetch-Site 가 cross-site/same-site 면 Origin 없이도 403.
// - CORS 헤더 없음, OPTIONS 미지원(405). 응답 = cache-control: no-store.
// - 본문: application/json 만, GIFT_GAS_MAX_BODY_BYTES 이하, UTF-8, 정확히 {giftId,to}(엄격 검사는 A-869 정책 모듈).
// - 로그 = 고정 코드만(헤더·본문·giftId 를 라우트가 찍지 않는다; 서비스 로그는 A-869 규칙 그대로).
export const GIFT_GAS_MAX_BODY_BYTES = 256;
// [A-895 P-C / A-874 R1,R2] 기본 데드라인. 호출자가 cfg.authTimeoutMs / cfg.bodyTimeoutMs 로 1..60000 안에서 조정.
export const GIFT_GAS_AUTH_TIMEOUT_MS = 3000;
export const GIFT_GAS_BODY_TIMEOUT_MS = 5000;
const GIFT_GAS_CT = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const ORIGIN_SHAPE = /^https?:\/\/[^\s/?#]+$/;
const denyAll = () => false;

function respondGiftGas(res, status, body, { close = false } = {}) {
  if (res.writableEnded || res.headersSent) return;
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (close) headers.connection = "close";
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

/**
 * @param {object | null} cfg
 * @param {object} cfg.ledger  openGiftGasLedger(...) 결과
 * @param {object} cfg.policy  createGiftGasPolicy(...) 결과(null = 미설정)
 * @param {object} cfg.chain   A-869 chain 인터페이스
 * @param {{ signNativeTransfer: Function }} cfg.signer
 * @param {(ctx: { method: string, url: string, headers: object }) => boolean | Promise<boolean>} [cfg.authorize]  기본 거부
 * @param {string[]} [cfg.allowedOrigins]  정확 일치 목록, 기본 없음
 * @param {number} [cfg.authTimeoutMs]  [A-895 P-C / A-874 R2] authorize 훅 데드라인(기본 3000ms). 넘기면 401 — 서명 0.
 * @param {number} [cfg.bodyTimeoutMs]  [A-895 P-C / A-874 R1] 인증 이후 body 수신 데드라인(기본 5000ms). 넘기면 408 — 서비스 호출 0.
 * @param {(msg: string) => void} [cfg.log]
 */
export function createGiftGasRoute(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const log = typeof c.log === "function" ? c.log : () => {};
  const say = (code) => { try { log(`gift-gas route ${code}`); } catch { /* logger must not break flow */ } };
  const authorize = typeof c.authorize === "function" ? c.authorize : denyAll;
  const origins = new Set(
    (Array.isArray(c.allowedOrigins) ? c.allowedOrigins : []).filter((o) => typeof o === "string" && ORIGIN_SHAPE.test(o)),
  );
  const configured = !!(
    c.ledger && typeof c.ledger.get === "function" && typeof c.ledger.isFailStopped === "function"
    && c.policy && typeof c.policy === "object"
    && c.chain && typeof c.chain === "object"
    && c.signer && typeof c.signer.signNativeTransfer === "function"
  );
  const service = configured
    ? createGiftGasService({ ledger: c.ledger, policy: c.policy, chain: c.chain, signer: c.signer, log })
    : null;

  const deadline = (v, dflt) => (Number.isSafeInteger(v) && v >= 1 && v <= 60000 ? v : dflt);
  const authTimeoutMs = deadline(c.authTimeoutMs, GIFT_GAS_AUTH_TIMEOUT_MS);
  const bodyTimeoutMs = deadline(c.bodyTimeoutMs, GIFT_GAS_BODY_TIMEOUT_MS);

  const reject = (res, status, error, code) => { say(code); respondGiftGas(res, status, { ok: false, error }, { close: true }); };

  return function giftGasRoute(req, res) {
    if (req.method !== "POST") return reject(res, 405, "method not allowed", "rejected(method)");
    if (!service) return reject(res, 503, "unavailable", "rejected(not configured)");

    const h = req.headers ?? {};
    const origin = h.origin;
    if (origin !== undefined && !origins.has(origin)) return reject(res, 403, "forbidden", "rejected(origin)");
    if (origin === undefined && h["sec-fetch-site"] !== undefined && !["same-origin", "none"].includes(h["sec-fetch-site"])) {
      return reject(res, 403, "forbidden", "rejected(fetch-site)");
    }
    if (typeof h["content-type"] !== "string" || !GIFT_GAS_CT.test(h["content-type"].trim())) {
      return reject(res, 415, "unsupported media type", "rejected(content-type)");
    }
    if (h["content-length"] !== undefined) {
      const n = /^[0-9]{1,6}$/.test(String(h["content-length"])) ? Number(h["content-length"]) : NaN;
      if (Number.isNaN(n)) return reject(res, 400, "bad_request", "rejected(content-length)");
      if (n > GIFT_GAS_MAX_BODY_BYTES) return reject(res, 413, "payload too large", "rejected(size)");
    }

    void (async () => {
      let allowed = false;
      let authTimer = null;
      try {
        // [A-874 R2] 훅이 끝내 settle 하지 않아도 연결을 붙잡지 않는다: 데드라인 초과 = 거부(401).
        const timeout = new Promise((resolve) => { authTimer = setTimeout(() => resolve(false), authTimeoutMs); });
        allowed = (await Promise.race([
          Promise.resolve(authorize(Object.freeze({ method: req.method, url: req.url, headers: Object.freeze({ ...h }) }))),
          timeout,
        ])) === true;
      } catch {
        allowed = false;
      } finally {
        if (authTimer !== null) clearTimeout(authTimer);
      }
      if (!allowed) return reject(res, 401, "unauthorized", "rejected(unauthorized)");

      const chunks = [];
      let size = 0;
      let closed = false;
      // [A-874 R1] 인증 이후 body 를 끝까지 못 받으면(slowloris) 데드라인에서 408 — 서비스 호출 0.
      const bodyTimer = setTimeout(() => {
        if (closed) return;
        closed = true;
        reject(res, 408, "request timeout", "rejected(body timeout)");
        req.destroy();
      }, bodyTimeoutMs);
      const stop = () => clearTimeout(bodyTimer);
      req.on("error", () => { closed = true; stop(); });
      req.on("close", () => { stop(); });
      req.on("data", (chunk) => {
        if (closed) return;
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += b.length;
        if (size > GIFT_GAS_MAX_BODY_BYTES) {
          closed = true;
          stop();
          reject(res, 413, "payload too large", "rejected(size)");
          req.destroy();
          return;
        }
        chunks.push(b);
      });
      req.on("end", () => {
        stop();
        if (closed) return;
        closed = true;
        void (async () => {
          let parsed;
          try {
            parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
          } catch {
            return reject(res, 400, "bad_request", "rejected(json)");
          }
          let out;
          try {
            out = await service.handle(parsed);
          } catch {
            out = null;
          }
          if (!out || !Number.isInteger(out.status) || typeof out.body !== "object" || out.body === null) {
            say("service_error");
            return respondGiftGas(res, 503, { ok: false, error: "unavailable" });
          }
          return respondGiftGas(res, out.status, out.body);
        })();
      });
    })();
  };
}

/**
 * @param {object} opts
 * @param {{ getBalance: () => Promise<bigint>, send: (args: { to: string, valueWei: bigint }) => Promise<string> }} opts.submitter
 * @param {ReturnType<typeof openLedger> | null} opts.ledger  null = 원장 로드 실패, /grant 전부 거부(fail-closed)
 * @param {string | null} opts.ledgerError  ledger 가 null 인 이유(응답에 담을 사유)
 * @param {(msg: string) => void} [opts.log]
 * @param {number | null} [opts.chainId]  [relayer safety] RPC 로 **검증된** chainId 만. 없으면 health ok:false.
 * @param {ReturnType<typeof createGrantPolicy>} [opts.policy]  [relayer safety] 실행 한정 지급 정책. null = /grant 전부 거부.
 * @param {Parameters<typeof createGiftGasRoute>[0]} [opts.giftGas]  [A-874] /gift-gas 구성. null/불완전 = /gift-gas 전부 503.
 */
export function createRelayServer({ submitter, ledger, ledgerError = null, log = () => {}, chainId = null, policy = null, giftGas = null, giftSponsor = null }) {
  const lock = createLock();
  // [A-874] /grant 와 상태(원장·정책·락) 공유 0. log 는 따로 주지 않으면 서버 log 를 쓴다.
  const giftGasRoute = createGiftGasRoute(giftGas && typeof giftGas === "object" && giftGas.log === undefined ? { ...giftGas, log } : giftGas);

  // [A-906] /gift-sponsor: default OFF (giftSponsor null => 503, 0 sends). Own ledger/policy; shares nothing with /grant or /gift-gas.
  const giftSponsorRoute = createGiftSponsorRoute(giftSponsor && typeof giftSponsor === "object" && giftSponsor.log === undefined ? { ...giftSponsor, log } : giftSponsor);

  return createHttpServer((req, res) => {
    if (req.url === "/gift-gas") return giftGasRoute(req, res);
    if (req.url === "/gift-sponsor") return giftSponsorRoute(req, res);

    if (req.url === "/health") {
      if (req.method !== "GET") return respond(res, 405, { ok: false, error: "method not allowed" });
      // [relayer safety] 검증 전·다른 chain 값으로 준비 성공을 말하지 않는다.
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
        // [relayer safety] 정책 없음·허용 주소 밖 = 지급 거부(send 호출 0).
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
          // [relayer safety] 원장 전체 상한(건수·금액) — lock 안에서 보므로 동시 다른 주소도 1건만.
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

/** [relayer safety] 실험 relayer 는 루프백에만 bind 한다 — host override 없음. */
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
    // [relayer safety] 다른 writer 가 같은 원장을 잡고 있으면 기동 자체를 거부한다(fail-closed, lock 자동삭제 0).
    if (String(e.message).startsWith("LEDGER_LOCKED")) throw e;
    // 원장이 손상돼 있어도 서버는 뜬다(health 는 살아있어야 운영자가 확인할 수 있다) —
    // 다만 /grant 는 전부 거부하고 사유를 응답에 담는다(fail-closed).
    ledgerError = e.message;
    console.error(`LEDGER_ERROR: ${e.message} — /grant will reject all requests`);
  }

  // [relayer safety] 실행 한정 허용 주소(쉼표 구분). 없거나 틀리면 정책 null → /grant 전부 403.
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
