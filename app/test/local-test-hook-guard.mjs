// [A-463 Lane C] LOCAL_ONLY 테스트 hook 이 production 으로 새지 않는지 고정한다.
//   node app/test/local-test-hook-guard.mjs
// 네트워크 0 · 브라우저 0. 소스 계약 + (빌드돼 있으면) dist 실물 스캔.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0, fail_ = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} ${detail}`); fail_ += 1; }
};

const HOOK = "__ARASO_LOCAL_TEST_WEBAUTHN_CLIENT__";
const HARNESS_RP = "araso-harness.local.test";

// ── 1. 소스 계약 — 3중 잠금 ──────────────────────────────────────────────────────────
ok("hook 전역 이름이 LOCAL/TEST 임을 드러낸다", SRC.includes(HOOK) && /LOCAL_TEST/.test(HOOK));
ok("LOCAL_DEV_ENTRY 가 아니면 쓰지 않는다", /isLocalDevRpId\(\)/.test(SRC));
ok("격리 rpId 가 아니면 쓰지 않는다", SRC.includes(HARNESS_RP));
ok("계약(createCredential/getCredential 둘 다 함수) 아니면 무시(fail-closed)",
  /typeof hook\.createCredential !== "function"\) return null;/.test(SRC)
  && /typeof hook\.getCredential !== "function"\) return null;/.test(SRC)
  && /!hook \|\| typeof hook !== "object"\) return null;/.test(SRC));
ok("salt 는 32바이트 Uint8Array 일 때만 전달한다",
  /!\(salt instanceof Uint8Array\) \|\| salt\.length !== 32\) return \{\};/.test(SRC));
ok("잠기면 빈 객체 → 기본 browserWebAuthnClient 경로 그대로",
  /return client \? \{ webAuthnClient: client \} : \{\};/.test(SRC));
// app 이 secret/PRF 를 저장하거나 로그하지 않는다
ok("app 이 secret 을 다루지 않는다", !/localStorage\.setItem\([^)]*prfOutput/.test(SRC) && !/console\.(log|error)\([^)]*prfOutput/.test(SRC));
ok("app 이 Keychain 을 부르지 않는다", !/security |find-generic-password|child_process/.test(SRC));
ok("raw private-key signer 신설 0(기존 Mera 경로만)",
  /createSecp256k1SigningSession\(\{ privateKey: prfOutput \}\)/.test(SRC) && (SRC.match(/createSecp256k1SigningSession\(/g) || []).length === 1);

// ── 2. dist 실물 스캔 — 빌드돼 있을 때만(빌드 없으면 건너뛰되 알린다) ────────────────
const distDir = new URL("../../dist/", import.meta.url).pathname;
if (!existsSync(distDir)) {
  console.log("SKIP  dist 스캔 — dist/ 없음(npm run build 후 다시 실행)");
} else {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(distDir);
  const needles = [
    HOOK, HARNESS_RP, "com.araso.harness.test-identity", "araso-harness.prf.salt.v1",
    "araso-harness/credential-id", "mera-harness-keychain", "mera-local-stable", "araso.harness.public-dummy", "DO-NOT-FUND",
    "0xB23Fa3Ede41eCdc6546F834fcc24558448d52A77",
    // [A-642 EG2 / E-8] A-629 LOCAL_ONLY hook 이름 + mainnet read RPC 가 prod 번들에 없다.
    //   local_test_reader 는 넣지 않는다 — prod 번들에 도달 불가 dead branch 로 남는 게 정상(A-629).
    "__ARASO_LOCAL_TEST_RETURN_READ__", "__ARASO_LOCAL_TEST_JOB_BINDINGS__",
    // pre-A-859 baseline: 0 occurrences of "https://rpc.monad.xyz" (needle was here). A-859 allows exactly one: see below.
  ];
  const text = files.filter((f) => /\.(js|css|html|json|map)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
  for (const n of needles) ok(`dist 에 "${n}" 0건`, !text.includes(n));
  // [A-859] exactly one mainnet RPC literal, and it is the RETURN_EVIDENCE_READ_CONFIG value (rpcUrl + finalized).
  const RPC_LIT = "https://rpc.monad.xyz";
  const rpcCount = text.split(RPC_LIT).length - 1;
  ok(`dist 에 "${RPC_LIT}" 정확히 1건 (A-859 RETURN_EVIDENCE_READ_CONFIG)`, rpcCount === 1);
  ok("그 1건은 RETURN_EVIDENCE_READ_CONFIG 값({rpcUrl, finality:\"finalized\"})", /\{rpcUrl:"https:\/\/rpc\.monad\.xyz",finality:"finalized"\}/.test(text));
}

console.log(`\n${pass}/${pass + fail_} PASS`);
process.exit(fail_ === 0 ? 0 : 1);
