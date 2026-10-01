// [deploy headers] vercel.json 배포 헤더 계약 — 오프라인 static 테스트. 네트워크 0.
// CSP 는 추측이 아니라 실측 inventory 에서 나왔다:
//   script : dist/index.html 의 module script 1개(same-origin), inline <script> 0, eval/new Function/Worker 0
//   style  : /assets/*.css 1개 + innerHTML 로 들어가는 inline style 속성(빌드 산출물에서 실측) → 'unsafe-inline' 필요
//   img    : /card /chog /egg /invite /motion 등 same-origin png·svg 만. data: 이미지 0
//   font   : /card/DeliciousHandrawn-Regular.ttf, /fonts/PlayfairDisplay-*.woff2 — 전부 same-origin. 외부 폰트 CDN 0
//   connect: same-origin(/api/grant, /motion/*.json) + https://testnet-rpc.monad.xyz (main.js MONAD_TESTNET_RPC)
// 이 테스트가 재는 것: 헤더가 WebAuthn / asset / RPC 를 막지 않는가.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cfg = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log(`  ok  ${name}`);
};

// --- 헤더 규칙이 모든 경로에 걸려 있나 ------------------------------------
assert.ok(Array.isArray(cfg.headers) && cfg.headers.length > 0, "vercel.json must declare headers");
const rule = cfg.headers.find((r) => r.source === "/(.*)");
assert.ok(rule, "a catch-all header rule must exist");
const H = Object.fromEntries(rule.headers.map((h) => [h.key.toLowerCase(), h.value]));
ok("catch-all header rule present");

// --- lockfile 재현성: install 은 lockfile 을 따라야 한다 -------------------
assert.equal(cfg.installCommand, "npm ci", "install must honour package-lock.json");
ok("installCommand pinned to npm ci");

// --- CSP 파싱 --------------------------------------------------------------
const cspRaw = H["content-security-policy"];
assert.ok(cspRaw, "an ENFORCED CSP must be set (not report-only)");
assert.equal("content-security-policy-report-only" in H, false, "CSP must not be report-only");
const csp = {};
for (const part of cspRaw.split(";").map((s) => s.trim()).filter(Boolean)) {
  const [name, ...values] = part.split(/\s+/);
  csp[name.toLowerCase()] = values;
}
const has = (d, v) => (csp[d] ?? []).includes(v);

for (const d of [
  "default-src",
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "connect-src",
  "object-src",
  "base-uri",
  "frame-ancestors",
  "form-action",
]) {
  assert.ok(csp[d], `CSP is missing ${d}`);
}
ok("all required CSP directives present");

// --- 앱이 실제로 쓰는 것이 막히지 않는가 ----------------------------------
assert.ok(has("script-src", "'self'"), "same-origin module bundle must load");
assert.ok(has("style-src", "'self'"), "same-origin stylesheet must load");
assert.ok(has("img-src", "'self'"), "same-origin art must load");
assert.ok(has("font-src", "'self'"), "same-origin fonts must load");
assert.ok(has("connect-src", "'self'"), "same-origin /api/grant and /motion/*.json must be reachable");
assert.ok(has("connect-src", "https://testnet-rpc.monad.xyz"), "Monad testnet RPC must be reachable");
ok("bundle / style / art / font / api / RPC all allowed");

// 실측: innerHTML 로 들어가는 inline style 속성이 있으므로 style-src 는 'unsafe-inline' 가 필요하다.
// PARTIAL 로 남기되, 계약으로 못박아 둔다 — 이게 사라지면 화면이 깨지고, 늘어나면 안 된다.
assert.ok(has("style-src", "'unsafe-inline'"), "inline style attributes are still used by app/src (measured)");
ok("style-src 'unsafe-inline' declared (known PARTIAL, measured)");

// --- 조여야 하는 것 --------------------------------------------------------
assert.deepEqual(csp["object-src"], ["'none'"]);
assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
assert.deepEqual(csp["base-uri"], ["'self'"]);
assert.deepEqual(csp["form-action"], ["'self'"]);
assert.equal(has("script-src", "'unsafe-inline'"), false, "no inline script is used — must not be allowed");
assert.equal(has("script-src", "'unsafe-eval'"), false, "no eval/new Function is used — must not be allowed");
assert.equal(has("default-src", "*"), false);
assert.equal(has("connect-src", "*"), false);
for (const d of Object.keys(csp)) {
  assert.equal((csp[d] ?? []).includes("http:"), false, `${d} must not allow plaintext http:`);
}
ok("no wildcards, no unsafe-eval/inline script, no plaintext http:");

// --- WebAuthn 이 막히지 않는가 --------------------------------------------
const pp = H["permissions-policy"];
assert.ok(pp, "Permissions-Policy must be set");
assert.match(pp, /publickey-credentials-get=\(self\)/, "WebAuthn get() must stay allowed for this origin");
assert.match(pp, /publickey-credentials-create=\(self\)/, "passkey creation must stay allowed for this origin");
assert.equal(/publickey-credentials-(get|create)=\(\)/.test(pp), false, "WebAuthn must not be disabled outright");
for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
  assert.match(pp, new RegExp(`${feature}=\\(\\)`), `${feature} should be denied`);
}
ok("Permissions-Policy keeps WebAuthn, denies unused sensors");

// --- 그 외 기본 헤더 -------------------------------------------------------
assert.equal(H["x-content-type-options"], "nosniff");
assert.ok(/^(no-referrer|strict-origin-when-cross-origin|same-origin)$/.test(H["referrer-policy"]));
ok("Referrer-Policy and X-Content-Type-Options set");

// --- 확인 안 한 것은 넣지 않는다 ------------------------------------------
// COOP/COEP 는 WebAuthn 과의 상호작용을, HSTS 는 Vercel 도메인 정책을 실측하지 않았다.
// 검증 없이 켜는 대신 "없음"을 계약으로 고정한다. 켜려면 이 테스트를 먼저 고쳐야 한다.
for (const k of ["cross-origin-opener-policy", "cross-origin-embedder-policy", "strict-transport-security"]) {
  assert.equal(k in H, false, `${k} must not be added before its WebAuthn/Vercel interaction is measured`);
}
ok("COOP/COEP/HSTS intentionally absent (UNVERIFIED, not silently enabled)");

console.log(`\ndeploy-headers: ${passed} checks passed`);
