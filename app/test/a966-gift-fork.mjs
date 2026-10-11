// [A-966] Gift on the shared fork — app path. Node only, no network, no tx.
//   O1  the sponsor submitter proves the commit by the escrow's Committed log in the commit receipt (claim() deletes the stored commit) — every chain
//   O2  fork only: the delegation window is measured on the fork's latest block time; 143 / 10143 keep the injected wall clock
//   app places: fork pin row · fork create arm (chain-keyed) · fork link path "/j2" · fork record-source seam · main.js [A-966] block
//   item 5: the fork sponsor key vs the mainnet key is compared as an address
//   node app/test/a966-gift-fork.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, keccak256, stringToHex } from "viem";
import { GIFT_SPONSOR_PINS } from "../src/gift-sponsor-7702.js";
import { hashClaimToken, parseClaimUrl } from "../src/gift-piggy-claim-link.js";
import {
  FORK_GIFT_LINK_PATH, FORK_GIFT_SCOPE, GIFT_CREATE_CHAIN_ID, armGiftCreateStep, buildGiftCreateStepCalls, disarmAllGiftCreateSteps, giftCreateStepMatch, planGiftCreate,
} from "../src/gift-create-plan.js";
import { FORK_BOOT_PATH, selectBootProfile } from "../src/boot-profile.js";
import { FORK_CHAIN_ID, FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "../src/funding-context.js";
import { GIFT_ESCROW_COMMITTED_TOPIC0, receiptHasGiftCommit } from "../src/gift-claim-entry.js";
import { readGiftSponsorForkEnv } from "../../api/_lib/gift-sponsor-runtime.js";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
let pass = 0; let fail = 0;
async function check(label, fn) { try { await fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${String(e?.stack || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; } }

const ESCROW = "0x20305e402357B51880eF0b5C29758db7B970d93c"; const SPONSOR = "0xAA4cc35BABBC9F2C8c2336E1AB1fcc2B265845F8";
const OTHER = "0xDbA40Dd271190e1B090F80fB1999323952F6b761"; const GIFT = `0x${"89".repeat(32)}`;
const NOW = 1_800_000_000; const FAKE = "0x6001"; const Z32 = `0x${"0".repeat(64)}`;
const piggy = privateKeyToAccount(generatePrivateKey());
const topicOf = (a) => `0x${"0".repeat(24)}${a.slice(2).toLowerCase()}`;
const H = (c) => `0x${c.repeat(32)}`;

// ── O1 pure check ──
await check("O1 receiptHasGiftCommit: only the escrow's Committed(giftId, committer, commitHash) log in THIS receipt counts", () => {
  assert.equal(GIFT_ESCROW_COMMITTED_TOPIC0, keccak256(stringToHex("Committed(bytes32,address,bytes32)")));
  const C = H("42");
  const log = { address: ESCROW, topics: [GIFT_ESCROW_COMMITTED_TOPIC0, GIFT, topicOf(piggy.address)], data: C };
  const q = { escrow: ESCROW, giftId: GIFT, committer: piggy.address, commitHash: C };
  assert.equal(receiptHasGiftCommit({ logs: [log] }, q), true);
  assert.equal(receiptHasGiftCommit({ logs: [{ ...log, address: ESCROW.toUpperCase().replace("0X", "0x") }] }, q), true); // address case
  for (const bad of [
    { ...log, address: OTHER }, { ...log, topics: [keccak256(stringToHex("Claimed(bytes32,address,address,uint256)")), GIFT, topicOf(piggy.address)] },
    { ...log, topics: [GIFT_ESCROW_COMMITTED_TOPIC0, H("77"), topicOf(piggy.address)] }, { ...log, topics: [GIFT_ESCROW_COMMITTED_TOPIC0, GIFT, topicOf(OTHER)] },
    { ...log, data: H("43") }, { ...log, topics: [GIFT_ESCROW_COMMITTED_TOPIC0, GIFT] },
  ]) assert.equal(receiptHasGiftCommit({ logs: [bad] }, q), false, JSON.stringify(bad).slice(0, 80));
  for (const r of [{}, { logs: [] }, null, undefined, { logs: "x" }]) assert.equal(receiptHasGiftCommit(r, q), false);
  assert.equal(receiptHasGiftCommit({ logs: [log] }, { ...q, commitHash: "0x42" }), false);
});

// ── submitter through a PIN-SUBSTITUTED copy (same technique as a906 / a913: only the code-hash constants change) ──
const TMP_S = path.join(HERE, "_a966_tmp_sponsor.mjs"); const TMP_N = path.join(HERE, "_a966_tmp_entry.mjs");
let M; let E;
try {
  const srcS = readFileSync(path.resolve(HERE, "../src/gift-sponsor-7702.js"), "utf8");
  const block = srcS.slice(srcS.indexOf("codeHash: Object.freeze({"), srcS.indexOf("export const GIFT_SPONSOR_CHAINS"));
  writeFileSync(TMP_S, srcS.replace(block, block.replace(/"0x[0-9a-f]{64}"/g, `"${keccak256(FAKE)}"`)));
  writeFileSync(TMP_N, readFileSync(path.resolve(HERE, "../src/gift-claim-entry.js"), "utf8").replace(/from "\.\/gift-sponsor-7702\.js"/g, 'from "./_a966_tmp_sponsor.mjs"').replace(/from "\.\/(?!_a966)/g, 'from "../src/'));
  M = await import("./_a966_tmp_sponsor.mjs"); E = await import("./_a966_tmp_entry.mjs");
} catch (e) { console.log(`FAIL  copy setup ${e.message}`); fail += 1; }
const timestampOf = (request) => { const t = request.delegation.caveats[2].terms; return { after: BigInt(`0x${t.slice(2, 34)}`), before: BigInt(`0x${t.slice(34, 66)}`) }; };

if (M && E) {
  const TOKEN = "token-a966";
  const record = { giftId: GIFT, senderAddress: OTHER, claimTokenHash: await hashClaimToken(TOKEN), expiresAt: new Date((NOW + 7 * 86400) * 1000).toISOString() };
  const { binding } = E.bindGiftToNewPiggy({ intent: { giftId: GIFT, token: TOKEN }, piggy: { address: piggy.address, sequence: 1 }, preExistingAddresses: [], signerAddress: piggy.address });
  const account = { address: piggy.address, signAuthorization: (a) => piggy.signAuthorization(a), signTypedData: (t) => piggy.signTypedData(t) };
  // a REAL-escrow chain: claim() deletes the commit; the commit receipt carries the Committed log (unless `noLog` / `logHash` say otherwise)
  const mkChain = (chainId, { blockTime = null, noLog = false, logHash = null, getBlock = true, client } = {}) => {
    const reads = { getBlock: 0 };
    const chain = {
      chain: { id: chainId }, getTransactionCount: async () => 0n, getCode: async () => FAKE,
      waitForTransactionReceipt: async ({ hash }) => ({ status: "success", blockNumber: 5n, logs: hash === H("c1") && !noLog ? [{ address: ESCROW, topics: [GIFT_ESCROW_COMMITTED_TOPIC0, GIFT, topicOf(piggy.address)], data: logHash ?? client.lastCommit }] : [] }),
      getTransaction: async () => ({ to: ESCROW, from: SPONSOR }),
      readContract: async ({ functionName }) => (functionName === "commits" ? [Z32, 0n] : [OTHER, ESCROW, 1n, 0n, true, "0x"]),
      ...(getBlock ? { getBlock: async () => { reads.getBlock += 1; return { timestamp: BigInt(blockTime) }; } } : {}),
    };
    return { chain, reads };
  };
  const okClient = () => { const c = { posts: 0, reqs: [], async submit(req) { c.posts += 1; c.reqs.push(req); c.lastCommit = M.sponsorCommitHash(req.claim); return { status: 200, body: { ok: true, state: "CLAIMED", giftId: req.giftId, installTxHash: null, commitTxHash: H("c1"), claimTxHash: H("c2") } }; } }; return c; };
  const scopeOf = { 10143: "monad-testnet", 143: "monad-mainnet", [FORK_CHAIN_ID]: "monad-fork" };
  const run = async (chainId, opts = {}) => {
    const client = okClient();
    const { chain, reads } = mkChain(chainId, { ...opts, client });
    const sub = E.createGiftSponsorClaimSubmitter({ config: { chainId, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 300 }, chain, sponsorClient: client, chainScope: scopeOf[chainId], now: () => NOW, randomBytes: () => new Uint8Array(32).fill(7) });
    if (!sub) return { sub: null };
    const out = await sub.submit({ binding, record, token: TOKEN, account });
    return { sub, out, client, reads };
  };

  await check("O1 every Gift chain (10143 · 143 · fork): a successful claim on the real escrow (commit deleted) = value_transferred, verified by the Committed log", async () => {
    for (const id of [10143, 143, FORK_CHAIN_ID]) {
      const r = await run(id, { blockTime: NOW - 375000 });
      assert.equal(r.out.status, "value_transferred", `${id} ${JSON.stringify(r.out)}`);
      assert.equal(r.client.posts, 1);
    }
  });
  await check("O1 refusals: no Committed log, or a log for another commit hash = commit_unverified (never value_transferred)", async () => {
    for (const id of [143, FORK_CHAIN_ID]) {
      assert.equal((await run(id, { blockTime: NOW, noLog: true })).out.status, "commit_unverified", String(id));
      assert.equal((await run(id, { blockTime: NOW, logHash: H("42") })).out.status, "commit_unverified", String(id));
    }
  });
  await check("O2 fork: the window is the fork's latest block time (+300), not the wall clock; 143 / 10143: the injected now (+300), getBlock never read", async () => {
    const forkTime = NOW - 375000; // the local fork ran ~4.3 days behind the wall clock (A-961 steps.clock)
    const f = await run(FORK_CHAIN_ID, { blockTime: forkTime });
    assert.equal(f.reads.getBlock, 1);
    assert.deepEqual(timestampOf(f.client.reqs[0]), { after: 0n, before: BigInt(forkTime + 300) });
    for (const id of [143, 10143]) {
      const r = await run(id, { blockTime: forkTime });
      assert.equal(r.reads.getBlock, 0, String(id));
      assert.deepEqual(timestampOf(r.client.reqs[0]), { after: 0n, before: BigInt(NOW + 300) }, String(id));
    }
  });
  await check("O2 fork submitter needs getBlock (no clock = no submitter); an unreadable block time stops before Face ID (commit_failed, 0 relayer calls)", async () => {
    assert.equal((await run(FORK_CHAIN_ID, { getBlock: false })).sub, null);
    assert.ok((await run(143, { getBlock: false })).sub, "143 does not need getBlock");
    const bad = await run(FORK_CHAIN_ID, { blockTime: 0 });
    assert.equal(bad.out.status, "commit_failed");
    assert.equal(bad.client.posts, 0);
  });
  await check("O2 fork: a Gift deadline already passed on the fork clock is refused before Face ID (guard_refused gift_deadline_invalid)", async () => {
    const r = await run(FORK_CHAIN_ID, { blockTime: NOW + 8 * 86400 });
    assert.equal(r.out.status, "guard_refused"); assert.equal(r.out.reason, M.GIFT_SPONSOR_REFUSAL.GIFT_DEADLINE_INVALID); assert.equal(r.client.posts, 0);
  });
}
for (const f of [TMP_S, TMP_N]) { try { rmSync(f); } catch {} }

// ── app place 1: the fork pin row ──
await check("pin table: the fork row (31337143) equals the mainnet row value for value; the 10143 / mainnet rows are the pre-A-966 values", () => {
  const T = GIFT_SPONSOR_PINS.codeHash;
  assert.deepEqual({ ...T[FORK_CHAIN_ID] }, { ...T[GIFT_CREATE_CHAIN_ID] });
  assert.ok(Object.isFrozen(T[FORK_CHAIN_ID]));
  assert.deepEqual(Object.keys(T).sort(), ["10143", "143", String(FORK_CHAIN_ID)].sort());
  const sha = (o) => keccak256(stringToHex(JSON.stringify(o)));
  assert.equal(sha(T[GIFT_CREATE_CHAIN_ID]), sha({ delegationManager: "0x85674a6f4a65e3b61df3b6d45a89f2bf6165efda91a83610b797ff917f64866f", statelessDelegate: "0xd4dee59ae6be4a997964e8f19ae6905f0a233c6ae88d9bc5d945bc60738376c1", exactExecutionEnforcer: "0xd695eefffb5a4da6d7db7dbae12d3a85dff43d9b274b1217ad1498d73539dc5e", limitedCallsEnforcer: "0x3a07a1b31d8f8f29cde4260f88fc5011e003e4bdbd519c8274fc7092d2356468", timestampEnforcer: "0x1da353833766081398664c131a50988f6f7190d6a1a974f497607b974705900c" }));
  assert.equal(sha(T[10143]), sha({ delegationManager: "0x292b39ef44a63d81e9a8080b185a5449ed4b8ce74436177ca8f475fefd78807b", statelessDelegate: "0x399646560cadf8e8f30b232c75d0be4e629939b4eba8019589c6d0d4b69ff9f9", exactExecutionEnforcer: "0xd695eefffb5a4da6d7db7dbae12d3a85dff43d9b274b1217ad1498d73539dc5e", limitedCallsEnforcer: "0x3a07a1b31d8f8f29cde4260f88fc5011e003e4bdbd519c8274fc7092d2356468" }));
});

// ── app place 2: the sender create step on the fork ──
const GAS = { gasUnits: { install: 120000n, commitClaim: 400000n, revoke: 120000n, claim: 250000n, fundingTransfer: 21000n }, feeInputs: { maxFeePerGasWei: 200_000_000_000n, source: "a966 test" }, safety: { bufferBps: 2000 } };
const FESCROW = "0xde5e2b28ea7da624e9fdf881714bf3d615485c4d";
const plan = async (scope, chainId) => planGiftCreate({ chainScope: scope, presetLabel: 20, senderAddress: piggy.address, expiry: NOW + 86400, origin: "http://localhost:5173", gas: GAS, sponsor: { sponsorAddress: SPONSOR, chainId } });
await check("create arm: a fork plan (31337143 + monad-fork + the fork USDC) arms; its steps never match a mainnet tx (keys carry the chain); the mainnet arm is unchanged", async () => {
  disarmAllGiftCreateSteps();
  const p = await plan(FORK_GIFT_SCOPE, FORK_CHAIN_ID);
  assert.equal(p.ok, true, p.reason);
  const built = buildGiftCreateStepCalls(p, { escrowAddress: FESCROW });
  assert.equal(built.calls[0].to.toLowerCase(), FUNDING_CONTEXT_TOKEN_ALLOWLIST["monad-fork"].USDC.assetId.toLowerCase());
  const armed = armGiftCreateStep(p, built.calls, { escrowAddress: FESCROW });
  assert.equal(armed.ok, true, armed.reason);
  const base = { type: "eip1559", nonce: 0, gas: 100000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n };
  for (const c of built.calls) {
    assert.equal(giftCreateStepMatch({ ...base, chainId: GIFT_CREATE_CHAIN_ID, to: c.to, value: c.value, data: c.data }), null, `${c.label}: a fork-armed step is not a mainnet step`);
    assert.equal(giftCreateStepMatch({ ...base, chainId: FORK_CHAIN_ID, to: c.to, value: c.value, data: c.data }), null, `${c.label}: the matcher answers mainnet only`);
  }
  armed.disarm();
  // the mainnet create step: arms and matches exactly as before
  const m = await plan("monad-mainnet", GIFT_CREATE_CHAIN_ID);
  const mb = buildGiftCreateStepCalls(m, { escrowAddress: ESCROW });
  const ma = armGiftCreateStep(m, mb.calls, { escrowAddress: ESCROW });
  assert.equal(ma.ok, true, ma.reason);
  assert.deepEqual(mb.calls.map((c) => giftCreateStepMatch({ ...base, chainId: GIFT_CREATE_CHAIN_ID, to: c.to, value: c.value, data: c.data })), ["approve", "create", "gas_deposit"]);
  ma.disarm();
});
await check("create arm refuses a mixed pair (fork id + mainnet scope · mainnet id + fork scope) and any other chain (10143)", async () => {
  const f = await plan(FORK_GIFT_SCOPE, FORK_CHAIN_ID);
  const m = await plan("monad-mainnet", GIFT_CREATE_CHAIN_ID);
  const t = await plan("monad-testnet", 10143);
  const mixed1 = { ...f, record: { ...f.record, chainId: "monad-mainnet" } };
  const mixed2 = { ...m, record: { ...m.record, chainId: FORK_GIFT_SCOPE } };
  for (const p of [mixed1, mixed2, t]) {
    const b = buildGiftCreateStepCalls(p, { escrowAddress: ESCROW });
    assert.equal(armGiftCreateStep(p, b.calls, { escrowAddress: ESCROW }).reason, "sponsor_chain_invalid");
  }
});

// ── app place 4: the link boots the profile it was made on ──
await check("link: a fork Gift link is <origin>/j2#g=…&t=…&v=1 (boot-profile FORK_BOOT_PATH); every other scope keeps /claim; the fragment parses the same", async () => {
  assert.equal(FORK_GIFT_LINK_PATH, FORK_BOOT_PATH);
  const f = await plan(FORK_GIFT_SCOPE, FORK_CHAIN_ID);
  const m = await plan("monad-mainnet", GIFT_CREATE_CHAIN_ID);
  const t = await planGiftCreate({ chainScope: "monad-testnet", presetLabel: 20, senderAddress: piggy.address, expiry: NOW + 86400, origin: "http://localhost:5173" });
  assert.match(f.claimUrl, /^http:\/\/localhost:5173\/j2#g=0x[0-9a-f]{64}&t=[^&]+&v=1$/);
  assert.match(m.claimUrl, /^http:\/\/localhost:5173\/claim#g=/);
  assert.match(t.claimUrl, /^http:\/\/localhost:5173\/claim#g=/);
  const pf = parseClaimUrl(f.claimUrl);
  assert.deepEqual([pf.ok, pf.giftId, pf.token], [true, f.fragment.giftId, f.fragment.token]);
  const env = { VITE_ARASO_FORK_RPC_URL: "https://fork-public.invalid/rpc", VITE_ARASO_FORK_INSTANCE_ID: "fork-1" };
  assert.equal(selectBootProfile({ pathname: new URL(f.claimUrl).pathname, env, releaseLevel: 2 }).id, "monad-fork");
  assert.equal(selectBootProfile({ pathname: new URL(f.claimUrl).pathname, env, releaseLevel: 1 }).id, "monad-testnet"); // level 1: never the fork
  assert.equal(selectBootProfile({ pathname: new URL(m.claimUrl).pathname, env, releaseLevel: 2 }).id, "monad-testnet"); // "/claim" = the build profile, unchanged
});

// ── the fork record-source seam ──
await check("record seam: only a client on the fork's own chain id is accepted, once; beginGiftClaim uses it only when the caller passes no source", async () => {
  const S = await import("../src/gift-claim-entry.js?a966-seam");
  const pending = { status: S.GIFT_ENTRY_STATUS.READY, giftId: GIFT, token: "t" };
  assert.equal((await S.beginGiftClaim({ pending, recordSource: null })).status, S.GIFT_ENTRY_STATUS.RECORD_SOURCE_UNAVAILABLE); // nothing set = as before
  const reads = [];
  const client = (id) => ({ chain: { id }, readContract: async (a) => { reads.push(a.functionName); return [OTHER, OTHER, 0n, 0n, false, Z32]; } });
  assert.equal(S.useForkGiftRecordSource({ client: client(143), contractAddress: FESCROW }), false);
  assert.equal(S.useForkGiftRecordSource({ client: client(10143), contractAddress: FESCROW }), false);
  assert.equal(S.useForkGiftRecordSource({ client: client(FORK_CHAIN_ID), contractAddress: "0x1" }), false);
  assert.equal((await S.beginGiftClaim({ pending, recordSource: null })).status, S.GIFT_ENTRY_STATUS.RECORD_SOURCE_UNAVAILABLE);
  assert.equal(S.useForkGiftRecordSource({ client: client(FORK_CHAIN_ID), contractAddress: FESCROW }), true);
  assert.equal(S.useForkGiftRecordSource({ client: client(FORK_CHAIN_ID), contractAddress: FESCROW }), false, "once per page");
  assert.equal((await S.beginGiftClaim({ pending, recordSource: null })).status, S.GIFT_ENTRY_STATUS.UNKNOWN_LINK); // read through the fork source (zero gift = unknown)
  assert.deepEqual(reads, ["gifts"]);
  const own = { getRecordByGiftId: async () => null };
  assert.equal((await S.beginGiftClaim({ pending, recordSource: own })).status, S.GIFT_ENTRY_STATUS.UNKNOWN_LINK);
  assert.deepEqual(reads, ["gifts"], "a caller's own source wins; the fork source is not read");
});

// ── item 5: fork key vs mainnet key ──
await check("fork sponsor env: the same key as the mainnet sponsor is refused with or without 0x / any case / spaces; a different key passes", () => {
  const k = generatePrivateKey();
  const env = (forkKey, mainKey) => ({ GIFT_SPONSOR_FORK_PRIVATE_KEY: forkKey, GIFT_SPONSOR_PRIVATE_KEY: mainKey, GIFT_SPONSOR_FORK_RPC_URL: "http://127.0.0.1:1", GIFT_SPONSOR_FORK_ESCROW_ADDRESS: FESCROW, GIFT_SPONSOR_FORK_GAS_UNITS: "1,2,3,4", GIFT_SPONSOR_FORK_GAS_BUFFER_BPS: "0", GIFT_SPONSOR_FORK_LEASE_SECONDS: "120", GIFT_SPONSOR_FORK_LEDGER_DIR: "/tmp/none" });
  for (const main of [k, k.slice(2), k.toUpperCase().replace("0X", "0x"), ` ${k.slice(2).toUpperCase()} `]) {
    assert.throws(() => readGiftSponsorForkEnv(env(k, main)), /GIFT_SPONSOR_FORK_KEY_IS_143_KEY/, main.slice(0, 6));
  }
  assert.throws(() => readGiftSponsorForkEnv(env(k.slice(2), k)), /GIFT_SPONSOR_FORK_KEY_IS_143_KEY/);
  assert.equal(readGiftSponsorForkEnv(env(k, generatePrivateKey())).privateKey, k);
  assert.equal(readGiftSponsorForkEnv(env(k, undefined)).privateKey, k);
  assert.equal(privateKeyToAccount(k).address.length, 42);
});

// ── app place 3: the main.js [A-966] block ──
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
// [A-977 RE-PIN] the later [A-977] Job 10 fork block is cut before the preservation compares (pre-A-977: MAIN as is)
const A977_CUT = (s) => s.replace(/^\/\/ ── \[A-977\] Job 10 on the shared fork[\s\S]*?^\/\/ ── \[A-977\] end Job 10 on the shared fork ──\n/m, "");
// [A-1023 RE-PIN] (Owner 10-11 14:1x: only the approved post-ee4fa91 hunks are cut; no whole-card exclusion) receipts/A1023_pin_attribution/ATTRIBUTION.md.
// The delimited [A-979 ④] badge block is cut by its markers; every other approved hunk (A-979 ④ import · A-995 ①②③ · A-995-b) is restored to its
// exact ee4fa91 text and only when it occurs exactly once — anything else stays in place, so any other main.js change still fails this pin.
const A1023_RESTORES = [["A-995 ②③ / A-995-b imports","import { registerA995InlineFace, syncA995GiftEyes } from \"./a995-eye-look.js\";\nimport { mountA995bLoadingPiggy } from \"./a995b-loading-piggy.js\";\n",""],["A-979 ④ import","import { mountForkVirtualMoneyBadge } from \"./fork-virtual-money-badge.js\";\n",""],["A-995 ① breath comment","// [A-995 ①] persistent breath: Owner-selected Sleep strength (x .0091 / y .026) on the existing 4.4 s loop, scaled about the\n","// [A-841 UI-27] persistent subtle breath: the first-arrival values (HOME_T_BREATHE sx 1-.008, sy 1+.014) on a slow loop, scaled about the\n"],["A-995 ① breath coefficients","  el.style.transform = `scale(${(1 - 0.0091 * b).toFixed(5)}, ${(1 + 0.026 * b).toFixed(5)})`;\n","  el.style.transform = `scale(${(1 - 0.008 * b).toFixed(5)}, ${(1 + 0.014 * b).toFixed(5)})`;\n"],["A-995 ② gift eyes (unchanged render)","  if (root && s.html === html) { a911Layout(); void syncA995GiftEyes(root); return; } // nothing changed: leave the DOM (focus, scroll, running transitions) alone\n","  if (root && s.html === html) { a911Layout(); return; } // nothing changed: leave the DOM (focus, scroll, running transitions) alone\n"],["A-995 ② gift eyes (sync)","  void syncA995GiftEyes(a911Root() || document);\n",""],["A-995 ③ tester intro face","  const face = el.querySelector(\".testerIntro__face\");\n  registerA995InlineFace(face);\n",""],["A-995 ③ tester intro blink","    setTimeout(() => el.classList.remove(\"is-closed\"), TESTER_INTRO_BLINK_MS - 120),\n",""],["A-995-b loading bridge","// [A-995-b] Same-turn PWA splash -> loading bridge. The browser cannot paint the first render\n// before this module task ends, so the approved 3.6 s overlay remains the first visible surface.\nmountA995bLoadingPiggy();\n",""]];
const A1023_CUT = (s) => { s = s.replace(/^\/\/ ── \[A-979 ④\] Fork virtual-money badge\.[\s\S]*?^\/\/ ── \[A-979 ④\] end ──\n/m, ""); for (const [, from, to] of A1023_RESTORES) if (s.split(from).length === 2) s = s.replace(from, () => to); return s; };
const BLOCK_RE = /^\/\/ ── \[A-966\] Gift on the shared fork[\s\S]*?^\/\/ ── \[A-966\] end Gift on the shared fork ──\n/m;
const BLOCK = (MAIN.match(BLOCK_RE) || [""])[0];
await check("main.js: exactly one contiguous [A-966] block, right after the [A-960] block and before the Gift fragment boot read; every [A-966] mark inside", () => {
  assert.ok(BLOCK.length > 0);
  assert.equal([...MAIN.matchAll(/\[A-966\]/g)].length, [...BLOCK.matchAll(/\[A-966\]/g)].length);
  const at = MAIN.indexOf(BLOCK);
  assert.equal(MAIN.lastIndexOf("// ── [A-960] end invite link → first grant ──\n", at) + "// ── [A-960] end invite link → first grant ──\n".length, at);
  assert.ok(at < MAIN.indexOf("const pendingRead = readClaimFragment(location.href);"));
});
await check("main.js outside the [A-966] block is byte-equal to the pre-card copy (private workspace)", () => {
  const pre = privatePath("wt/a966d/pre/app/src/main.js");
  if (!existsSync(pre)) { console.log("      (pre-card copy is private-workspace only — skipped)"); return; }
  assert.equal(A1023_CUT(A977_CUT(MAIN)) /* [A-1023 RE-PIN] pre-A-1023: A977_CUT(MAIN) */.replace(BLOCK_RE, "").replace(/^\/\/ ── \[A-974\] Fork app entry[\s\S]*?^\/\/ ── \[A-974\] end fork app entry ──\n/m, "") /* [A-974 re-pin] the later [A-974] fork entry block is cut too; pre-A-974: MAIN.replace(BLOCK_RE, "") */, readFileSync(pre, "utf8"));
});
await check("block: fork-only (forkGift gate + the fork chain id), the mainnet / testnet literals stay null, no new screen / copy / scene / DOM, no key, no mainnet id", () => {
  assert.match(BLOCK, /if \(!journeyFeatureOpen\("forkGift", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\) \|\| CHAIN_PROFILE\.numericChainId !== a966ForkChainId\) return null;/);
  assert.match(BLOCK, /^if \(A966_FORK_GIFT\) \{$/m);
  for (const lit of ["const GIFT_RECORD_CONFIG = null;", "const GIFT_CLAIM_SUBMIT_CONFIG = null;", "const A915_GIFT_CREATE_CONFIG = null;"]) assert.equal(MAIN.split(lit).length, 2, lit);
  const code = BLOCK.replace(/\/\/[^\n]*/g, "");
  assert.equal(/innerHTML|insertAdjacentHTML|document\.|setScene\(|render\(|textContent|`[^`]*<[a-z]/.test(code), false, "no DOM / markup / scene");
  assert.equal(/\b143\b|10143|monad-mainnet|monad-testnet/.test(BLOCK), false, "no mainnet / testnet literal");
  assert.equal(/PRIVATE_KEY|privateKey|localStorage|sessionStorage|console\./.test(code), false, "no key / storage / logging");
  assert.equal(/\b0x[0-9a-fA-F]{40}\b/g.test(code) && [...code.matchAll(/\b0x[0-9a-fA-F]{40}\b/g)].length === 1, true, "one address literal: the fork escrow");
  assert.match(BLOCK, /const A966_FORK_GIFT_ESCROW = "0xde5e2b28ea7da624e9fdf881714bf3d615485c4d";/);
  assert.match(BLOCK, /deployment: a966GiftDeployment\.FORK_LOCAL_TEST_ONLY \}, \{ allowForkLocal: true \}/);
  assert.match(BLOCK, /a966RpcAllowed\(rpcUrl, \{ profile: CHAIN_PROFILE, dev: a966DevBuild \}\)/);
});
await check("block: on the fork only the 'no transport' end of the claim is replaced; the A-915 executor gets a fork config; the fee line uses fork gas + the fork price (fork virtual cost (not measured))", () => {
  assert.match(BLOCK, /if \(!out \|\| out\.valueSubmission\?\.status !== "claim_transport_unavailable" \|\| !out\.record\) return out;/);
  assert.match(BLOCK, /chainId: a966ForkChainId, escrowAddress: F\.escrow, sponsorAddress: F\.sponsor/);
  for (const re of [/^  a915Cfg = /m, /^  a915PreFaceIdRefusal = /m, /^  a915GiftCreateExecutor = /m, /^  a898Evaluate = /m, /^  a898RefreshMarket = /m, /^  settleBoundGiftClaim = /m]) assert.match(BLOCK, re);
  // the fork create path asks the fork entry server again before it sends (the A-956 rule); the recipient's sponsored claim does not (a new Piggy has no entry)
  assert.match(BLOCK, /return run \? async \(args\) => \(\(await a956ForkMoneyAllowed\(\)\) \? run\(args\) : \{ ok: false, reason: "executor_unavailable" \}\) : null;/);
  assert.match(MAIN, /^async function a956ForkMoneyAllowed\(\) \{$/m);
  assert.match(BLOCK, /gas: GIFT_SEND_CONFIG\.gas \?\? forkGas\(\)/);
  for (const v of ["VITE_ARASO_FORK_GIFT_SPONSOR", "VITE_ARASO_FORK_GIFT_GAS_UNITS", "VITE_ARASO_FORK_GIFT_GAS_BUFFER_BPS", "VITE_ARASO_FORK_MON_USD"]) assert.match(BLOCK, new RegExp(`env\\.${v}`));
  // the claim tail reproduces the base settle's own submission shape (same keys, same label helper)
  assert.match(MAIN, /valueSubmission: \{ status: submission\?\.status \|\| "claim_submit_failed", \.\.\.\(submission\?\.txHashes \? \{ txHashes: submission\.txHashes \} : \{\}\) \},\n  \};\n\}/);
});

console.log(`\nA-966 gift fork: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
