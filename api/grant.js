// Araso gas grant — Vercel Node 서버리스. 로컬 relayer(`relayer/src/server.mjs`)의 `/grant` 하나만 옮긴 것이다.
// 앱은 같은 origin 의 `/api/grant` 로 부른다(별도 호스트·CORS 없음).
//
// 로컬 서버와 다른 점 하나: **원장 파일이 없다.**
// 서버리스 인스턴스는 디스크도 프로세스도 공유하지 않으므로 `ledger.mjs` 의 reserve→confirm 을 그대로 쓸 수 없다.
// 대신 무상태 판정 하나로 대체한다 — **수취 주소 잔고가 GRANT_SKIP_BALANCE_WEI 이상이면 지급하지 않는다(403).**
// 한계를 과장하지 않는다:
//   - 이건 "1주소 1회"의 정확한 보장이 아니다. 사용자가 받은 걸 다 쓰면 다시 받을 수 있다(의도된 동작: 가스가 없으면 앱이 멈춘다).
//   - 동시에 들어온 두 요청은 서로의 잔고 변화를 못 본다 → 이중 지급 창이 남는다. 노출 상한은 그 창에서 GRANT_WEI 몇 배다.
//   - 진짜 상한은 relayer 지갑 잔고다. 그 이상은 못 나간다.
//
// 그래서 기본값을 바꿨다 — **`ARASO_GRANT_ENABLED` 로 명시적으로 켜지 않으면 tx 전에 503 으로 닫힌다.**
// 이건 race 를 고친 게 아니다. 위 한계(이중 지급 창)는 켜는 순간 그대로 돌아온다. 고친 것은 기본값뿐이다.
//   꺼짐 = HARDENED_DEFAULT · 켜짐 = STILL_PARTIAL_WHEN_ENABLED
//
// 키는 Vercel 서버 환경변수 `RELAYER_PRIVATE_KEY` 에서만 읽는다(`VITE_` 접두사 금지 — 그건 클라이언트 번들에 구워진다).
// 키는 응답·로그 어디에도 넣지 않는다.

import { createPublicClient, createWalletClient, defineChain, http as viemHttp } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHAIN_ID,
  GRANT_GAS,
  GRANT_WEI,
  MAX_BODY_BYTES,
  RELAYER_MIN_BALANCE_WEI,
  RPC_URL,
  validateGrantRequest,
} from "../relayer/src/policy.mjs";

/** Launch gate — 기본값은 **꺼짐**.
 *  durable ledger 가 없는 한 exact-once 는 만들 수 없으므로, 대신 "명시적으로 켜지 않으면 tx 자체가 없다" 로 막는다.
 *  env 이름은 **서버 전용**이다 — `VITE_` 접두사를 쓰면 클라이언트 번들에 구워지므로 절대 금지.
 *  허용값은 `1` / `true` 딱 둘. 그 외(미설정·오타·빈 문자열)는 전부 disabled = fail-closed.
 *  상태 표기: 꺼짐 = `HARDENED_DEFAULT` · 켜짐 = `STILL_PARTIAL_WHEN_ENABLED`(이중 지급 창은 그대로 남는다). */
export const GRANT_ENABLE_ENV = "ARASO_GRANT_ENABLED";

export function isGrantEnabled(env = process.env) {
  const raw = env?.[GRANT_ENABLE_ENV];
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** 수취 주소가 이미 이만큼 갖고 있으면 지급하지 않는다. 원장 대신 쓰는 무상태 판정값. */
const GRANT_SKIP_BALANCE_WEI = 50_000_000_000_000_000n; // 0.05 MON

const monadTestnet = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

// 인스턴스 안에서만 재사용되는 캐시(콜드 스타트마다 다시 만든다). 상태 공유가 아니라 연결 재사용이다.
let cached = null;

function getClients() {
  if (cached) return cached;
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) throw new Error("MISSING_RELAYER_PRIVATE_KEY");
  const account = privateKeyToAccount(key);
  const transport = viemHttp(RPC_URL);
  cached = {
    account,
    walletClient: createWalletClient({ account, chain: monadTestnet, transport }),
    publicClient: createPublicClient({ chain: monadTestnet, transport }),
    chainChecked: false,
  };
  return cached;
}

function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

/** 요청 body 를 객체로. Vercel 런타임이 미리 파싱했으면 그걸 쓰고, 아니면 상한을 걸고 직접 읽는다. */
async function readBody(req) {
  const pre = req.body;
  if (pre !== undefined && pre !== null && typeof pre !== "string" && !Buffer.isBuffer(pre)) {
    return { ok: true, value: pre };
  }
  let raw;
  if (typeof pre === "string" || Buffer.isBuffer(pre)) {
    raw = pre.toString();
  } else {
    raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "payload too large" };
    }
  }
  if (raw.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "payload too large" };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, error: "invalid json" };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return respond(res, 405, { ok: false, error: "method not allowed" });

  // launch gate — 켜져 있지 않으면 body 파싱·키 로드·RPC·tx 전부 안 한다. tx 이전에 끝난다.
  if (!isGrantEnabled()) {
    console.log("grant rejected(disabled by default)");
    return respond(res, 503, { ok: false, error: "grant disabled" });
  }

  const body = await readBody(req);
  if (!body.ok) return respond(res, body.status, { ok: false, error: body.error });

  // 검증 규칙은 로컬 relayer 와 같은 policy.mjs 를 그대로 쓴다 — 두 경로가 갈라지지 않게.
  const valid = validateGrantRequest(body.value);
  if (!valid.ok) return respond(res, 400, { ok: false, error: valid.error });
  const address = valid.address;
  const short = `${address.slice(0, 10)}…`; // 로그에는 주소 앞부분만. 키는 절대 안 나온다.

  let clients;
  try {
    clients = getClients();
  } catch {
    console.error("grant rejected(key missing)");
    return respond(res, 500, { ok: false, error: "relayer key unavailable" });
  }
  const { account, walletClient, publicClient } = clients;

  // 체인 확인은 인스턴스당 1회. 다른 체인에 붙어 있으면 아무것도 보내지 않는다(fail-closed).
  if (!clients.chainChecked) {
    let chainId;
    try {
      chainId = await publicClient.getChainId();
    } catch {
      return respond(res, 502, { ok: false, error: "rpc unreachable" });
    }
    if (chainId !== CHAIN_ID) {
      console.error(`grant rejected(chain mismatch) rpc=${chainId} expected=${CHAIN_ID}`);
      return respond(res, 500, { ok: false, error: "chain mismatch" });
    }
    clients.chainChecked = true;
  }

  let recipientBalance;
  let relayerBalance;
  try {
    [recipientBalance, relayerBalance] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.getBalance({ address: account.address }),
    ]);
  } catch {
    console.log(`grant rejected(balance check failed) address=${short}`);
    return respond(res, 502, { ok: false, error: "balance check failed" });
  }

  // 원장 자리를 대신하는 판정 — 이미 가스가 있으면 두 번 주지 않는다.
  if (recipientBalance >= GRANT_SKIP_BALANCE_WEI) {
    console.log(`grant rejected(already funded) address=${short}`);
    return respond(res, 403, { ok: false, error: "already funded" });
  }
  if (relayerBalance < RELAYER_MIN_BALANCE_WEI) {
    console.log(`grant rejected(insufficient relayer balance) address=${short}`);
    return respond(res, 503, { ok: false, error: "insufficient relayer balance" });
  }

  let txHash;
  try {
    txHash = await walletClient.sendTransaction({ to: address, value: GRANT_WEI, gas: GRANT_GAS });
  } catch {
    // 브로드캐스트 자체가 실패했다. tx 가 나갔는지 모르므로 자동 재시도는 하지 않는다.
    console.log(`grant failed(send) address=${short}`);
    return respond(res, 502, { ok: false, error: "grant failed" });
  }

  try {
    // broadcast ≠ 성공. receipt 까지 기다리고 revert 면 실패로 답한다.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      console.log(`grant reverted address=${short} tx=${txHash}`);
      return respond(res, 502, { ok: false, error: "grant reverted", txHash });
    }
  } catch {
    // 이미 나간 tx 다. 확정을 못 봤을 뿐이므로 hash 를 함께 돌려주고 성공이라 부르지 않는다.
    console.log(`grant unconfirmed address=${short} tx=${txHash}`);
    return respond(res, 504, { ok: false, error: "grant unconfirmed", txHash });
  }

  console.log(`grant confirmed address=${short} tx=${txHash}`);
  return respond(res, 200, { ok: true, txHash });
}
