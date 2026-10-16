// [A-961] Fork Gift sponsor runtime (api/_lib/gift-sponsor-runtime.js, appended block). Node only, network 0, no port.
// Checks: the 143 runtime text and the A-946 fork block are byte-identical to before; the relayer service is untouched; the fork runtime reads ONLY
// the GIFT_SPONSOR_FORK_* names (and the 143 runtime never reads them); its policy is the fork id; its preflight refuses a non-fork chain id and a
// non-A-935 escrow code before any pin read. The live run (escrow deploy + sponsored claim on a local fork) = $ARASO_PRIVATE_BASE/ops/harness/a961-gift-fork/run.mjs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RT = await import(path.join(REPO, "api/_lib/gift-sponsor-runtime.js"));
const { openGiftSponsorLedger } = await import(path.join(REPO, "relayer/src/gift-sponsor-service.mjs"));
const src = (f) => readFileSync(path.join(REPO, f), "utf8");
const sha = (t) => createHash("sha256").update(t).digest("hex");
// [A-983] baseline pins replace `git show HEAD:` compares (they fail once HEAD holds this work: after the release commit / in a clone).
//   Unchanged files retain de8c9c8; the accepted Gift metadata/link changes re-pin only their affected surfaces.
const BASE_RT143_SHA256 = "96da1363170faeb9f465bc66e4b19fef9237188d8ea5e87a0d5bd45e276a64d0"; // accepted Gift runtime prefix, trailing newlines trimmed
const BASE_FILE_SHA256 = {
  "relayer/src/gift-sponsor-service.mjs": "3062664dc2f63b492932e4b9357419f0e691b418dba43c579c07613c124549ff",
  "relayer/src/gift-sponsor-preflight.mjs": "d5817ccddb08a2ce62cfff830c4f6d4fe86e076563c72327eec3605297f8b4f1",
  "relayer/src/gift-sponsor-reconcile.mjs": "f7478c05edada7ea405ff8ba453cbe8d1524fb5d09a4afdd87f066826c29d129",
  "api/gift-sponsor.js": "46296dd7aaf3ffedf1f13930bf3de966520e959998e6e06ccc0d4b1ceef160cb",
};
let pass = 0; let fail = 0;
const check = async (label, fn) => { try { await fn(); pass += 1; console.log(`PASS  ${label}`); } catch (e) { fail += 1; console.log(`FAIL  ${label}\n      ${String(e?.stack || e).split("\n").slice(0, 4).join("\n      ")}`); } };

const FILE = "api/_lib/gift-sponsor-runtime.js";
const A946_MARK = "// ── [A-946] Shared mainnet fork";
const A961_MARK = "// ── [A-961] Fork sponsor RUNTIME";
// sha256 before the A-961 block after the accepted Gift metadata/link changes.
const PRE_A961_SHA256 = "ab55118044af60391c922be2cd5695eccb06096d65c725525f91ed370c74665d";
const KEY = generatePrivateKey();
const ESCROW = "0x1111111111111111111111111111111111111111";
// [A-979 ④] GIFT_SPONSOR_FORK_GAS_UNITS / _GAS_BUFFER_BPS below = A-961 fork fixtures = fork virtual cost (not measured); not Owner values, not a mainnet measurement.
const forkEnv = (over = {}) => ({ GIFT_SPONSOR_FORK_PRIVATE_KEY: KEY, GIFT_SPONSOR_FORK_RPC_URL: "http://127.0.0.1:1", GIFT_SPONSOR_FORK_ESCROW_ADDRESS: ESCROW, GIFT_SPONSOR_FORK_GAS_UNITS: "120000,400000,120000,250000", GIFT_SPONSOR_FORK_GAS_BUFFER_BPS: "2000", GIFT_SPONSOR_FORK_LEASE_SECONDS: "120", ...over });

await check("143 bytes before the A-961 block and runtime prefix match the accepted Gift baseline (sha256)", () => {
  const now = src(FILE);
  const at = now.indexOf(A961_MARK);
  assert.ok(at > 0, "A-961 block present");
  const before = now.slice(0, at).replace(/\n+$/, "\n");
  assert.equal(sha(before), PRE_A961_SHA256, "everything before the A-961 block matches the accepted Gift baseline");
  // [A-983 re-pin] HEAD text → its sha256 at de8c9c8. pre-A-983: const head = gitHead(FILE); if (head !== null) assert.equal(now.slice(0, now.indexOf(A946_MARK)).replace(/\n+$/, ""), head.replace(/\n+$/, ""), "143 runtime text = HEAD");
  assert.equal(sha(now.slice(0, now.indexOf(A946_MARK)).replace(/\n+$/, "")), BASE_RT143_SHA256, "143 runtime text matches the accepted Gift baseline");
  assert.ok(!/GIFT_SPONSOR_FORK_/.test(now.slice(0, now.indexOf(A946_MARK))), "the 143 runtime never names a fork env");
});

await check("relayer/API files match the accepted Gift baseline; unrelated preflight/reconcile remain pinned", () => {
  for (const f of ["relayer/src/gift-sponsor-service.mjs", "relayer/src/gift-sponsor-preflight.mjs", "relayer/src/gift-sponsor-reconcile.mjs", "api/gift-sponsor.js"]) {
    // [A-983 re-pin] pre-A-983: const head = gitHead(f); if (head === null) skip; assert.equal(src(f), head, f);
    assert.equal(sha(src(f)), BASE_FILE_SHA256[f], f);
  }
});

await check("env separation: fork names only on the fork; 143 names only on 143", () => {
  assert.equal(RT.readGiftSponsorForkEnv({}), null, "no fork key = OFF");
  const env143 = { GIFT_SPONSOR_PRIVATE_KEY: generatePrivateKey(), MONAD_RPC_URL: "https://rpc.invalid", GIFT_SPONSOR_ESCROW_ADDRESS: ESCROW, GIFT_SPONSOR_GAS_UNITS: "1,1,1,1", GIFT_SPONSOR_GAS_BUFFER_BPS: "0", GIFT_SPONSOR_LEASE_SECONDS: "120" };
  assert.equal(RT.readGiftSponsorForkEnv(env143), null, "143 env alone never turns the fork on");
  assert.equal(RT.readGiftSponsorEnv(forkEnv()), null, "fork env alone never turns 143 on");
  assert.equal(RT.getGiftSponsorRuntime(forkEnv(), { noCache: true }), null, "143 runtime with fork env = OFF");
  const cfg = RT.readGiftSponsorForkEnv(forkEnv());
  assert.equal(cfg.escrow, ESCROW); assert.equal(cfg.rpcUrl, "http://127.0.0.1:1"); assert.equal(cfg.kvUrl, null); assert.equal(cfg.rate, null);
  assert.deepEqual(cfg.gasUnits, { install: "120000", commit: "400000", revoke: "120000", claim: "250000" });
  assert.throws(() => RT.readGiftSponsorForkEnv(forkEnv({ GIFT_SPONSOR_FORK_ESCROW_ADDRESS: undefined })), /MISSING_GIFT_SPONSOR_FORK_ESCROW_ADDRESS/);
  assert.throws(() => RT.readGiftSponsorForkEnv(forkEnv({ GIFT_SPONSOR_FORK_RPC_URL: undefined })), /MISSING_GIFT_SPONSOR_FORK_RPC_URL/);
  assert.throws(() => RT.readGiftSponsorForkEnv(forkEnv({ GIFT_SPONSOR_FORK_LEASE_SECONDS: "60" })), /BAD_GIFT_SPONSOR_FORK_LEASE_SECONDS/);
  assert.throws(() => RT.readGiftSponsorForkEnv(forkEnv({ GIFT_SPONSOR_PRIVATE_KEY: KEY })), /GIFT_SPONSOR_FORK_KEY_IS_143_KEY/);
  // 143-named values never leak into the fork config
  const mixed = RT.readGiftSponsorForkEnv({ ...forkEnv(), MONAD_RPC_URL: "https://rpc.monad.xyz", GIFT_SPONSOR_ESCROW_ADDRESS: "0x2222222222222222222222222222222222222222", KV_REST_API_URL: "https://kv.invalid" });
  assert.equal(mixed.rpcUrl, "http://127.0.0.1:1"); assert.equal(mixed.escrow, ESCROW); assert.equal(mixed.kvUrl, null);
});

await check("fork runtime: policy = fork id + fork pins; preflight refuses a non-fork chain id and a non-A-935 escrow before any pin read", async () => {
  const cfg = RT.readGiftSponsorForkEnv(forkEnv());
  const reads = [];
  let chainId = 143; let escrowCode = "0x6001";
  const chain = { getCode: async (a) => { reads.push(a.toLowerCase()); return a.toLowerCase() === ESCROW ? escrowCode : "0x60"; } };
  const rt = RT.buildGiftSponsorForkRuntime(cfg, { chain, store: openGiftSponsorLedger(null), sponsor: { address: privateKeyToAccount(KEY).address, send: async () => { throw new Error("no send in this test"); } }, readChainId: async () => chainId, log: () => {} });
  assert.equal(rt.policy.chainId, RT.GIFT_SPONSOR_FORK_CHAIN_ID);
  assert.equal(rt.policy.chainId, 31337143);
  assert.equal(rt.policy.escrow, ESCROW);
  assert.equal(rt.service.ready, true);
  assert.equal(rt.rateLimit, null);
  assert.equal(await rt.preflight(), false, "chain 143 behind the fork URL => refused");
  assert.equal(reads.length, 0, "no code read when the chain id is wrong");
  chainId = 31337143;
  assert.equal(await rt.preflight(), false, "escrow code not the A-935 runtime => refused");
  assert.deepEqual(reads, [ESCROW], "only the escrow was read; the pins were not reached");
  escrowCode = "0x";
  assert.equal(await rt.preflight(), false, "no escrow code => refused");
  assert.equal(typeof rt.preflight.status, "function");
});

await check("escrow runtime pin = A-935 DEPLOY_PACKET runtime keccak (private packet; skipped in a public checkout)", () => {
  const p = privatePath("ops/receipts/A935_gift_mainnet_deploy/DEPLOY_PACKET.md");
  if (!existsSync(p)) { console.log("      (skip: private packet absent)"); return; }
  assert.ok(readFileSync(p, "utf8").includes(RT.GIFT_SPONSOR_FORK_ESCROW_RUNTIME_KECCAK), "pin appears in the A-935 packet");
});

await check("fork policy builder still refuses the 143 id path (A-946 contract kept)", () => {
  assert.deepEqual(Object.keys(RT.GIFT_SPONSOR_FORK_PINS.hashes), ["31337143"]);
  assert.equal(RT.giftSponsorForkChainDef("http://127.0.0.1:1").id, 31337143);
});

console.log(`\na961-fork-sponsor-runtime: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
