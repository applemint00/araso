// [A-533 Lane A · R1] 새 기기에서는 만들기 전에 먼저 찾는다 — 네트워크 0 · 실제 Face ID 0.
//   node app/test/fresh-device-recovery.mjs
//
// main.js 의 startPiggyOpen() 을 실제 소스 그대로 잘라 vm 에서 돈다. checkPiggy/openPiggy 는 결과만 흉내 내는 대역.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const start = MAIN.indexOf("// [A-533 Lane A · R1] **새 기기에서는 만들기 전에 먼저 찾는다.**");
const end = MAIN.indexOf("async function checkPiggy() {");
assert.ok(start > 0 && end > start, "R1 구간 마커");
const SLICE = MAIN.slice(start, end);

function device({ credential = null, received = false, address = "", checkOutcomes = [] } = {}) {
  const calls = { check: 0, open: 0 };
  const state = { address, freshRecoveryTried: false };
  const outcomes = [...checkOutcomes];
  const ctx = {
    state,
    readCredential: () => credential,
    hasReceivedPiggy: () => received,
    checkPiggy: async () => { calls.check += 1; return outcomes.shift() ?? { ok: false, cancelled: false }; },
    openPiggy: async () => { calls.open += 1; return { created: true }; },
  };
  vm.createContext(ctx);
  vm.runInContext(`${SLICE}\nthis.startPiggyOpen = startPiggyOpen;`, ctx);
  return { startPiggyOpen: ctx.startPiggyOpen, state, calls };
}

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

await check("same device (any local marker) still recovers and never creates — A-389 unchanged", async () => {
  for (const marker of [{ credential: { credentialId: "x" } }, { received: true }, { address: "0x00000000000000000000000000000000000000c3" }]) {
    const d = device(marker);
    await d.startPiggyOpen();
    await d.startPiggyOpen();
    assert.deepEqual(d.calls, { check: 2, open: 0 }, JSON.stringify(marker));
  }
});

await check("fresh device + existing discoverable passkey → first tap recovers, no create", async () => {
  const d = device({ checkOutcomes: [{ ok: true }] });
  const out = await d.startPiggyOpen();
  assert.equal(out.ok, true);
  assert.deepEqual(d.calls, { check: 1, open: 0 });
});

await check("fresh device + user cancels the recovery prompt → no creation on that tap", async () => {
  const d = device({ checkOutcomes: [{ ok: false, cancelled: true }] });
  await d.startPiggyOpen();
  assert.equal(d.calls.open, 0);
  assert.equal(d.state.freshRecoveryTried, true);
});

await check("fresh device + no usable credential → first tap only tries recovery; creation happens only on the next explicit open", async () => {
  const d = device({ checkOutcomes: [{ ok: false, cancelled: false }] });
  await d.startPiggyOpen();
  assert.deepEqual(d.calls, { check: 1, open: 0 });
  await d.startPiggyOpen();                                   // 사용자가 다시 연다 = 새 Piggy 선택
  assert.deepEqual(d.calls, { check: 1, open: 1 });
});

await check("fresh device + unsupported / wrong credential (PRF unavailable) → still no auto-create", async () => {
  const d = device({ checkOutcomes: [{ ok: false, cancelled: false, reason: "prf_unavailable" }] });
  await d.startPiggyOpen();
  assert.equal(d.calls.open, 0);
});

await check("recovery and its helpers can never create a passkey", () => {
  const code = MAIN.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const body = (n) => { const i = code.indexOf(`function ${n}(`); return code.slice(i, code.indexOf("\n}\n", i)); };
  for (const fn of ["checkPiggy", "recoverPiggy"]) {
    assert.equal(body(fn).includes("createPasskeyWithPrfOutput"), false, fn);
    assert.equal(body(fn).includes("openPiggy("), false, fn);
  }
  assert.match(body("recoverPiggy"), /requestPrf\(null, \{ prfSalt \}\)/);   // 새 기기 = 발견 가능한 기존 패스키 요청
  assert.equal((code.match(/createPasskeyWithPrfOutput\(\{/g) || []).length, 1); // 생성은 openPiggy 한 곳뿐
});

await check("find-first stays explicit; A1156 persists a separate invite-scoped next choice, not the memory flag", () => {
  assert.match(SLICE, /const FRESH_DEVICE_RECOVERY_FIRST = true;/);
  assert.equal(/localStorage\.setItem\([^)]*fresh/i.test(MAIN), false);
});

console.log(`\n${pass}/${pass} PASS`);
