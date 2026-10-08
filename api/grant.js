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
//
// [A-792] durable store 경계 — 위 이중 지급 창을 닫는 자리.
//   켜진(enabled) 경로는 이제 **durable grant store 가 명시적으로 구성되지 않으면 503 으로 닫힌다**(fail-closed).
//   store 계약(GRANT_STORE_CONTRACT) = 수취 주소 단위 원자적 exactly-once 예약 + 전역 상한(global cap) + 선택 allowlist.
//   운영용 durable 구현(벤더/백엔드)은 **아직 없다** — DURABLE_GRANT_STORE_BACKENDS 는 비어 있다(벤더 선택 = OPS/Owner).
//   그래서 오늘 production 에서 켜도 결과는 503 "grant store unavailable" 이다. 메모리 store 로 "exactly-once 인 척" 하지 않는다.
//   테스트는 createGrantHandler({ store, policy }) 로만 로컬 테스트 adapter 를 주입한다 — env/config 로는 닿을 수 없다.
//   예약은 첫 RPC·서명 이전이고, 예약 뒤 실패(송금 실패·revert·미확정·RPC 장애·이미 잔고 있음)에도 **자동 해제하지 않는다**
//   (= 자동 재지급 없음, fail-closed). 해제·재지급은 store 쪽 운영 절차의 몫이다(OPS 선택, WRITER_NOTES).
//
// [A-875] A-870 계약(api/_lib/grant-store-contract.js — A-882 이동) 연결 — 백엔드는 여전히 고르지 않는다(등록부 빈 값 유지).
//   - epoch: policy.epoch(코드 주입 또는 등록된 백엔드가 돌려준 policy 에서만). 생략 = DEFAULT_EPOCH("default") = A-792 의미 그대로.
//     reserve/settle 둘 다 같은 epoch 를 싣는다. 요청 body 로는 epoch 를 못 고른다(body 는 { address } 하나만 허용 → 그 외 400).
//   - cap: policy.globalCap 이 없고 allowlist 가 있으면 기본 cap = defaultGlobalCap(allowlist)(유효·중복 제거 개수).
//     allowlist 도 globalCap 도 없으면 여전히 null(= 503, 조용한 기본 cap 없음). 명시 globalCap 은 A-792 와 동일하게 그대로 쓴다.
//   - 이 핸들러는 store.reserve / store.settle 만 부른다. release·reconcile·re-arm(새 epoch) 은 **공개 /api/grant 경로에 없다**
//     (운영자 전용 별도 경로의 몫, 인증 인자 없음 — A-870 TERMINAL). 등록부 백엔드는 A-870 전체 모양(reserve/settle/release/reconcile)을 요구한다.
//   - settle 은 송금 시도 뒤 결과(send_failed/reverted/unconfirmed/confirmed)에 broadcast:true 증거를 싣는다 → A-870 decideRelease 가 release 를 거부.
//   - duplicate → 기존 403 "already funded" 그대로 · cap_reached → 503 "grant cap reached" 그대로. 지급액(0.1 MON) 무변경.

import { createPublicClient, createWalletClient, defineChain, isAddress, http as viemHttp, zeroAddress } from "viem";
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
import {
  DEFAULT_EPOCH,
  GRANT_STORE_CONTRACT_V1,
  defaultGlobalCap,
  isValidEpoch,
  isGrantStore as isFullContractGrantStore,
} from "./_lib/grant-store-contract.js";

/** Launch gate — 기본값은 **꺼짐**.
 *  durable ledger 가 없는 한 exact-once 는 만들 수 없으므로, 대신 "명시적으로 켜지 않으면 tx 자체가 없다" 로 막는다.
 *  env 이름은 **서버 전용**이다 — `VITE_` 접두사를 쓰면 클라이언트 번들에 구워지므로 절대 금지.
 *  허용값은 `1` / `true` 딱 둘. 그 외(미설정·오타·빈 문자열)는 전부 disabled = fail-closed.
 *  상태 표기: 꺼짐 = `HARDENED_DEFAULT` · 켜짐 = `STILL_PARTIAL_WHEN_ENABLED`(이중 지급 창은 그대로 남는다). */
export const GRANT_ENABLE_ENV = "ARASO_GRANT_ENABLED";

/** [A-895 P-C / A-882 R2] env 는 **자기 속성**으로만 읽는다 — process.env 도 Object.prototype 을 상속하므로, 오염된
 *  Object.prototype.ARASO_GRANT_ENABLED 가 launch gate 를 켜지 못한다. */
function ownEnv(env, k) {
  if (env === null || typeof env !== "object") return undefined;
  return Object.hasOwn(env, k) ? env[k] : undefined;
}

/** [A-895 P-C / A-882 R3] 객체 자신 또는 클래스 prototype 체인에서만 읽고 Object.prototype 은 건너뛴다(오염 무시 · 클래스 store 는 허용). */
function ownOrClass(obj, k) {
  if (obj === null || (typeof obj !== "object" && typeof obj !== "function")) return undefined;
  for (let o = obj; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    if (Object.hasOwn(o, k)) return o[k];
  }
  return undefined;
}

export function isGrantEnabled(env = process.env) {
  const raw = ownEnv(env, GRANT_ENABLE_ENV);
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** 수취 주소가 이미 이만큼 갖고 있으면 지급하지 않는다. 원장 대신 쓰는 무상태 판정값.
 *  불변식: GRANT_WEI ≥ GRANT_SKIP_BALANCE_WEI — 방금 받은 주소는 바로 다음 순차 요청에서 403 이 된다(a785 테스트).
 *  이건 "1주소 1회"가 아니다(쓰고 나면 다시 받는다 · 동시 요청 창은 그대로). */
export const GRANT_SKIP_BALANCE_WEI = 50_000_000_000_000_000n; // 0.05 MON

// ---- [A-792] durable grant store 계약 --------------------------------------------------------------
/** store 계약 식별자. 구현체는 `contract` 에 이 값을 정확히 싣고 아래 두 메서드를 가져야 한다.
 *
 *  reserve({ identity, globalCap }) → Promise<{ ok: true, reservationId: string }
 *                                           | { ok: false, reason: "duplicate" | "cap_reached" }>
 *    - identity = 소문자 수취 주소(0x + 40 hex). 같은 identity 는 store 수명 동안 **딱 한 번만** ok:true.
 *    - globalCap = 이 store 가 지금까지 내준 예약 총수의 상한(양의 정수). 총수 ≥ globalCap 이면 cap_reached.
 *    - 두 판정(중복·상한)과 삽입은 **하나의 원자적 연산**이어야 한다(동시 호출 N 개 중 같은 identity 는 최대 1 개,
 *      전체 ok 수는 최대 globalCap). 예약은 해제되지 않는 한 상한에 계속 센다.
 *    - 예외 = 판정 불가 → 핸들러는 503 으로 닫는다(RPC 0).
 *  settle({ identity, reservationId, outcome, txHash? }) → Promise<void>
 *    - 기록 전용. **슬롯을 풀지 않는다.** outcome ∈ GRANT_SETTLE_OUTCOMES.
 *    - 실패해도 응답은 바뀌지 않는다(이미 결과가 정해진 뒤다). 로그만 남긴다.
 *  testOnly(선택) = true 면 production 표지(VERCEL / NODE_ENV=production)가 보이는 환경에서 핸들러가 거부한다. */
export const GRANT_STORE_CONTRACT = GRANT_STORE_CONTRACT_V1; // [A-875] = "araso.grant-store/v1" (A-870 정본에서 가져온다)

/** [A-875] epoch 기본값 재수출(A-870 DEFAULT_EPOCH). */
export const GRANT_DEFAULT_EPOCH = DEFAULT_EPOCH;

/** 예약 뒤 기록되는 결과. 어느 것도 슬롯을 자동으로 풀지 않는다(자동 재지급 없음). */
export const GRANT_SETTLE_OUTCOMES = Object.freeze([
  "aborted_before_send", // 예약 뒤·송금 전에 멈춤(rpc 장애·chain mismatch·잔고 조회 실패·이미 잔고 있음·relayer 잔고 부족)
  "send_failed", // sendTransaction 예외 — 나갔는지 모른다
  "reverted", // receipt 가 실패
  "unconfirmed", // 나갔으나 확정 못 봄(504)
  "confirmed", // 성공
]);

/** production 이 고를 수 있는 durable 백엔드 등록부 — **비어 있다.** 벤더/백엔드 선택은 OPS/Owner 결정이고 이 카드 밖이다.
 *  항목을 넣으려면 코드 수정 + 리뷰가 필요하다. 메모리·파일·프로세스 로컬 store 는 여기 들어올 수 없다
 *  (서버리스 인스턴스는 상태를 공유하지 않으므로 exactly-once 를 거짓으로 주장하게 된다). */
export const DURABLE_GRANT_STORE_BACKENDS = Object.freeze({});

/** 서버 전용 env — 등록부의 백엔드 이름을 고른다. 등록부가 비어 있으므로 어떤 값이든 오늘은 "unknown" → 503. */
export const GRANT_STORE_ENV = "ARASO_GRANT_STORE";

const IDENTITY_RE = /^0x[0-9a-f]{40}$/;

/** policy 정규화. 잘못된 것은 전부 null(= fail-closed).
 *  globalCap: 양의 safe integer. 생략(undefined)이면 [A-875] allowlist 크기(defaultGlobalCap)가 기본 cap — allowlist 도 없으면 null.
 *    빈 allowlist 에서 나온 기본 cap 0 은 지급 불가 → null(503). 명시 globalCap 은 A-792 와 동일.
 *  allowlist: 없음(null/undefined) = 끔 · 배열 = 켬(빈 배열이면 전원 거부).
 *  epoch [A-875]: 생략 = DEFAULT_EPOCH. 있으면 A-870 isValidEpoch 통과 필수, 아니면 null.
 *  [A-882] 세 필드는 **자기 속성(own property)만** 읽는다 — 상속된 값(오염된 Object.prototype · Object.create 부모)은
 *    "생략"과 같다. 그래서 다른 곳의 prototype pollution 이 cap 을 키우거나 epoch/allowlist 를 고를 수 없다(A-875 REVIEW F1). */
export function normalizeGrantPolicy(policy) {
  if (!policy || typeof policy !== "object") return null;
  const own = (k) => (Object.hasOwn(policy, k) ? policy[k] : undefined);
  const rawEpoch = own("epoch");
  const rawAllowlist = own("allowlist");
  const rawCap = own("globalCap");
  const epoch = rawEpoch === undefined ? DEFAULT_EPOCH : rawEpoch;
  if (!isValidEpoch(epoch)) return null;
  let allowlist = null;
  if (rawAllowlist !== undefined && rawAllowlist !== null) {
    if (!Array.isArray(rawAllowlist)) return null;
    // [A-895 P-C / A-882 R1] sparse(구멍 있는) 배열 · 추가 속성이 붙은 배열은 거부 — 구멍이 prototype 값으로 채워지는 걸 막는다.
    if (Object.keys(rawAllowlist).length !== rawAllowlist.length) return null;
    const set = new Set();
    for (let i = 0; i < rawAllowlist.length; i += 1) {
      const a = rawAllowlist[i];
      if (typeof a !== "string" || !isAddress(a, { strict: false })) return null;
      set.add(a.toLowerCase());
    }
    allowlist = set;
  }
  let cap = rawCap;
  let capSource = "explicit";
  if (cap === undefined) {
    if (!allowlist) return null; // 조용한 기본 cap 없음
    cap = defaultGlobalCap([...allowlist]);
    capSource = "allowlist_size";
  }
  if (!Number.isSafeInteger(cap) || cap < 1) return null;
  return Object.freeze({ globalCap: cap, allowlist, epoch, capSource });
}

/** store 모양 검사(계약 식별자 + 두 메서드). 모양만 본다 — 원자성은 각 구현의 계약 테스트 몫이다. */
export function isGrantStore(store) {
  return (
    !!store &&
    typeof store === "object" &&
    ownOrClass(store, "contract") === GRANT_STORE_CONTRACT &&
    typeof ownOrClass(store, "reserve") === "function" &&
    typeof ownOrClass(store, "settle") === "function"
  );
}

function looksProduction(env) {
  return !!(ownEnv(env, "VERCEL") || ownEnv(env, "VERCEL_ENV") || ownEnv(env, "NODE_ENV") === "production");
}

/** production 경로의 store 해석. 반환 { ok:true, store, policy } | { ok:false, reason }.
 *  등록부가 비어 있으므로 오늘은 항상 ok:false 다. */
export function resolveProductionGrantStore(env = process.env) {
  const raw = ownEnv(env, GRANT_STORE_ENV);
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "grant store not configured" };
  const name = raw.trim();
  if (!Object.hasOwn(DURABLE_GRANT_STORE_BACKENDS, name)) return { ok: false, reason: "grant store backend unknown" };
  try {
    return acceptProductionGrantStoreBuild(DURABLE_GRANT_STORE_BACKENDS[name](env));
  } catch {
    return { ok: false, reason: "grant store init failed" };
  }
}

/** [A-875] 등록부 백엔드가 돌려준 { store, policy } 수락 판정(순수 함수, 네트워크 0).
 *  production 백엔드는 A-870 전체 계약 모양(reserve/settle/release/reconcile)을 가져야 한다 — 운영자 release/reconcile 경로가
 *  없는 store 는 받지 않는다. testOnly store 는 거부. policy 는 normalizeGrantPolicy(epoch·기본 cap 포함)를 통과해야 한다.
 *  핸들러는 여기서 수락된 store 에서도 reserve/settle 만 부른다. */
export function acceptProductionGrantStoreBuild(built) {
  const builtStore = ownOrClass(built, "store");
  const policy = normalizeGrantPolicy(ownOrClass(built, "policy"));
  // [A-895 P-C / A-882 R3] 모든 읽기는 자기 속성/클래스 체인만 본다. _lib 의 isGrantStore 는 그 뒤 2차 방어선이다.
  const full =
    !!builtStore && typeof builtStore === "object" &&
    ownOrClass(builtStore, "contract") === GRANT_STORE_CONTRACT_V1 &&
    ["reserve", "settle", "release", "reconcile"].every((m) => typeof ownOrClass(builtStore, m) === "function") &&
    isFullContractGrantStore(builtStore);
  if (!full || ownOrClass(builtStore, "testOnly") === true || !policy) {
    return { ok: false, reason: "grant store invalid" };
  }
  return { ok: true, store: builtStore, policy };
}

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
  const key = ownEnv(process.env, "RELAYER_PRIVATE_KEY");
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

// [A-785] 모든 응답은 이 함수 하나로 나간다 → Cache-Control: no-store 가 전 경로(405·503·4xx·5xx·200)에 붙는다.
function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

// [A-785] 요청 게이트 — **브라우저 악용 방어이지 인증이 아니다.** curl 은 이 헤더를 마음대로 쓴다.
// 목적: 제3자 웹페이지가 방문자 브라우저를 요청원으로 쓰는 것(99e M-K-12)을 막는다. Sybil/볼륨(99d H-4)은 못 막는다.
//
// 승인된 production origin 은 하나다(README · passkey rpId = arasoo.vercel.app). 바꾸려면 코드 수정으로만.
export const GRANT_ALLOWED_ORIGINS = Object.freeze(["https://arasoo.vercel.app"]);

/** Content-Type 은 정확히 application/json(파라미터 허용: `; charset=utf-8`). 그 외·부재 = 415.
 *  text/plain·urlencoded·multipart 는 CORS "단순 요청"이라 preflight 없이 cross-site 로 날아온다 — 이걸 닫는다. */
export function isJsonContentType(raw) {
  if (typeof raw !== "string") return false;
  return raw.split(";")[0].trim().toLowerCase() === "application/json";
}

/** Origin / Sec-Fetch-Site 판정. 반환 null = 통과, 문자열 = 거부 사유.
 *  - Sec-Fetch-Site 가 있으면 `same-origin` 만 통과(cross-site·same-site·none 거부).
 *  - Origin 이 있으면 GRANT_ALLOWED_ORIGINS 와 정확히 같거나 `null` 이어야 한다.
 *    `null` 을 허용하는 이유: vercel.json 의 `Referrer-Policy: no-referrer` 아래에서 같은 origin fetch POST 는
 *    Fetch 규격상 `Origin: null` 로 직렬화될 수 있다 — 막으면 Araso 자신의 호출이 깨질 수 있다.
 *    cross-site 가 `Origin: null` 을 만들려면 no-cors(→ JSON Content-Type 불가 → 415) 나 opaque origin 의
 *    cors 요청(→ JSON 이라 preflight → 이 함수는 CORS 헤더를 안 주므로 POST 자체가 안 온다) 뿐이다.
 *    그래도 Sec-Fetch-Site 가 cross-site 면 위에서 이미 거부된다.
 *  - 둘 다 없으면 = 비브라우저 호출(curl·스크립트) → **통과**. 이 헤더는 비브라우저가 위조할 수 있으므로
 *    부재를 막아도 얻는 보안이 없고, Sec-Fetch-Site 를 안 보내는 구형 브라우저의 Araso 호출만 깨진다.
 *    비브라우저 남용은 launch gate·잔고 판정·relayer 잔고·WAF rate-limit(운영 후속)의 몫이다. */
export function checkRequestOrigin(headers) {
  const h = headers ?? {};
  const site = h["sec-fetch-site"];
  if (site !== undefined) {
    if (typeof site !== "string" || site.trim().toLowerCase() !== "same-origin") return "cross-site request";
  }
  const origin = h.origin;
  if (origin !== undefined) {
    if (typeof origin !== "string") return "origin not allowed";
    if (origin !== "null" && !GRANT_ALLOWED_ORIGINS.includes(origin)) return "origin not allowed";
  }
  return null;
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

/** [A-792] 핸들러 공장. 인자 없이 부르면 production 경로(resolveProductionGrantStore) — 오늘은 켜도 503.
 *  `store`/`policy` 주입은 **코드에서만** 가능하다(테스트 전용). env·config 로는 주입 경로가 없다. */
export function createGrantHandler(options = {}) {
  const injected = options.store !== undefined;
  const injectedStore = options.store;
  const injectedPolicy = options.policy;

  function resolveStore(env) {
    if (!injected) return resolveProductionGrantStore(env);
    const policy = normalizeGrantPolicy(injectedPolicy);
    if (!isGrantStore(injectedStore) || !policy) return { ok: false, reason: "grant store invalid" };
    if (ownOrClass(injectedStore, "testOnly") === true && looksProduction(env)) return { ok: false, reason: "test store refused in production" };
    return { ok: true, store: injectedStore, policy };
  }

  return async function handler(req, res) {
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
    // [A-785] 정책 정규식 위에 viem isAddress(strict: 대소문자 섞이면 checksum 일치 필수)와 zero address 거부를 얹는다.
    // 전부 키 로드·RPC·tx 이전이다.
    if (!isAddress(address, { strict: true })) return respond(res, 400, { ok: false, error: "invalid address" });
    if (address.toLowerCase() === zeroAddress) return respond(res, 400, { ok: false, error: "invalid address" });
    const short = `${address.slice(0, 10)}…`; // 로그에는 주소 앞부분만. 키는 절대 안 나온다.

    let clients;
    try {
      clients = getClients();
    } catch {
      console.error("grant rejected(key missing)");
      return respond(res, 500, { ok: false, error: "relayer key unavailable" });
    }
    const { account, walletClient, publicClient } = clients;

    // [A-785] 요청 헤더 게이트 — getClients()(로컬 env 읽기·키 파싱, 네트워크 0) 뒤, 첫 RPC 이전.
    // 이 위치인 이유: 기존 relayer/test/grant-launch-gate.mjs 계약(헤더 없는 mock 요청 → body 400 / 키 부재 500)을
    // 그대로 지키면서도, 모든 거부가 체인 확인·잔고 조회·송금보다 앞에 오게 하기 위해서다.
    const headers = req.headers ?? {};
    if (!isJsonContentType(headers["content-type"])) {
      return respond(res, 415, { ok: false, error: "content-type must be application/json" });
    }
    const originError = checkRequestOrigin(headers);
    if (originError) {
      console.log(`grant rejected(${originError}) address=${short}`);
      return respond(res, 403, { ok: false, error: originError });
    }
    // relayer 자기 자신에게 보내는 지급은 거부(무의미한 tx·가스 소모).
    if (address.toLowerCase() === account.address.toLowerCase()) {
      return respond(res, 400, { ok: false, error: "invalid address" });
    }

    // [A-792] durable store 경계 — 모든 A-785 게이트 뒤, 첫 RPC·서명 이전.
    // ① store 미구성/무효 → 503 (RPC 0). 메모리 대체 없음.
    const resolved = resolveStore(process.env);
    if (!resolved.ok) {
      console.log(`grant rejected(${resolved.reason}) address=${short}`);
      return respond(res, 503, { ok: false, error: "grant store unavailable" });
    }
    const { store, policy } = resolved;
    const identity = address.toLowerCase();
    if (!IDENTITY_RE.test(identity)) return respond(res, 400, { ok: false, error: "invalid address" });
    // ② allowlist(켜졌을 때만) — 비회원은 예약·상한을 소모하지 않고 403.
    if (policy.allowlist && !policy.allowlist.has(identity)) {
      console.log(`grant rejected(not allowlisted) address=${short}`);
      return respond(res, 403, { ok: false, error: "not allowlisted" });
    }
    // ③ 원자적 예약(중복·상한을 store 가 한 번에 판정). 예약 성공 전에는 RPC·서명 0.
    let reservation;
    try {
      // [A-875] epoch 는 policy(코드/등록부)에서만 온다. 요청 body 는 { address } 외 필드를 400 으로 거부한다.
      reservation = await store.reserve({ identity, globalCap: policy.globalCap, epoch: policy.epoch });
    } catch {
      console.log(`grant rejected(store reserve failed) address=${short}`);
      return respond(res, 503, { ok: false, error: "grant store unavailable" });
    }
    if (!reservation || reservation.ok !== true || typeof reservation.reservationId !== "string" || reservation.reservationId === "") {
      const reason = reservation?.reason;
      if (reason === "duplicate") {
        // 앱(main.js requestGrant)은 403 "already funded" 를 "줄 필요 없음"으로 처리한다 — 같은 본문을 유지한다.
        console.log(`grant rejected(already reserved) address=${short}`);
        return respond(res, 403, { ok: false, error: "already funded" });
      }
      if (reason === "cap_reached") {
        console.log(`grant rejected(global cap reached) address=${short}`);
        return respond(res, 503, { ok: false, error: "grant cap reached" });
      }
      console.log(`grant rejected(store answer invalid) address=${short}`);
      return respond(res, 503, { ok: false, error: "grant store unavailable" });
    }
    const reservationId = reservation.reservationId;
    // 기록 전용. 슬롯은 풀지 않는다(자동 재지급 없음 = fail-closed). settle 실패는 응답을 바꾸지 않는다.
    // [A-875] epoch 를 함께 싣고, 송금 시도 뒤 결과에는 broadcast:true 증거를 붙인다(A-870 decideRelease → release 거부).
    // release / reconcile 은 여기서 부르지 않는다 — 운영자 전용 경로의 몫이다.
    const settle = async (outcome, txHash) => {
      const broadcast = outcome !== "aborted_before_send";
      try {
        await store.settle({ identity, epoch: policy.epoch, reservationId, outcome, ...(txHash ? { txHash } : {}), ...(broadcast ? { broadcast: true } : {}) });
      } catch {
        console.error(`grant settle failed(${outcome}) address=${short}`);
      }
    };

    // 체인 확인은 인스턴스당 1회. 다른 체인에 붙어 있으면 아무것도 보내지 않는다(fail-closed).
    if (!clients.chainChecked) {
      let chainId;
      try {
        chainId = await publicClient.getChainId();
      } catch {
        await settle("aborted_before_send");
        return respond(res, 502, { ok: false, error: "rpc unreachable" });
      }
      if (chainId !== CHAIN_ID) {
        console.error(`grant rejected(chain mismatch) rpc=${chainId} expected=${CHAIN_ID}`);
        await settle("aborted_before_send");
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
      await settle("aborted_before_send");
      return respond(res, 502, { ok: false, error: "balance check failed" });
    }

    // 원장 자리를 대신하던 판정 — 이미 가스가 있으면 두 번 주지 않는다(store 와 별개로 유지).
    if (recipientBalance >= GRANT_SKIP_BALANCE_WEI) {
      console.log(`grant rejected(already funded) address=${short}`);
      await settle("aborted_before_send");
      return respond(res, 403, { ok: false, error: "already funded" });
    }
    if (relayerBalance < RELAYER_MIN_BALANCE_WEI) {
      console.log(`grant rejected(insufficient relayer balance) address=${short}`);
      await settle("aborted_before_send");
      return respond(res, 503, { ok: false, error: "insufficient relayer balance" });
    }

    let txHash;
    try {
      txHash = await walletClient.sendTransaction({ to: address, value: GRANT_WEI, gas: GRANT_GAS });
    } catch {
      // 브로드캐스트 자체가 실패했다. tx 가 나갔는지 모르므로 자동 재시도는 하지 않는다. 예약도 풀지 않는다.
      console.log(`grant failed(send) address=${short}`);
      await settle("send_failed");
      return respond(res, 502, { ok: false, error: "grant failed" });
    }

    try {
      // broadcast ≠ 성공. receipt 까지 기다리고 revert 면 실패로 답한다.
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        console.log(`grant reverted address=${short} tx=${txHash}`);
        await settle("reverted", txHash);
        return respond(res, 502, { ok: false, error: "grant reverted", txHash });
      }
    } catch {
      // 이미 나간 tx 다. 확정을 못 봤을 뿐이므로 hash 를 함께 돌려주고 성공이라 부르지 않는다.
      console.log(`grant unconfirmed address=${short} tx=${txHash}`);
      await settle("unconfirmed", txHash);
      return respond(res, 504, { ok: false, error: "grant unconfirmed", txHash });
    }

    console.log(`grant confirmed address=${short} tx=${txHash}`);
    await settle("confirmed", txHash);
    return respond(res, 200, { ok: true, txHash });
  };
}

// production 기본 핸들러 — 주입 없음. durable store 가 등록·구성되지 않으면 켜져 있어도 503.
const handler = createGrantHandler();
export default handler;
