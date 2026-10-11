// [A-954] One RPC address judge (chain-profile.js rpcUrlAllowed) + the dev-only Public Guard link. Regression table (card item 6):
//   dev + fork + 127.0.0.1 Guard = connect · prod + fork + http = BLOCKED · dev + testnet + http = no_rpc · dev + fork + raw anvil port
//   = BLOCKED · dev + fork + Admin port = BLOCKED · localhost / other IP / userinfo / path tricks = refused · 143 path unchanged ·
//   10143 path unchanged · production bundle has the http branch dead-code-eliminated (vite build + grep, with a dev-build control).
// "dev" is the real vite dev evaluation (createServer + ssrLoadModule: import.meta.env.DEV === true), not a flag this test sets.
// The raw anvil / Admin answers here are their recorded shapes (anvil: -32601 method not found; Admin: 401); the A-954 real run
// (_private/ops/harness/a949-fork-infra/a954-app-link-run.mjs) repeats both against the live ports. No network: fetch is stubbed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
globalThis.fetch = async () => { throw new Error("A-954 test: network forbidden"); };

let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.stack || e).split("\n").slice(0, 3).join("\n      ")}`); } };

const OLD_RULE = /^https:\/\/[^\s]+$/; // the rule every site used before A-954
const GUARD = "http://127.0.0.1:47123";
const ANVIL = "http://127.0.0.1:47124";
const ADMIN = "http://127.0.0.1:47125";
const FORK_ID = "fork-143-110874000-20261010T030000Z-abcdef12";
const PIGGY = "0x1111111111111111111111111111111111111111";
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
// Recorded answer shapes: the Guard (fork-infra.mjs handlePublic), raw anvil (-32601 for an unknown method), Admin (401 without token).
function fakeNet({ guardForkId = FORK_ID } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const req = JSON.parse(init.body);
    calls.push([url, req.method]);
    if (url === ADMIN) return json({ error: "unauthorized" }, 401);
    if (req.method === "araso_guardInfo") {
      if (url === GUARD) return json({ jsonrpc: "2.0", id: req.id, result: { guard: "araso-a949-public-guard", chainId: 31337143, forkInstanceId: guardForkId } });
      return json({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "Method not found" } });
    }
    if (req.method === "eth_chainId") return json({ jsonrpc: "2.0", id: req.id, result: "0x1de2ab7" });
    if (req.method === "eth_blockNumber") return json({ jsonrpc: "2.0", id: req.id, result: "0x69bc290" });
    if (req.method === "eth_getCode") return json({ jsonrpc: "2.0", id: req.id, result: "0x6080" });
    if (req.method === "eth_call") return json({ jsonrpc: "2.0", id: req.id, result: `0x${"0".repeat(63)}5` });
    return json({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "no" } });
  };
  return { impl, calls };
}

// ── 1. Node import = what a production build decides (RPC_DEV_BUILD false: import.meta.env is undefined outside vite) ──
const NODE_CP = await import("../src/chain-profile.js");
await check("prod: RPC_DEV_BUILD is false outside the vite dev server", () => { assert.equal(NODE_CP.RPC_DEV_BUILD, false); });
await check("prod + fork + http = BLOCKED fork_config_missing (even with dev:true passed by a caller)", () => {
  const p = NODE_CP.resolveChainProfile("monad-fork", { rpcUrl: GUARD, forkInstanceId: FORK_ID });
  assert.equal(p.status, "blocked"); assert.equal(p.reason, "fork_config_missing");
  assert.equal(NODE_CP.rpcUrlAllowed(GUARD, { profile: "monad-fork", dev: true }), false);
  assert.equal(NODE_CP.rpcUrlAllowed(GUARD, { dev: true }), false);
  assert.equal(NODE_CP.devForkGuardState(), null);
});
await check("prod: checkForkGuard refuses outside the dev server (no request made)", async () => {
  const net = fakeNet();
  const r = await NODE_CP.checkForkGuard({ id: "monad-fork", status: "active", rpcUrl: GUARD, forkInstanceId: FORK_ID }, { fetchImpl: net.impl });
  assert.deepEqual([r.status, r.reason, net.calls.length], ["blocked", "not_dev_build", 0]);
});
await check("prod: https judgement == the old rule on a URL corpus (byte-for-byte same decisions)", () => {
  const corpus = ["https://rpc.monad.xyz", "https://testnet-rpc.monad.xyz", "https://a@b", "https://x/ y", "https://", "http://rpc.monad.xyz", "HTTPS://rpc.monad.xyz",
    " https://rpc.monad.xyz", "https://fork-public.invalid/rpc", GUARD, "http://localhost:8545", "", "ftp://x", "https://127.0.0.1:1", "https://x\n"];
  for (const u of corpus) assert.equal(NODE_CP.rpcUrlAllowed(u), OLD_RULE.test(u), u);
  for (const v of [undefined, null, 1, {}, ["https://x"]]) assert.equal(NODE_CP.rpcUrlAllowed(v), false);
});

// ── 2. The vite dev server's evaluation (import.meta.env.DEV === true) ──
const { createServer, build } = await import("vite");
const vite = await createServer({ root: path.join(REPO, "app"), configFile: false, logLevel: "silent", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const DEV_CP = await vite.ssrLoadModule("/src/chain-profile.js");
const DEV_READER = await vite.ssrLoadModule("/src/second-current-reader.js");
const DEV_READINESS = await vite.ssrLoadModule("/src/second-job-readiness.js");
const DEV_LANE = await vite.ssrLoadModule("/src/mainnet-job-lane.js");
const NOW = () => "2026-10-10T03:00:00.000Z";

await check("dev: RPC_DEV_BUILD is true on the vite dev server", () => { assert.equal(DEV_CP.RPC_DEV_BUILD, true); });

await check("dev + testnet + http = no_rpc (no fork profile resolved on this page: every reader refuses the loopback URL)", async () => {
  assert.equal(DEV_CP.devForkGuardState(), null);
  const net = fakeNet();
  const testnet = DEV_CP.resolveChainProfile("");
  assert.equal(testnet.id, "monad-testnet"); assert.equal(testnet.rpcUrl, undefined);
  const r = await DEV_READER.readSecondCurrent({ profile: testnet, piggyAddress: PIGGY, rpcUrl: GUARD, fetchImpl: net.impl, now: NOW });
  for (const id of ["aave-usdc", "neverland-usdc", "curvance-usdc", "protect-revoke-allowance", "kintsu-smon"]) assert.equal(r.candidates.find((c) => c.id === id).reason, "no_rpc", id);
  assert.equal((await DEV_READINESS.readReturnObservation("kintsu-smon", { rpcUrl: GUARD, fetchImpl: net.impl, now: NOW })).status, "no_rpc");
  assert.equal(DEV_CP.rpcUrlAllowed(GUARD, { profile: testnet, dev: true }), false);
  assert.equal(net.calls.length, 0);
});

await check("dev: localhost / other IPs / other schemes / userinfo / path, port and host tricks are refused at resolve time", () => {
  const bad = ["http://localhost:8545", "http://LOCALHOST:8545", "http://127.0.0.2:8545", "http://0.0.0.0:8545", "http://10.0.0.1:8545", "http://192.168.0.2:8545",
    "http://[::1]:8545", "http://127.1:8545", "http://2130706433:8545", "http://127.0.0.1", "http://127.0.0.1:", "http://127.0.0.1:0", "http://127.0.0.1:65536",
    "http://127.0.0.1:099", "http://127.0.0.1.evil:8545", "http://127.0.0.1.evil.com", "http://user@127.0.0.1:8545", "http://user:pw@127.0.0.1:8545",
    `http://127.0.0.1:8545${"@"}evil.com`, "http://evil.com#@127.0.0.1:8545", "http://127.0.0.1:8545/rpc", "http://127.0.0.1:8545/..", "http://127.0.0.1:8545?x=1",
    "http://127.0.0.1:8545#x", "http://127.0.0.1:8545//", "ws://127.0.0.1:8545", "HTTP://127.0.0.1:8545", "http:/127.0.0.1:8545", "http://127.0.0.1:8545 ",
    " http://127.0.0.1:8545", "http://127.0.0.1:8545\n", "http://127.0.0.1\t:8545", "file:///etc/passwd", "javascript:alert(1)", "data:,x", "http://%31%32%37.0.0.1:8545"];
  for (const u of bad) {
    assert.equal(DEV_CP.rpcUrlAllowed(u, { profile: "monad-fork", dev: true }), false, u);
    const p = DEV_CP.resolveChainProfile("monad-fork", { rpcUrl: u, forkInstanceId: FORK_ID });
    if (p.status !== "blocked") assert.equal(p.rpcUrl, u.trim(), u); // only " http://…" trims to a valid one; then the exact trimmed URL is the profile's
  }
  for (const ok of ["http://127.0.0.1:8545", "http://127.0.0.1:8545/", "http://127.0.0.1:1", "http://127.0.0.1:65535"]) assert.equal(DEV_CP.rpcUrlAllowed(ok, { profile: "monad-fork", dev: true }), true, ok);
  assert.equal(DEV_CP.rpcUrlAllowed("http://127.0.0.1:8545", { profile: "monad-fork", dev: false }), false, "dev:false = prod rule even on the dev server");
  assert.equal(DEV_CP.rpcUrlAllowed("http://127.0.0.1:8545", { profile: "monad-fork" }), false);
  assert.equal(DEV_CP.rpcUrlAllowed("http://127.0.0.1:8545", { profile: "monad-mainnet", dev: true }), false);
  assert.equal(DEV_CP.rpcUrlAllowed("http://127.0.0.1:8545", { profile: "monad-testnet", dev: true }), false);
});

let forkProfile;
await check("dev + fork + 127.0.0.1 Guard = connect (Guard answers araso_guardInfo → verified → the reader reads through it)", async () => {
  forkProfile = DEV_CP.resolveChainProfile("monad-fork", { rpcUrl: GUARD, forkInstanceId: FORK_ID });
  assert.equal(forkProfile.status, "active"); assert.equal(forkProfile.id, "monad-fork"); assert.equal(forkProfile.rpcUrl, GUARD); assert.equal(forkProfile.numericChainId, 31337143);
  assert.ok(["pending", "blocked"].includes(DEV_CP.devForkGuardState().status)); // the boot-time check met the stubbed (forbidden) network
  assert.equal(DEV_CP.rpcUrlAllowed(GUARD, { profile: forkProfile, dev: true }), false, "not verified yet = refused");
  const net = fakeNet();
  const r = await DEV_CP.checkForkGuard(forkProfile, { fetchImpl: net.impl });
  assert.deepEqual([r.status, r.reason, r.info.chainId, r.info.forkInstanceId], ["verified", null, 31337143, FORK_ID]);
  assert.deepEqual(net.calls, [[GUARD, "araso_guardInfo"], [GUARD, "eth_chainId"]]);
  assert.equal(DEV_CP.devForkGuardState().status, "verified");
  assert.equal(DEV_CP.rpcUrlAllowed(GUARD, { profile: forkProfile, dev: true }), true);
  assert.equal(DEV_CP.rpcUrlAllowed(GUARD, { dev: true }), true, "a reader that carries no profile: the verified Guard of this page");
  assert.equal(DEV_CP.rpcUrlAllowed(GUARD, { dev: false }), false);
  assert.equal(DEV_CP.rpcUrlAllowed(`${GUARD}/`, { dev: true }), false, "only the exact verified URL");
  assert.equal(DEV_CP.rpcUrlAllowed(ANVIL, { dev: true }), false, "another loopback port is not the verified Guard");
  const reader = DEV_READER.makeReadOnlyReader({ rpcUrl: GUARD, fetchImpl: net.impl, now: NOW });
  assert.equal(reader.fail, undefined);
  const pin = await reader.pin();
  assert.equal(pin.chainId, 31337143);
  const cur = await DEV_READER.readSecondCurrent({ profile: forkProfile, piggyAddress: PIGGY, rpcUrl: GUARD, fetchImpl: net.impl, now: NOW });
  assert.notEqual(cur.candidates.find((c) => c.id === "neverland-usdc").reason, "no_rpc");
  // the 143 lane stays https-only even on this page: a mainnet profile with the Guard URL = no_rpc
  const mainnet = DEV_CP.resolveChainProfile("monad-mainnet");
  assert.equal((await DEV_LANE.readLanePreAction({ profile: mainnet, piggyAddress: PIGGY, rpcUrl: GUARD, fetchImpl: net.impl, now: NOW })).status, "no_rpc");
  assert.equal(DEV_CP.rpcUrlAllowed(GUARD, { profile: mainnet, dev: true }), false);
  assert.equal(DEV_CP.rpcUrlAllowed(GUARD, { profile: { ...forkProfile, forkInstanceId: "other-instance" }, dev: true }), false);
});

await check("dev + fork + raw anvil port = BLOCKED (no araso_guardInfo → not_public_guard; reads refused)", async () => {
  const p = DEV_CP.resolveChainProfile("monad-fork", { rpcUrl: ANVIL, forkInstanceId: FORK_ID });
  const net = fakeNet();
  const r = await DEV_CP.checkForkGuard(p, { fetchImpl: net.impl });
  assert.deepEqual([r.status, r.reason], ["blocked", "not_public_guard"]);
  assert.equal(DEV_CP.devForkGuardState().status, "blocked");
  assert.equal(DEV_CP.rpcUrlAllowed(ANVIL, { profile: p, dev: true }), false);
  assert.equal(DEV_CP.rpcUrlAllowed(ANVIL, { dev: true }), false);
  assert.equal(DEV_CP.rpcUrlAllowed(GUARD, { dev: true }), false, "the page's fork is now the anvil URL: the earlier Guard is not this page's");
  const cur = await DEV_READER.readSecondCurrent({ profile: p, piggyAddress: PIGGY, rpcUrl: ANVIL, fetchImpl: net.impl, now: NOW });
  assert.equal(cur.candidates.find((c) => c.id === "neverland-usdc").reason, "no_rpc");
  assert.deepEqual(net.calls.map((c) => c[1]), ["araso_guardInfo"], "nothing read after the refusal");
});

await check("dev + fork + Admin port = BLOCKED (401, not JSON-RPC)", async () => {
  const p = DEV_CP.resolveChainProfile("monad-fork", { rpcUrl: ADMIN, forkInstanceId: FORK_ID });
  const r = await DEV_CP.checkForkGuard(p, { fetchImpl: fakeNet().impl });
  assert.deepEqual([r.status, r.reason], ["blocked", "not_public_guard"]);
  assert.equal(DEV_CP.rpcUrlAllowed(ADMIN, { dev: true }), false);
});

await check("dev + fork: a Guard of ANOTHER fork instance (restart / reset) = BLOCKED fork_instance_mismatch; unreachable = BLOCKED", async () => {
  const p = DEV_CP.resolveChainProfile("monad-fork", { rpcUrl: GUARD, forkInstanceId: FORK_ID });
  assert.deepEqual([(await DEV_CP.checkForkGuard(p, { fetchImpl: fakeNet({ guardForkId: "fork-143-other" }).impl })).reason], ["fork_instance_mismatch"]);
  assert.equal(DEV_CP.rpcUrlAllowed(GUARD, { profile: p, dev: true }), false);
  assert.equal((await DEV_CP.checkForkGuard(p, { fetchImpl: async () => { throw new Error("refused"); } })).reason, "guard_unreachable");
  const wrongChain = async (u, init) => { const m = JSON.parse(init.body).method; return json(m === "araso_guardInfo" ? { result: { guard: "araso-a949-public-guard", chainId: 143, forkInstanceId: FORK_ID } } : { result: "0x8f" }); };
  assert.equal((await DEV_CP.checkForkGuard(p, { fetchImpl: wrongChain })).reason, "guard_chain_mismatch");
  assert.equal((await DEV_CP.checkForkGuard({ ...p, id: "monad-mainnet" }, { fetchImpl: fakeNet().impl })).reason, "not_dev_fork_profile");
  // an older, slower check never overwrites a newer answer
  let release; const slow = new Promise((r) => { release = r; });
  const slowImpl = async (...a) => { await slow; return fakeNet({ guardForkId: "late" }).impl(...a); };
  const older = DEV_CP.checkForkGuard(p, { fetchImpl: slowImpl });
  await DEV_CP.checkForkGuard(p, { fetchImpl: fakeNet().impl });
  release(); await older;
  assert.equal(DEV_CP.devForkGuardState().status, "verified");
});

await check("143 path unchanged: mainnet/testnet profile objects byte-identical (sha256 of the PROFILES block) · mainnet rpcUrl https · http = no_rpc", async () => {
  const src = readFileSync(path.join(REPO, "app/src/chain-profile.js"), "utf8");
  const i = src.indexOf("const PROFILES = Object.freeze({"); const j = src.indexOf("});\n", i) + 4;
  assert.equal(createHash("sha256").update(src.slice(i, j)).digest("hex"), "e2a09fe90728f36713b4c18770f9c4149d03ce125a8d3a50e157157ffce05ca7");
  const m = NODE_CP.resolveChainProfile("monad-mainnet");
  assert.equal(m.rpcUrl, "https://rpc.monad.xyz"); assert.equal(m.numericChainId, 143); assert.equal(m.liveExecution, false);
  const LANE = await import("../src/mainnet-job-lane.js");
  for (const u of [GUARD, "http://rpc.monad.xyz"]) assert.equal((await LANE.readLanePreAction({ profile: m, piggyAddress: PIGGY, rpcUrl: u, fetchImpl: fakeNet().impl, now: NOW })).status, "no_rpc", u);
  const vercel = readFileSync(path.join(REPO, "vercel.json"), "utf8");
  assert.equal(/127\.0\.0\.1|localhost|http:\/\//.test(vercel.match(/connect-src[^;"]*/)?.[0] || ""), false, "production CSP connect-src opens no http / loopback");
});

await check("10143 path unchanged: unset profile = testnet, no rpcUrl, every read no_rpc, fetch 0", async () => {
  const t = NODE_CP.resolveChainProfile(undefined);
  assert.deepEqual([t.id, t.numericChainId, t.rpcUrl, t.legacyFirstJourney, t.selectedBy], ["monad-testnet", 10143, undefined, true, "default"]);
  const READER = await import("../src/second-current-reader.js");
  const net = fakeNet();
  const r = await READER.readSecondCurrent({ profile: t, piggyAddress: PIGGY, rpcUrl: t.rpcUrl, fetchImpl: net.impl, now: NOW });
  for (const c of r.candidates.filter((c) => c.status === "read_failed")) assert.equal(c.reason, "no_rpc", c.id);
  assert.equal(net.calls.length, 0);
});

await check("the four sites call the one judge (a single judgement line each; no other https regex left at those sites)", () => {
  const src = (f) => readFileSync(path.join(REPO, "app/src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(src("chain-profile.js"), /if \(!rpcUrlAllowed\(rpcUrl, \{ profile: CHAIN_PROFILE_ID\.FORK, dev: RPC_DEV_BUILD \}\)/);
  assert.match(src("second-current-reader.js"), /if \(!rpcUrlAllowed\(rpcUrl, \{ dev: RPC_DEV_BUILD \}\)\) return \{ fail: "no_rpc" \};/);
  assert.match(src("second-job-readiness.js"), /if \(!rpcUrlAllowed\(rpcUrl, \{ dev: RPC_DEV_BUILD \}\)\) return \{ observation: null, status: "no_rpc" \};/);
  assert.match(src("mainnet-job-lane.js"), /if \(!rpcUrlAllowed\(rpcUrl, \{ profile, dev: RPC_DEV_BUILD \}\)\) return \{ status: "no_rpc", read: null \};/);
  for (const f of ["second-current-reader.js", "second-job-readiness.js", "mainnet-job-lane.js"]) assert.equal(/\^https:\\\/\\\//.test(src(f)), false, f);
  // no env / query / storage value feeds the judgement: the only build input is import.meta.env.DEV / MODE
  const cp = src("chain-profile.js");
  assert.equal(/localStorage|sessionStorage|location\.|URLSearchParams|VITE_/.test(cp), false);
  assert.match(cp, /export const RPC_DEV_BUILD = typeof import\.meta\.env === "object" && import\.meta\.env !== null \? import\.meta\.env\.DEV === true && import\.meta\.env\.MODE !== "production" : false;/);
});
await vite.close();

// ── 3. Production bundle: the http branch is gone (vite build into a temp dir + grep), with a dev-build positive control ──
const MARKERS = ["araso_guardInfo", "araso-a949-public-guard", "127\\.0\\.0\\.1", "127.0.0.1", "not_dev_fork_profile", "guard_unreachable", "fork_instance_mismatch"];
async function bundleHits(mode) {
  const out = mkdtempSync(path.join(os.tmpdir(), `a954-${mode}-`));
  try {
    await build({ root: path.join(REPO, "app"), configFile: false, logLevel: "silent", mode, build: { outDir: out, emptyOutDir: true } });
    const js = readdirSync(path.join(out, "assets")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(path.join(out, "assets", f), "utf8")).join("\n");
    return Object.fromEntries(MARKERS.map((k) => [k, js.split(k).length - 1]));
  } finally { rmSync(out, { recursive: true, force: true }); }
}
await check("prod bundle (vite build, mode production): 0 hits for the dev http branch / Guard check", async () => {
  const hits = await bundleHits("production");
  console.log(`      dist grep (production): ${JSON.stringify(hits)}`);
  for (const k of MARKERS) assert.equal(hits[k], 0, k);
});
await check("control: a dev-mode build keeps the branch (so the grep above can see it)", async () => {
  const hits = await bundleHits("development");
  console.log(`      dist grep (development control): ${JSON.stringify(hits)}`);
  assert.ok(hits["araso_guardInfo"] > 0 && hits["127\\.0\\.0\\.1"] > 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
