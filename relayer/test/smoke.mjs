// 가짜 submitter 로 /health, /grant 계약을 검증한다 — 네트워크·키·실 RPC·tx 접촉 0.
//   node relayer/test/smoke.mjs
// [relayer safety] 루프백 bind · 검증된 chainId health · 허용 주소/전체 상한 · 동시 다른 주소 · 재시작 상한 ·
//         원장 스키마 손상 · 동일 원장 writer 충돌 · 실패 예약 유지까지 fake 로만 잰다.
import { createRelayServer, listenLocal, BIND_HOST } from "../src/server.mjs";
import { openLedger } from "../src/ledger.mjs";
import { createGrantPolicy, CHAIN_ID } from "../src/policy.mjs";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = mkdtempSync(join(tmpdir(), "araso-relayer-"));
const ledgerPath = (name) => join(DIR, `${name}.json`);

// 명백한 가짜 주소 — 실주소를 픽스처로 쓰지 않는다(오타 1자로 39자리가 돼 케이스가 죽었던 이력).
const ADDR = `0x${"1".repeat(40)}`;
const ADDR2 = `0x${"2".repeat(40)}`;
const OUTSIDE = `0x${"3".repeat(40)}`;
const BAD_ADDR = "not-an-address";
const ONE = 1_000_000_000_000_000_000n;
const GRANT = 100_000_000_000_000_000n;
const DUMMY_HASH = `0x${"a".repeat(64)}`;

// 가짜 submitter — 호출을 기록만 하고 더미 해시를 돌려준다. fetch/http 없음.
function fakeSubmitter({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    getBalance: async () => 5n * ONE,
    send: async ({ to, valueWei }) => {
      sent.push({ to, valueWei });
      if (fail) throw new Error("fake broadcast failure");
      return DUMMY_HASH;
    },
  };
}

async function start(opts) {
  const server = createRelayServer(opts);
  const addr = await listenLocal(server, 0);
  const base = `http://127.0.0.1:${addr.port}`;
  return {
    server,
    addr,
    get: (p) => fetch(base + p),
    post: (p, body) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    stop: () => new Promise((r) => server.close(r)),
  };
}

const watchdog = setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(9);
}, 30000);

const results = [];
const check = (name, cond, got) =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  got=" + JSON.stringify(got)}`);
let r, j;

// ── A. 기본 계약(기존) + 루프백 bind + 검증된 chain health ────────────────────────────
{
  const sub = fakeSubmitter();
  const ledger = openLedger(ledgerPath("a"));
  const s = await start({ submitter: sub, ledger, chainId: CHAIN_ID, policy: createGrantPolicy(ADDR) });
  check("bind address is 127.0.0.1", s.addr.address === BIND_HOST && BIND_HOST === "127.0.0.1", s.addr);
  r = await s.get("/health"); j = await r.json();
  check("GET /health -> ok:true chainId 10143 (verified)", r.status === 200 && j.ok === true && j.chainId === 10143, j);
  r = await s.post("/grant", { address: BAD_ADDR }); j = await r.json();
  check("invalid address -> non-200 ok:false, no send", r.status !== 200 && j.ok === false && sub.sent.length === 0, j);
  r = await s.post("/grant", { address: ADDR, amount: "999" }); j = await r.json();
  check("client amount field -> rejected, no send", r.status === 400 && sub.sent.length === 0, j);
  r = await s.post("/grant", { address: ADDR }); j = await r.json();
  check("allowed address -> 200 ok:true + txHash", r.status === 200 && j.ok === true && j.txHash === DUMMY_HASH, j);
  check("  exactly 1 send, 0.1 MON", sub.sent.length === 1 && sub.sent[0].valueWei === GRANT, sub.sent);
  const led = JSON.parse(readFileSync(ledgerPath("a"), "utf8"));
  check("  ledger entry CONFIRMED with txHash", led.entries[ADDR.toLowerCase()]?.status === "CONFIRMED", led);
  r = await s.post("/grant", { address: ADDR }); j = await r.json();
  check("repeat same address -> already granted, no send", r.status === 409 && sub.sent.length === 1, j);
  r = await s.get("/nope");
  check("unknown path -> 404", r.status === 404, r.status);
  r = await s.get("/grant");
  check("GET /grant -> 405", r.status === 405, r.status);
  r = await s.post("/health", {});
  check("POST /health -> 405", r.status === 405, r.status);
  await s.stop();
  ledger.close();
}

// ── B. 검증 안 된 chain / 정책 없음 / 허용 밖 주소 ─────────────────────────────────────
{
  const sub = fakeSubmitter();
  const ledger = openLedger(ledgerPath("b"));
  const s = await start({ submitter: sub, ledger, chainId: null, policy: null });
  r = await s.get("/health"); j = await r.json();
  check("unverified chain -> health ok:false chainId null", j.ok === false && j.chainId === null, j);
  r = await s.post("/grant", { address: ADDR }); j = await r.json();
  check("no policy -> 403, no send", r.status === 403 && sub.sent.length === 0, j);
  await s.stop();
  const s2 = await start({ submitter: sub, ledger, chainId: 1, policy: createGrantPolicy(ADDR) });
  r = await s2.get("/health"); j = await r.json();
  check("wrong chain value -> health ok:false", j.ok === false && j.chainId === null, j);
  r = await s2.post("/grant", { address: OUTSIDE }); j = await r.json();
  check("address outside allowlist -> 403, no send", r.status === 403 && j.error === "address not allowed" && sub.sent.length === 0, j);
  await s2.stop();
  ledger.close();
  check("invalid allowlist string -> no policy", createGrantPolicy("0x123,") === null && createGrantPolicy("") === null, null);
}

// ── C. 전체 상한 · 동시 다른 주소 · 재시작 뒤 상한 유지 ────────────────────────────────
{
  const sub = fakeSubmitter();
  const policy = createGrantPolicy(`${ADDR},${ADDR2}`);
  let ledger = openLedger(ledgerPath("c"));
  let s = await start({ submitter: sub, ledger, chainId: CHAIN_ID, policy });
  const [r1, r2] = await Promise.all([s.post("/grant", { address: ADDR }), s.post("/grant", { address: ADDR2 })]);
  const codes = [r1.status, r2.status].sort();
  check("concurrent two allowed addresses -> exactly one 200, one 403 cap", codes[0] === 200 && codes[1] === 403, codes);
  check("  exactly 1 send total", sub.sent.length === 1, sub.sent.length);
  await s.stop();
  ledger.close();
  // 재시작: 같은 원장 파일로 새 인스턴스 — 상한이 durable 하게 유지되어야 한다.
  ledger = openLedger(ledgerPath("c"));
  s = await start({ submitter: sub, ledger, chainId: CHAIN_ID, policy });
  const other = sub.sent[0].to.toLowerCase() === ADDR.toLowerCase() ? ADDR2 : ADDR;
  r = await s.post("/grant", { address: other }); j = await r.json();
  check("after restart, other allowed address -> 403 total cap, no send", r.status === 403 && j.error === "total grant cap reached" && sub.sent.length === 1, j);
  await s.stop();
  ledger.close();
}

// ── D. 실패 예약 유지(자동 재시도 0) ────────────────────────────────────────────────
{
  const sub = fakeSubmitter({ fail: true });
  const ledger = openLedger(ledgerPath("d"));
  const s = await start({ submitter: sub, ledger, chainId: CHAIN_ID, policy: createGrantPolicy(ADDR) });
  r = await s.post("/grant", { address: ADDR }); j = await r.json();
  check("broadcast failure -> 502, reservation kept FAILED", r.status === 502 && ledger.get(ADDR)?.status === "FAILED", j);
  r = await s.post("/grant", { address: ADDR });
  check("  retry blocked (no auto retry), send attempts = 1", r.status === 409 && sub.sent.length === 1, sub.sent.length);
  await s.stop();
  ledger.close();
}

// ── E. 원장 스키마 손상 → fail-closed ───────────────────────────────────────────────
{
  const bad = [
    ["entries array", { version: 1, entries: [] }],
    ["bad amount", { version: 1, entries: { [ADDR.toLowerCase()]: { address: ADDR, amountWei: "-1", txHash: null, status: "PENDING", at: "x" } } }],
    ["bad status", { version: 1, entries: { [ADDR.toLowerCase()]: { address: ADDR, amountWei: "1", txHash: null, status: "OK", at: "x" } } }],
    ["address mismatch", { version: 1, entries: { [ADDR.toLowerCase()]: { address: ADDR2, amountWei: "1", txHash: null, status: "PENDING", at: "x" } } }],
  ];
  for (const [name, doc] of bad) {
    const p = ledgerPath(`e-${name.replace(/\s/g, "")}`);
    writeFileSync(p, JSON.stringify(doc));
    let err = "";
    try { openLedger(p); } catch (e) { err = e.message; }
    check(`schema ${name} -> LEDGER_SCHEMA throw`, err.startsWith("LEDGER_SCHEMA"), err);
    check(`  ${name}: failed open leaves no lock`, !existsSync(`${p}.lock`), existsSync(`${p}.lock`));
  }
  // 서버는 ledger null 이면 /grant 전부 거부(send 0).
  const sub = fakeSubmitter();
  const s = await start({ submitter: sub, ledger: null, ledgerError: "LEDGER_SCHEMA", chainId: CHAIN_ID, policy: createGrantPolicy(ADDR) });
  r = await s.post("/grant", { address: ADDR });
  check("ledger unavailable -> 500, no send", r.status === 500 && sub.sent.length === 0, r.status);
  await s.stop();
  // 기존 유효 원장은 그대로 열린다(호환).
  const ok = ledgerPath("e-valid");
  writeFileSync(ok, JSON.stringify({ version: 1, entries: { [ADDR.toLowerCase()]: { address: ADDR, amountWei: GRANT.toString(), txHash: DUMMY_HASH, status: "CONFIRMED", at: "x" } } }));
  let l = null;
  try { l = openLedger(ok); } catch { /* */ }
  check("existing valid ledger opens (compat)", !!l && l.has(ADDR) && l.count() === 1, !!l);
  l?.close();
}

// ── F. 동일 원장 writer 충돌 → fail-closed, stale lock 자동삭제 0 ──────────────────────
{
  const p = ledgerPath("f");
  const first = openLedger(p);
  let err = "";
  try { openLedger(p); } catch (e) { err = e.message; }
  check("second writer on same ledger -> LEDGER_LOCKED", err.startsWith("LEDGER_LOCKED"), err);
  first.close();
  check("  lock released on close", !existsSync(`${p}.lock`), existsSync(`${p}.lock`));
  writeFileSync(`${p}.lock`, "99999\n"); // 남은(stale 로 보이는) lock
  err = "";
  try { openLedger(p); } catch (e) { err = e.message; }
  check("  leftover lock is not auto-removed -> LEDGER_LOCKED", err.startsWith("LEDGER_LOCKED") && existsSync(`${p}.lock`), err);
}

clearTimeout(watchdog);
// 테스트용 임시 폴더만 정리 — 저장소에 흔적 남기지 않는다.
rmSync(DIR, { recursive: true, force: true });

console.log(results.join("\n"));
console.log(`\n${results.filter((x) => x.startsWith("PASS")).length}/${results.length} PASS`);
process.exit(results.some((x) => x.startsWith("FAIL")) ? 1 : 0);
