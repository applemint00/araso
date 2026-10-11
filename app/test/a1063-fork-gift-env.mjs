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
const fork = block(main);
assert.match(fork, /if \(!endpoint\) return null/);
assert.match(fork, /fetch\(endpoint.sponsorUrl/);
assert.match(fork, /client: Object.freeze\(\{ register: F.post \}\)/);
assert.doesNotMatch(fork, /fetch\("\/api\/gift-sponsor"/);
assert.match(fork, /VITE_ARASO_FORK_GIFT_ESCROW/);
// Byte identity outside the one fork block, including original 143 register transport.
const baseline = execFileSync("git", ["show", "5a76810:app/src/main.js"], { encoding: "utf8" });
assert.equal(main.replace(fork, ""), baseline.replace(block(baseline), ""));
for (const file of ["api/gift-sponsor.js", "api/gift-sponsor-reconcile.js", "api/_lib/gift-sponsor-runtime.js", "relayer/src/gift-sponsor-service.mjs", "relayer/src/gift-sponsor-reconcile.mjs"]) {
  assert.equal(readFileSync(file, "utf8"), execFileSync("git", ["show", `5a76810:${file}`], { encoding: "utf8" }), file);
}
console.log("PASS a1063 fork env: missing/malformed OFF, same-host HTTPS only, register+claim same endpoint, 143/runtime/service/reconciler byte identity");
