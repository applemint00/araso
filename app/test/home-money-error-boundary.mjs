// [A-454] Home Money 잔액 읽기 실패 시 원시 RPC 오류(URL·raw tx·주소·Request Arguments·
//   data)가 state/localStorage 어디에도 남지 않는지, 그리고 Send 카드 DOM에 주소가 새지
//   않는지 — 네트워크 0 · 브라우저 0 · main.js를 모듈로 import 0.
//   node app/test/home-money-error-boundary.mjs
// send-error-boundary.mjs 와 같은 방식: main.js 실제 소스를 잘라 스텁 위에서 실행(로직 재작성 0).
import { readFileSync } from "node:fs";
import { sendCardMarkup } from "../src/send-card.js";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  return SRC.slice(start, end);
}

const safeErrSrc = cut('const LAST_SEND_ERROR_KEY = "araso.lastSendError";', "\nfunction formatError(error) {");
const fetchHomeMoneySrc = cut("let homeMoneyRequestSeq = 0;", "\nfunction extractHomePaperInner(markup) {");
const renderSendStaySrc = cut("function renderSendStay() {", "\nfunction mountAway() {");

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) {
    console.log(`PASS  ${label}`);
    pass += 1;
  } else {
    console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    fail += 1;
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function mockStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => [...m.entries()],
  };
}

// 원시 거래/RPC 오류 흉내 — 이 문자열들이 state·localStorage 어디에도 남으면 안 된다.
const LEAK = {
  url: "https://testnet-rpc.monad.xyz",
  raw: "0x02f8b082279f",
  addr: "0x9C896a2a116C1D42CA815554EbeA311ddc918e56",
  args: "Request Arguments:",
  data: "data: 0x6e553f65",
};
function leakyRpcError() {
  const e = new Error(
    `Missing or invalid parameters. URL: ${LEAK.url} ${LEAK.args} from: ${LEAK.addr} ${LEAK.data} raw: ${LEAK.raw}`,
  );
  e.name = "InvalidParamsRpcError";
  e.code = -32602;
  return e;
}
const noLeak = (text) => Object.values(LEAK).every((v) => !String(text).includes(v));
// 실제 계정 주소는 오류 문자열 속 주소(LEAK.addr)와 다르게 둔다 — state.address 는 앱이
// 정당하게 아는 값이고, "새면 안 되는 것"은 오류가 실어온 낯선 원시 주소/URL/raw tx 쪽이다.
const REAL_ADDRESS = "0x1234567890123456789012345678901234567890";

function makeFetch({ address = REAL_ADDRESS, getBalanceThrows = false, readShmonThrows = false } = {}) {
  const storage = mockStorage();
  const calls = { getBalance: 0, readShmon: 0, refresh: 0 };
  const state = {
    address,
    homeMoneyStatus: "idle",
    homeMoneyErrorText: null,
    homeMoneyNativeWei: null,
    homeMoneyShmonWei: null,
  };
  const env = {
    localStorage: storage,
    state,
    refreshHomePaperMount: () => {
      calls.refresh += 1;
    },
    publicClient: {
      getBalance: async () => {
        calls.getBalance += 1;
        if (getBalanceThrows) throw leakyRpcError();
        return 1000000000000000n;
      },
    },
    readShmonBalance: async () => {
      calls.readShmon += 1;
      if (readShmonThrows) throw leakyRpcError();
      return 5n;
    },
  };
  const names = Object.keys(env);
  const factory = new Function(
    ...names,
    `${safeErrSrc}\n${fetchHomeMoneySrc}\nreturn { fetchHomeMoneyData, recordSafeError };`,
  );
  return { ...factory(...names.map((n) => env[n])), calls, storage, state };
}

// ── 1. getBalance 실패: 화면 문구는 null(기존 카피 사용), 안전 기록만, 원시 오류 0 ─────
{
  const t = makeFetch({ getBalanceThrows: true });
  await t.fetchHomeMoneyData();
  await tick();
  check("home-money getBalance fail: status error", t.state.homeMoneyStatus, "error");
  check("home-money getBalance fail: errorText null (기존 카피 사용)", t.state.homeMoneyErrorText, null);
  const rawRec = t.storage.getItem("araso.lastSendError");
  let rec = null;
  try {
    rec = JSON.parse(rawRec);
  } catch {
    /* below check will fail */
  }
  check("home-money getBalance fail: safe record is parseable object", rec !== null && typeof rec === "object", true);
  check(
    "home-money getBalance fail: safe record keys = at,category,code,phase only",
    rec ? Object.keys(rec).sort().join(",") : "",
    "at,category,code,phase",
  );
  check("home-money getBalance fail: phase = home-money", rec?.phase, "home-money");
  check("home-money getBalance fail: category = InvalidParamsRpcError", rec?.category, "InvalidParamsRpcError");
  check("home-money getBalance fail: code = -32602", rec?.code, "-32602");
  check("home-money getBalance fail: no leak strings in state", noLeak(JSON.stringify(t.state)), true);
  check("home-money getBalance fail: no leak strings in storage", noLeak(JSON.stringify(t.storage.dump())), true);
}

// ── 2. readShmonBalance 실패도 같은 안전 경로 ──────────────────────────────────────
{
  const t = makeFetch({ readShmonThrows: true });
  await t.fetchHomeMoneyData();
  await tick();
  check("home-money readShmon fail: status error", t.state.homeMoneyStatus, "error");
  check("home-money readShmon fail: errorText null", t.state.homeMoneyErrorText, null);
  const rec = JSON.parse(t.storage.getItem("araso.lastSendError"));
  check("home-money readShmon fail: phase = home-money", rec.phase, "home-money");
  check("home-money readShmon fail: no leak strings anywhere", noLeak(JSON.stringify({ s: t.state, d: t.storage.dump() })), true);
}

// ── 3. 성공 경로는 그대로 값이 들어간다(회귀 방지) ─────────────────────────────────
{
  const t = makeFetch({});
  await t.fetchHomeMoneyData();
  await tick();
  check("home-money success: status ready", t.state.homeMoneyStatus, "ready");
  check("home-money success: errorText null", t.state.homeMoneyErrorText, null);
  check("home-money success: nativeWei set", t.state.homeMoneyNativeWei, 1000000000000000n);
  check("home-money success: shmonWei set", t.state.homeMoneyShmonWei, 5n);
  check("home-money success: refreshHomePaperMount called", t.calls.refresh > 0, true);
}

// ── 4. Send 카드 소스 계약: sendCardMarkup({...}) 호출에 address: "" (주소 DOM 0) ────
{
  const call = renderSendStaySrc.indexOf("sendCardMarkup({");
  const callEnd = renderSendStaySrc.indexOf("})", call);
  const callBody = call >= 0 && callEnd >= 0 ? renderSendStaySrc.slice(call, callEnd) : "";
  check("source: renderSendStay calls sendCardMarkup(...)", callBody.length > 0, true);
  check("source: sendCardMarkup call passes address: \"\"", /address:\s*""/.test(callBody), true);
  check("source: sendCardMarkup call does NOT pass address: state.address", /address:\s*state\.address/.test(callBody), false);
}

// ── 5. send-card.js: address 가 비어 있으면 sendCard__address 노드 자체가 없다 ────────
{
  const withAddress = sendCardMarkup({ message: "m", detail: "d", address: LEAK.addr, terms: [] });
  const withoutAddress = sendCardMarkup({ message: "m", detail: "d", address: "", terms: [] });
  check("send-card: truthy address renders sendCard__address", withAddress.includes("sendCard__address"), true);
  check("send-card: empty address renders no sendCard__address node", withoutAddress.includes("sendCard__address"), false);
  check("send-card: empty address markup has no leak strings", noLeak(withoutAddress), true);
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
