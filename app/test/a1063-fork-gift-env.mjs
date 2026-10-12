import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolveChainProfile, resolveForkGiftTransport } from "../src/chain-profile.js";
const profile = resolveChainProfile("monad-fork", { rpcUrl: "https://fork.example/", forkInstanceId: "fork-143-test" });
const env = { sponsorUrl: "https://fork.example/gift-sponsor", escrow: `0x${"12".repeat(20)}` };
assert.ok(resolveForkGiftTransport(profile, env));
const credentials = new URL(env.sponsorUrl); credentials.username = "fixture"; credentials.password = "fixture";
for (const patch of [{ sponsorUrl: undefined }, { escrow: undefined }, { escrow: `0x${"0".repeat(40)}` }, { escrow: "bad" }, { sponsorUrl: "https://evil.example/gift-sponsor" }, { sponsorUrl: "http://fork.example/gift-sponsor" }, { sponsorUrl: credentials.href }, { sponsorUrl: "https://fork.example/gift-sponsor?x=1" }, { sponsorUrl: "https://fork.example/gift-sponsor#x" }, { sponsorUrl: "https://fork.example/api/gift-sponsor" }]) assert.equal(resolveForkGiftTransport(profile, { ...env, ...patch }), null);
for (const scope of ["monad-mainnet", "monad-testnet", "typo"]) assert.equal(resolveForkGiftTransport(resolveChainProfile(scope), env), null);
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const block = (s) => s.slice(s.indexOf("// ── [A-966] Gift on"), s.indexOf("// ── [A-966] end Gift") + "// ── [A-966] end Gift on the shared fork ──".length);
const reentry = (s) => {
  const start = s.indexOf("// ── [A-1105] First Send re-entry");
  if (start < 0) return "";
  const marker = "// ── [A-1105] end First Send re-entry ─────────────────────────────────────────";
  const end = s.indexOf(marker, start);
  if (end < 0) return "";
  const after = end + marker.length;
  return s.slice(start, after + (s[after] === "\n" ? 1 : 0));
};
const functionBlock = (s, name) => {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(s);
  if (!match) return "";
  const open = s.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === "{") depth += 1;
    else if (s[i] === "}") {
      depth -= 1;
      if (depth === 0) return s.slice(match.index, i + 1);
    }
  }
  return "";
};
const inviteAuthEntry = (s) => {
  const current = s.indexOf("// 인증 성공 뒤, Owner가 확정한 기존 봉투 타임라인");
  const baseline = s.indexOf("// 봉투 열기 = 이 화면의 유일한 입력.");
  const start = current >= 0 ? current : baseline;
  const gift = functionBlock(s, "openGiftInvite");
  if (start < 0 || !gift) return "";
  const after = s.indexOf(gift, start) + gift.length;
  return s.slice(start, after + (s[after] === "\n" ? 1 : 0));
};
const fork = block(main);
assert.match(fork, /if \(!endpoint\) return null/);
assert.match(fork, /fetch\(endpoint.sponsorUrl/);
assert.match(fork, /client: Object.freeze\(\{ register: F.post \}\)/);
assert.doesNotMatch(fork, /fetch\("\/api\/gift-sponsor"/);
assert.match(fork, /VITE_ARASO_FORK_GIFT_ESCROW/);
// Byte identity outside the fork block and the separately tested Owner live repairs
// (First Send re-entry, passkey-first Invite/Gift entry, unnamed existing-Piggy recovery, A-1109 Home layout), including original 143 transport.
const baseline = execFileSync("git", ["show", "5a76810:app/src/main.js"], { encoding: "utf8" });
const withoutApprovedLiveRepairs = (s, forkBlock) => s
  .replace(forkBlock, "")
  .replace(reentry(s), "")
  .replace(inviteAuthEntry(s), "")
  .replace(functionBlock(s, "checkPiggy"), "")
  .replace(functionBlock(s, "homeKeyframeLayout"), "")
  .replace(functionBlock(s, "computeHistoryPlacement"), ""); // [A-1109 answer 10] phone-only half-card limit (vw <= 640)
assert.equal(withoutApprovedLiveRepairs(main, fork), withoutApprovedLiveRepairs(baseline, block(baseline)));
for (const file of ["api/gift-sponsor.js", "api/gift-sponsor-reconcile.js", "api/_lib/gift-sponsor-runtime.js", "relayer/src/gift-sponsor-service.mjs", "relayer/src/gift-sponsor-reconcile.mjs"]) {
  assert.equal(readFileSync(file, "utf8"), execFileSync("git", ["show", `5a76810:${file}`], { encoding: "utf8" }), file);
}
console.log("PASS a1063 fork env: missing/malformed OFF, same-host HTTPS only, register+claim same endpoint, 143/runtime/service/reconciler byte identity");
