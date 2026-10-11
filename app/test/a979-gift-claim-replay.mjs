// [A-979 ①] Gift claim replay (relayer 409 / 503 after our own earlier success) — the same rule as the 200 path (A-966 O1):
//   "ours" = the escrow's Committed(giftId, committer = us, commitHash = ours) log IN the commit tx receipt (status success),
//   "claimed" = gifts(giftId).claimed === true. The real escrow's claim() deletes commits[giftId][committer], so commits() at latest
//   can no longer prove it. The commit tx is found with eth_getLogs over the last 100 blocks (Monad's getLogs block limit); anything
//   else (no getLogs, older than the window, a log the receipt does not carry, not claimed, someone else's commit) fails closed = commit_failed.
//   Every Gift chain (10143 · 143 · the fork 31337143) uses the same rule. Node only, no network, no tx.
//   node app/test/a979-gift-claim-replay.mjs
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex } from "viem";
import { hashClaimToken } from "../src/gift-piggy-claim-link.js";
import { FORK_CHAIN_ID } from "../src/funding-context.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
async function check(label, fn) { try { await fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${String(e?.stack || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; } }

const ESCROW = "0x20305e402357B51880eF0b5C29758db7B970d93c"; const SPONSOR = "0xAA4cc35BABBC9F2C8c2336E1AB1fcc2B265845F8";
const OTHER = "0xDbA40Dd271190e1B090F80fB1999323952F6b761"; const GIFT = `0x${"89".repeat(32)}`;
const NOW = 1_800_000_000; const FAKE = "0x6001"; const Z32 = `0x${"0".repeat(64)}`;
const T0 = keccak256(stringToHex("Committed(bytes32,address,bytes32)"));
const T_CLAIMED = keccak256(stringToHex("Claimed(bytes32,address,address,uint256)")); // GiftPiggyUSDC.sol:141 (A-935 escrow source)
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const piggy = privateKeyToAccount(generatePrivateKey());
const topicOf = (a) => `0x${"0".repeat(24)}${a.slice(2).toLowerCase()}`;
const H = (c) => `0x${c.repeat(32)}`;
const COMMIT_TX = H("c1"); const CLAIM_TX = H("c2"); const HEAD = 5_000n;

// pin-substituted copy (same technique as a906 / a913 / a966: only the code-hash constants change)
const TMP_S = path.join(HERE, "_a979_tmp_sponsor.mjs"); const TMP_N = path.join(HERE, "_a979_tmp_entry.mjs");
let M; let E;
try {
  const srcS = readFileSync(path.resolve(HERE, "../src/gift-sponsor-7702.js"), "utf8");
  const block = srcS.slice(srcS.indexOf("codeHash: Object.freeze({"), srcS.indexOf("export const GIFT_SPONSOR_CHAINS"));
  writeFileSync(TMP_S, srcS.replace(block, block.replace(/"0x[0-9a-f]{64}"/g, `"${keccak256(FAKE)}"`)));
  writeFileSync(TMP_N, readFileSync(path.resolve(HERE, "../src/gift-claim-entry.js"), "utf8").replace(/from "\.\/gift-sponsor-7702\.js"/g, 'from "./_a979_tmp_sponsor.mjs"').replace(/from "\.\/(?!_a979)/g, 'from "../src/'));
  M = await import("./_a979_tmp_sponsor.mjs"); E = await import("./_a979_tmp_entry.mjs");
} catch (e) { console.log(`FAIL  copy setup ${e.message}`); fail += 1; }

if (M && E) {
  const TOKEN = "token-a979";
  const record = { giftId: GIFT, senderAddress: OTHER, claimTokenHash: await hashClaimToken(TOKEN), expiresAt: new Date((NOW + 7 * 86400) * 1000).toISOString() };
  const { binding } = E.bindGiftToNewPiggy({ intent: { giftId: GIFT, token: TOKEN }, piggy: { address: piggy.address, sequence: 1 }, preExistingAddresses: [], signerAddress: piggy.address });
  const account = { address: piggy.address, signAuthorization: (a) => piggy.signAuthorization(a), signTypedData: (t) => piggy.signTypedData(t) };
  const scopeOf = { 10143: "monad-testnet", 143: "monad-mainnet", [FORK_CHAIN_ID]: "monad-fork" };

  // A REAL-escrow chain after an earlier successful claim: commits() reads zero, gifts().claimed is true, the commit tx receipt carries the
  // Committed log. getLogs filters by emitter / giftId / committer / block range like an RPC node does.
  //   commitHash(req) = the hash the earlier (successful) attempt committed; default = the replayed request's own hash (a transport re-send).
  const mkChain = (chainId, o = {}) => {
    const { claimed = true, logBlock = HEAD - 3n, logHash = null, emitter = ESCROW, receiptLogs = true, receiptStatus = "success", getLogs = true, getLogsThrows = false, client,
      // [A-979 ① r2] who the escrow paid: Claimed(giftId, recipient, token, amount) in the claim tx (default = us)
      claimedTo = piggy.address, claimLog = true, claimReceiptLogs = true, claimReceiptStatus = "success", claimEmitter = ESCROW, claimBlock = HEAD - 2n } = o;
    const seen = { getLogs: [], receipts: [] };
    const commitHash = () => logHash ?? client.lastCommit;
    const theLog = () => ({ address: emitter, topics: [T0, GIFT, topicOf(piggy.address)], data: commitHash(), blockNumber: logBlock, transactionHash: COMMIT_TX });
    const claimedLog = () => ({ address: claimEmitter, topics: [T_CLAIMED, GIFT, topicOf(claimedTo)], data: `0x${"0".repeat(24)}${USDC.slice(2).toLowerCase()}${(20_000_000n).toString(16).padStart(64, "0")}`, blockNumber: claimBlock, transactionHash: CLAIM_TX });
    const chain = {
      chain: { id: chainId }, getTransactionCount: async () => 0n, getCode: async () => FAKE,
      getBlock: async () => ({ timestamp: BigInt(NOW) }), getBlockNumber: async () => HEAD,
      waitForTransactionReceipt: async ({ hash }) => {
        seen.receipts.push(hash);
        if (hash === CLAIM_TX) return { status: claimReceiptStatus, blockNumber: claimBlock, logs: claimReceiptLogs ? [claimedLog()] : [] };
        return { status: receiptStatus, blockNumber: logBlock, logs: hash === COMMIT_TX && receiptLogs ? [theLog()] : [] };
      },
      getTransaction: async () => ({ to: ESCROW, from: SPONSOR }),
      readContract: async ({ functionName }) => (functionName === "commits" ? (claimed ? [Z32, 0n] : [commitHash(), logBlock]) : [OTHER, ESCROW, 1n, 0n, claimed, "0x"]),
      ...(getLogs ? { getLogs: async (q) => {
        seen.getLogs.push(q);
        if (getLogsThrows) throw new Error("rpc: block range too large");
        const claimedQ = q.event?.name === "Claimed";
        if (claimedQ && !claimLog) return [];
        const l = claimedQ ? claimedLog() : theLog();
        // the node filters by the indexed args it was asked for (Claimed: giftId + recipient)
        if (claimedQ && q.args?.recipient && String(q.args.recipient).toLowerCase() !== String(claimedTo).toLowerCase()) return [];
        if (claimedQ) { const ok = BigInt(q.fromBlock) <= l.blockNumber && l.blockNumber <= BigInt(q.toBlock) && String(q.address).toLowerCase() === String(claimEmitter).toLowerCase(); return ok ? [l] : []; }
        const inRange = BigInt(q.fromBlock) <= l.blockNumber && l.blockNumber <= BigInt(q.toBlock);
        const sameEmitter = String(q.address).toLowerCase() === String(emitter).toLowerCase();
        return inRange && sameEmitter ? [l] : [];
      } } : {}),
    };
    return { chain, seen };
  };
  const replayClient = (status) => { const c = { posts: 0, async submit(req) { c.posts += 1; c.lastCommit = M.sponsorCommitHash(req.claim); return { status, body: { ok: false, error: "not_available" } }; } }; return c; };
  const run = async (chainId, { status = 409, ...o } = {}) => {
    const client = replayClient(status);
    const { chain, seen } = mkChain(chainId, { ...o, client });
    const sub = E.createGiftSponsorClaimSubmitter({ config: { chainId, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 300 }, chain, sponsorClient: client, chainScope: scopeOf[chainId], now: () => NOW, randomBytes: () => new Uint8Array(32).fill(7) });
    assert.ok(sub, `submitter ${chainId}`);
    const out = await sub.submit({ binding, record, token: TOKEN, account });
    return { out, seen, client };
  };
  const CHAINS = [10143, 143, FORK_CHAIN_ID];

  await check("① 409 / 503 after our own earlier success on the REAL escrow (commit deleted) = already_claimed_verified, proved by the Committed log in the commit receipt — every Gift chain", async () => {
    for (const id of CHAINS) for (const status of [409, 503]) {
      const r = await run(id, { status });
      assert.equal(r.out.status, "already_claimed_verified", `${id}/${status} ${JSON.stringify(r.out)}`);
      assert.deepEqual(r.out.txHashes, {});
      assert.ok(r.seen.receipts.includes(COMMIT_TX), "the commit receipt itself is read");
      assert.ok(r.seen.receipts.includes(CLAIM_TX), "the claim receipt itself is read (who was paid)");
    }
  });
  await check("① the log search is the escrow's Committed event for this gift + this committer, over at most the last 100 blocks", async () => {
    const r = await run(143);
    assert.equal(r.seen.getLogs.filter((x) => x.event?.name === "Committed").length, 1);
    const q = r.seen.getLogs.find((x) => x.event?.name === "Committed");
    assert.equal(String(q.address).toLowerCase(), ESCROW.toLowerCase());
    assert.equal(String(q.args?.giftId).toLowerCase(), GIFT);
    assert.equal(String(q.args?.committer).toLowerCase(), piggy.address.toLowerCase());
    assert.equal(q.event?.name, "Committed");
    assert.equal(BigInt(q.toBlock), HEAD);
    assert.ok(BigInt(q.toBlock) - BigInt(q.fromBlock) <= 99n, `range ${q.fromBlock}..${q.toBlock}`);
  });
  await check("① fail closed (commit_failed): not claimed · someone else's commit hash · log outside the 100-block window · log not in the receipt · reverted commit · other emitter · no getLogs · getLogs throws", async () => {
    const cases = {
      notClaimed: { claimed: false }, otherCommit: { logHash: H("42") }, oldLog: { logBlock: HEAD - 100n }, receiptLacksLog: { receiptLogs: false },
      reverted: { receiptStatus: "reverted" }, otherEmitter: { emitter: OTHER }, noGetLogs: { getLogs: false }, getLogsThrows: { getLogsThrows: true },
    };
    for (const id of CHAINS) for (const [name, o] of Object.entries(cases)) {
      const r = await run(id, o);
      assert.equal(r.out.status, "commit_failed", `${id} ${name} ${JSON.stringify(r.out)}`);
    }
  });
  // [A-979 ① r2 · opus spot] a stranger with the same link commits + claims to HIMSELF first; our relay then answers 409. Our Committed log is real and
  // gifts().claimed is true, but the escrow paid someone else: never already_claimed_verified. The escrow's Claimed(giftId, recipient = us) log in a
  // successful claim receipt, inside the same <=100-block window, is required.
  await check("① stranger claimed first (Claimed recipient != us) = commit_failed; Claimed log missing / not in the receipt / reverted / other emitter / outside the window = commit_failed", async () => {
    const cases = {
      strangerClaimed: { claimedTo: OTHER }, noClaimedLog: { claimLog: false }, claimReceiptLacksLog: { claimReceiptLogs: false },
      claimReverted: { claimReceiptStatus: "reverted" }, claimOtherEmitter: { claimEmitter: OTHER }, claimOldBlock: { claimBlock: HEAD - 100n },
    };
    for (const id of CHAINS) for (const status of [409, 503]) for (const [name, o] of Object.entries(cases)) {
      const r = await run(id, { status, ...o });
      assert.equal(r.out.status, "commit_failed", `${id}/${status} ${name} ${JSON.stringify(r.out)}`);
    }
  });
  await check("① the Claimed search is the escrow's Claimed event for this gift + recipient = us, over the same <=100-block window", async () => {
    const r = await run(143);
    const q = r.seen.getLogs.find((x) => x.event?.name === "Claimed");
    assert.ok(q, "Claimed searched");
    assert.equal(String(q.address).toLowerCase(), ESCROW.toLowerCase());
    assert.equal(String(q.args?.giftId).toLowerCase(), GIFT);
    assert.equal(String(q.args?.recipient).toLowerCase(), piggy.address.toLowerCase());
    assert.equal(BigInt(q.toBlock), HEAD);
    assert.ok(BigInt(q.toBlock) - BigInt(q.fromBlock) <= 99n);
  });
  await check("① a chain without getLogs still makes a submitter (143 / 10143 creation unchanged); other refusals (400) never read the chain", async () => {
    for (const id of CHAINS) {
      const r = await run(id, { status: 400 });
      assert.equal(r.out.status, "commit_failed");
      assert.equal(r.seen.getLogs.length, 0); assert.equal(r.seen.receipts.length, 0);
    }
  });
}
for (const f of [TMP_S, TMP_N]) { try { rmSync(f); } catch {} }

// [A-979 ④] every place the A-961 fork fee / gas fixtures live carries "fork virtual cost (not measured)" (private files: skipped in a public checkout)
await check("④ fork virtual cost (not measured): fork gas units · buffer · MON/USD fixture are labelled where they are set (harness · tests) and corrected in the A-961 / A-966 RECEIPTs", () => {
  const LABEL = "fork virtual cost (not measured)";
  const REPO = path.resolve(HERE, "../..");
  const at = (p) => { try { return readFileSync(path.join(REPO, p), "utf8"); } catch { return null; } };
  const places = {
    "_private/ops/harness/a961-gift-fork/run.mjs": [/const GAS_UNITS = \{ install: 120000/, /const BUFFER_BPS = 2000;/],
    "_private/ops/harness/a961-gift-fork/a966-app-run.mjs": [/const GAS_UNITS = "120000,400000,120000,250000";/, /const BUFFER_BPS = "2000";/, /const MON_USD_FIXTURE = "0\.03";/],
    "app/test/a961-fork-sponsor-runtime.mjs": [/const forkEnv = /],
    "app/test/a913-fork-sponsor.mjs": [/const CLAIM_GAS_UNITS = 80_000;/, /const GAS_UNITS = \{ install: 50_000/],
    "app/test/a915-fork-create.mjs": [/const CLAIM_GAS_UNITS = 80_000;/, /const GAS_UNITS = \{ install: 50_000/],
  };
  let seen = 0;
  for (const [p, res] of Object.entries(places)) {
    const t = at(p); if (t === null) continue;
    const lines = t.split("\n");
    for (const re of res) {
      const i = lines.findIndex((l) => re.test(l));
      assert.ok(i >= 0, `${p} ${re}`);
      assert.ok(lines[i].includes(LABEL) || lines[i - 1].includes(LABEL), `${p}:${i + 1} lacks the label`);
      seen += 1;
    }
  }
  const a966 = at("app/test/a966-gift-fork.mjs");
  assert.ok(a966.includes(`the fee line uses fork gas + the fork price (${LABEL})`), "a966 test name");
  for (const r of ["_private/ops/receipts/A961_gift_fork/RECEIPT.md", "_private/ops/receipts/A966_gift_fork_app/RECEIPT.md"]) {
    const t = at(r); if (t === null) continue;
    assert.match(t, /## \[A-979 ④ correction[^\n]*fork virtual cost \(not measured\)/, r);
  }
  // [A-983 re-pin] exact count: every app/ place is required; a private-workspace place counts only where it exists (absent in a public checkout /
  // clone, where the old threshold saw 5 and failed). pre-A-983: assert.ok(seen === 0 || seen >= 10, …)
  const expectN = Object.entries(places).reduce((n, [p, res]) => n + (!p.startsWith("app/") && at(p) === null ? 0 : res.length), 0);
  assert.equal(seen, expectN, `labelled places ${seen}`);
});

console.log(`\nA-979 ①: ${pass}/${pass + fail} PASS${fail ? ` · ${fail} FAIL` : ""}`);
process.exit(fail ? 1 : 0);
