// [A-466 B3] /api/grant launch gate — 오프라인 테스트. 네트워크·실제 키 0.
// 묻는 것 둘:
//   ① opt-in env 가 없으면 tx 전에 닫히는가 (HARDENED_DEFAULT)
//   ② 켰을 때 기존 검증(메서드·body schema·주소 형식·키 부재)이 그대로 남아 있는가 (회귀)
// 켠 상태에서도 exact-once 는 주장하지 않는다 — 동시 요청 이중 지급 창은 그대로다(STILL_PARTIAL_WHEN_ENABLED).

import assert from "node:assert/strict";
import handler, { GRANT_ENABLE_ENV, isGrantEnabled } from "../../api/grant.js";

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ok  ${name}`);
}

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
  return res;
}

function makeReq(method, body) {
  // Vercel 이 body 를 미리 파싱하지 않은 경우를 위해 스트림 인터페이스도 흉내낸다(빈 스트림).
  return {
    method,
    body,
    async *[Symbol.asyncIterator]() {},
  };
}

async function call(method, body) {
  const res = makeRes();
  await handler(makeReq(method, body), res);
  return res;
}

const ADDR = "0x1111111111111111111111111111111111111111";

async function withEnv(values, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(values)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// --- env 이름 자체의 계약 -------------------------------------------------
assert.equal(GRANT_ENABLE_ENV.startsWith("VITE_"), false, "opt-in env must never be VITE_ prefixed");
ok("opt-in env is server-only (no VITE_ prefix)");

// --- isGrantEnabled 판정표 ------------------------------------------------
for (const raw of [undefined, "", "  ", "0", "false", "no", "yes", "TRUE ".slice(0, 2), "enabled", "1 1"]) {
  assert.equal(isGrantEnabled({ [GRANT_ENABLE_ENV]: raw }), false, `must stay disabled for ${JSON.stringify(raw)}`);
}
for (const raw of ["1", "true", "TRUE", " true ", "True"]) {
  assert.equal(isGrantEnabled({ [GRANT_ENABLE_ENV]: raw }), true, `must enable for ${JSON.stringify(raw)}`);
}
assert.equal(isGrantEnabled({}), false);
assert.equal(isGrantEnabled(undefined), false);
ok("isGrantEnabled is fail-closed for everything but 1/true");

// --- ① disabled by default ------------------------------------------------
await withEnv({ [GRANT_ENABLE_ENV]: undefined, RELAYER_PRIVATE_KEY: undefined }, async () => {
  const res = await call("POST", { address: ADDR });
  assert.equal(res.statusCode, 503, "valid request must still be refused while disabled");
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, "grant disabled");
  assert.equal("txHash" in res.body, false, "disabled path must never carry a tx hash");
});
ok("disabled by default: valid request refused before any tx");

// 켜는 시늉(오타·거짓값)으로는 열리지 않는다.
for (const raw of ["0", "false", "yes", ""]) {
  await withEnv({ [GRANT_ENABLE_ENV]: raw, RELAYER_PRIVATE_KEY: undefined }, async () => {
    const res = await call("POST", { address: ADDR });
    assert.equal(res.statusCode, 503, `env=${JSON.stringify(raw)} must not open the gate`);
  });
}
ok("near-miss env values do not open the gate");

// 메서드 게이트는 launch gate 보다 앞이다.
await withEnv({ [GRANT_ENABLE_ENV]: undefined }, async () => {
  const res = await call("GET", undefined);
  assert.equal(res.statusCode, 405);
});
ok("non-POST still 405 while disabled");

// --- ② enabled 경로의 기존 validation 회귀 --------------------------------
// 키는 일부러 비운다 → 검증을 통과한 요청은 RPC 이전에 500 으로 멈춘다(네트워크 0).
await withEnv({ [GRANT_ENABLE_ENV]: "1", RELAYER_PRIVATE_KEY: undefined }, async () => {
  const bad = [
    [undefined, "invalid json"], // 파싱된 body 도 없고 스트림도 비어 있다 → 거부
    [null, "invalid json"],
    ["not-an-object", "invalid json"],
    ["[1,2,3]", "invalid address"],
    ["3", "body must be an object"],
    [{}, "invalid address"],
    [{ address: "0xdeadbeef" }, "invalid address"],
    [{ address: ADDR.toUpperCase() }, "invalid address"], // 0X… prefix is not accepted
    [{ address: ADDR, amount: "999" }, "unexpected fields"],
    [{ address: ADDR, chainId: 1 }, "unexpected fields"],
    ["x".repeat(2000), null], // over MAX_BODY_BYTES
  ];
  for (const [body, expected] of bad) {
    const res = await call("POST", body);
    assert.ok([400, 413].includes(res.statusCode), `expected 400/413 for ${String(JSON.stringify(body)).slice(0, 40)}, got ${res.statusCode}`);
    assert.equal(res.body.ok, false);
    if (expected) assert.equal(res.body.error, expected);
  }

  const res = await call("POST", { address: ADDR });
  assert.equal(res.statusCode, 500, "enabled + valid body + no key must stop before the RPC");
  assert.equal(res.body.error, "relayer key unavailable");
  assert.equal(JSON.stringify(res.body).includes("RELAYER_PRIVATE_KEY"), false, "key name must not leak into the response");
});
ok("enabled: body schema / address / unexpected-field checks unchanged");
ok("enabled: missing key fails closed without leaking the key name");

console.log(`\ngrant-launch-gate: ${passed} checks passed`);
