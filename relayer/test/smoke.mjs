// 가짜 submitter 로 /health, /grant 계약을 검증한다 — 네트워크·키 접촉 0.
//   node relayer/test/smoke.mjs
import { createRelayServer } from "../src/server.mjs";
import { openLedger } from "../src/ledger.mjs";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LEDGER = join(mkdtempSync(join(tmpdir(), "araso-relayer-")), "ledger.json");
rmSync(LEDGER, { force: true });

// 명백한 가짜 주소 — 실주소를 픽스처로 쓰지 않는다(오타 1자로 39자리가 돼 케이스가 죽었던 이력).
const ADDR = `0x${"1".repeat(40)}`;
const BAD_ADDR = "not-an-address";
const ONE = 1_000_000_000_000_000_000n;
const DUMMY_HASH = `0x${"a".repeat(64)}`;

// 가짜 submitter — 호출을 기록만 하고 더미 해시를 돌려준다. fetch/http 없음.
const sent = [];
const submitter = {
  getBalance: async () => 5n * ONE,
  send: async ({ to, valueWei }) => {
    sent.push({ to, valueWei });
    return DUMMY_HASH;
  },
};

const ledger = openLedger(LEDGER);
const server = createRelayServer({ submitter, ledger });
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const get = (path) => fetch(base + path);
const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const watchdog = setTimeout(() => {
  console.log("WATCHDOG_TIMEOUT");
  process.exit(9);
}, 30000);

const results = [];
const check = (name, cond, got) =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  got=" + JSON.stringify(got)}`);

let r, j;

// 1. GET /health -> 200 {ok:true}
r = await get("/health");
j = await r.json();
check("GET /health -> 200 {ok:true}", r.status === 200 && j.ok === true, j);

// 2. POST /grant invalid address -> reject, ok:false
r = await post("/grant", { address: BAD_ADDR });
j = await r.json();
check("invalid address -> non-200 ok:false", r.status !== 200 && j.ok === false, j);
check("  no tx sent for invalid address", sent.length === 0, sent.length);

// 3. POST /grant valid address -> ok:true + txHash, ledger CONFIRMED
r = await post("/grant", { address: ADDR });
j = await r.json();
check("valid address -> 200 ok:true + txHash", r.status === 200 && j.ok === true && j.txHash === DUMMY_HASH, j);
check("  exactly 1 tx sent, correct amount", sent.length === 1 && sent[0].to === ADDR && sent[0].valueWei === 100_000_000_000_000_000n, sent[0]);
const led1 = JSON.parse(readFileSync(LEDGER, "utf8"));
const entry1 = led1.entries[ADDR.toLowerCase()];
check("  ledger entry CONFIRMED with txHash", entry1?.status === "CONFIRMED" && entry1?.txHash === DUMMY_HASH, entry1);

// 4. same address repeat -> reject already granted, no ledger increase
r = await post("/grant", { address: ADDR });
j = await r.json();
check("repeat same address -> non-200 already granted", r.status !== 200 && j.ok === false && j.error === "already granted", j);
check("  no second tx sent", sent.length === 1, sent.length);
const led2 = JSON.parse(readFileSync(LEDGER, "utf8"));
check("  ledger entry count unchanged", Object.keys(led2.entries).length === 1, Object.keys(led2.entries).length);

// extra: other paths/methods -> 404/405, only two endpoints exist
r = await get("/nope");
check("unknown path -> 404", r.status === 404, r.status);
r = await get("/grant");
check("GET /grant -> 405 (POST only)", r.status === 405, r.status);
r = await post("/health", {});
check("POST /health -> 405 (GET only)", r.status === 405, r.status);

clearTimeout(watchdog);
await new Promise((res) => server.close(res));

// 테스트용 원장 정리 — 저장소에 흔적 남기지 않는다.
rmSync(LEDGER, { force: true });
rmSync(`${LEDGER}.tmp`, { force: true });
if (existsSync(LEDGER)) console.log("WARNING: ledger file survived cleanup");

console.log(results.join("\n"));
console.log(`\n${results.filter((x) => x.startsWith("PASS")).length}/${results.length} PASS`);
process.exit(results.some((x) => x.startsWith("FAIL")) ? 1 : 0);
