// [A-451] 거래 오류 정보 차단 · grant 잔고 가시성 대기 · 준비 요청 형식 — 네트워크 0 · 브라우저 0 · 키 0.
//   node app/test/send-error-boundary.mjs
// send-lock.mjs 와 같은 방식: main.js 실제 소스를 잘라 스텁 위에서 실행(로직 재작성 0).
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`소스에서 못 찾음: ${startMarker}`);
  return SRC.slice(start, end);
}
const safeErrSrc = cut('const LAST_SEND_ERROR_KEY = "araso.lastSendError";', "\nfunction formatError(error) {");
const waitSrc = cut("const GRANT_VISIBLE_POLL_MS = 1000;", "\nasync function simulateSend(account) {");
const simSrc = cut("async function simulateSend(account) {", "\n// 바퀴의 결말은 둘이고");
const pendingConsts = cut('const SEND_PENDING_KEY = "araso.sendPending";', "\n\n");
const lockSrc = cut("let sendInFlight = false;", "\nasync function sendPiggyOnce(");
const onceSrc = cut("async function sendPiggyOnce(markSettling)", "\n// --- Second Journey");

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function mockStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), dump: () => [...m.entries()] };
}

// 원시 거래 오류 흉내 — 이 문자열들이 화면·저장 어디에도 남으면 안 된다.
const LEAK = {
  url: "https://testnet-rpc.monad.xyz",
  raw: "0x02f8b082279f80847735940085",
  addr: "0x9C896a2a116C1D42CA815554EbeA311ddc918e56",
  args: "Request Arguments:",
  data: "0x6e553f65",
};
function leakyError() {
  const e = new Error(`Missing or invalid parameters. URL: ${LEAK.url} Request body: {"params":["${LEAK.raw}"]} ${LEAK.args} from: ${LEAK.addr} data: ${LEAK.data}`);
  e.name = "InvalidParamsRpcError";
  e.code = -32602;
  return e;
}

function makeSend({ grantGranted = false, balances = [], simThrows = false, sendThrows = false }) {
  const storage = mockStorage();
  const calls = { scenes: [], sign: 0, sendTx: 0, sim: 0, balanceReads: 0 };
  const btn = { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  let bi = 0;
  const env = {
    localStorage: storage,
    document: { querySelector: (sel) => (sel === "#sendButton" ? btn : null) },
    state: { address: LEAK.addr, txHash: "", mark: "", grantTxHash: "" },
    isAllowedPiggyRpId: () => true,
    activeAccount: { address: LEAK.addr },
    activeSession: { signDigest: async () => { calls.sign += 1; return { compact: new Uint8Array([1]), recovery: 0 }; } },
    setScene: (...a) => { calls.scenes.push(a); btn.disabled = true; },
    recoverPiggy: async () => {}, noteRecoverSuccess() {}, noteRecoverFailure() {}, isCancelledAuthError: () => false,
    requestGrant: async () => ({ granted: grantGranted, txHash: grantGranted ? "0xgrant" : "" }),
    simulateSend: async () => { calls.sim += 1; if (simThrows) throw leakyError(); return { depositTx: {}, before: 1n, beforeShares: 0n }; },
    touchSession() {},
    createWalletClient: () => ({ sendTransaction: async () => { calls.sendTx += 1; if (sendThrows) throw leakyError(); return "0xhash"; } }),
    MONAD_TESTNET: { id: 10143 }, MONAD_TESTNET_RPC: "", http: () => ({}),
    crypto: { subtle: { digest: async () => new ArrayBuffer(32) } },
    TextEncoder, toHex: () => "00",
    waitForSuccess: async () => ({ status: "success", gasUsed: 1n, effectiveGasPrice: 1n, blockNumber: 1n }),
    readShmonBalance: async () => 5n,
    makeRedeemTx: () => ({}),
    publicClient: { estimateGas: async () => 1n, getBalance: async () => { calls.balanceReads += 1; return balances[Math.min(bi++, balances.length - 1)] ?? 0n; } },
    settleSend: async () => ({ outcome: "done", reason: "ok", receipt: null }),
    finishTrip: () => {},
    formatError: (e) => String(e),
    SEND_AMOUNT: 1000000000000000n,
    setTimeout: (fn) => { fn(); return 0; }, // 대기 간격만 즉시로(시계 조작은 테스트 스텁 안에서만)
  };
  const names = Object.keys(env);
  const factory = new Function(...names, `${safeErrSrc}\n${waitSrc}\n${pendingConsts}\n${lockSrc}\n${onceSrc}\nreturn { sendPiggy, recordSafeError, waitForGrantBalance };`);
  return { ...factory(...names.map((n) => env[n])), calls, storage, btn };
}
const noLeak = (text) => Object.values(LEAK).every((v) => !String(text).includes(v));

// ── 1. 카드 detail·안전 기록에 원시 거래 정보 0 ─────────────────────────────────
for (const [label, opts] of [["simulate", { simThrows: true }], ["send/deposit", { sendThrows: true }]]) {
  const t = makeSend(opts);
  await t.sendPiggy(); await tick();
  const scene = t.calls.scenes.at(-1);
  check(`${label} failure: card detail empty (no raw error)`, scene[2], "");
  check(`  ${label}: card title/detail contain no URL/raw tx/address/args/data`, noLeak(scene.join(" ")), true);
  const rec = JSON.parse(t.storage.getItem("araso.lastSendError"));
  check(`  ${label}: safe record keys = at,phase,category,code only`, Object.keys(rec).sort().join(","), "at,category,code,phase");
  check(`  ${label}: safe record has no leak strings`, noLeak(JSON.stringify(rec)), true);
  check(`  ${label}: category/code kept`, `${rec.category}/${rec.code}`, "InvalidParamsRpcError/-32602");
}
{
  const t = makeSend({});
  const rec = t.recordSafeError("x", { name: "bad name with spaces http://x", code: "0xdeadbeef raw" });
  check("unsafe name/code are dropped from the record", `${rec.category}/${rec.code}`, "Error/");
}

// ── 2. 새 grant 뒤 잔고 가시성 대기 ──────────────────────────────────────────────
{
  const t = makeSend({ grantGranted: true, balances: [0n, 0n, 1000000000000000n] });
  await t.sendPiggy(); await tick();
  check("new grant, balance 0→needed: polled until visible (3 reads)", t.calls.balanceReads, 3);
  check("  then simulate once", t.calls.sim, 1);
}
{
  const t = makeSend({ grantGranted: true, balances: [0n] });
  await t.sendPiggy(); await tick();
  check("new grant never visible: bounded (20 reads)", t.calls.balanceReads, 20);
  check("  simulate/sign/send 0", `${t.calls.sim}/${t.calls.sign}/${t.calls.sendTx}`, "0/0/0");
  check("  no pending left (Send usable)", t.storage.getItem("araso.sendPending"), null);
  check("  button re-enabled", t.btn.disabled, false);
  check("  safe record phase grant-visibility", JSON.parse(t.storage.getItem("araso.lastSendError")).phase, "grant-visibility");
}
{
  const t = makeSend({ grantGranted: false, balances: [0n] });
  await t.sendPiggy(); await tick(); await tick();
  check("already funded (no new grant): no balance wait", t.calls.balanceReads, 0);
  check("  proceeds to simulate", t.calls.sim, 1);
}

// ── 3. 준비 요청 형식(offline) — 값·주소는 보고용으로 저장하지 않는다 ────────────────
{
  const env = {
    publicClient: { getBalance: async () => 10n ** 18n, estimateGas: async () => 97768n, getGasPrice: async () => 102000000000n },
    readShmonBalance: async () => 0n,
    makeDepositTx: () => ({ to: "0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9", value: 1000000000000000n, data: "0x6e553f65" }),
    SEND_AMOUNT: 1000000000000000n,
    formatEther: String,
    MONAD_TESTNET: { id: 10143 },
  };
  const names = Object.keys(env);
  const simulateSend = new Function(...names, `${simSrc}\nreturn simulateSend;`)(...names.map((n) => env[n]));
  const plan = await simulateSend({ address: LEAK.addr });
  check("prepared: chainId 10143", plan.prepared.chainId, 10143);
  check("  to/value/data present", !!plan.depositTx.to && typeof plan.depositTx.value === "bigint" && /^0x[0-9a-f]+$/.test(plan.depositTx.data), true);
  check("  gas estimate kept", plan.prepared.gas, 97768n);
  check("  fee class recorded (no forced type)", `${plan.prepared.feeClass}/${typeof plan.prepared.gasPrice}`, "gasPrice/bigint");
}

// ── 4. 소스 계약: First Send 실패 경로에 formatError 원문 전달 0 ───────────────────
check("source: no formatError(...) passed to setScene", /setScene\([^)]*formatError\(/.test(SRC), false);
check("source: no error.message passed to setScene", /setScene\([^)]*error\.message/.test(SRC), false);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
