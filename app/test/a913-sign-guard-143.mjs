// [A-913 B] SIGN_GUARD: chainId 143 only for the A-906 brand type-4 tx. Matrix + executor-level proof the signer is never touched otherwise.
//   node app/test/a913-sign-guard-143.mjs     (no network, no tx; pin-substituted COPY of the sponsor module, same technique as a906)
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";
import { SIGN_GUARD, SIGN_GUARD_SPONSOR_CHAIN_ID, preparedSignProblem as realProblem } from "../src/money-executor.js";
import { GIFT_SPONSOR_PINS } from "../src/gift-sponsor-7702.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
async function check(label, fn) { try { await fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${String(e?.stack || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; } }

const ESCROW = "0x20305e402357B51880eF0b5C29758db7B970d93c";
const SPONSOR = "0xAA4cc35BABBC9F2C8c2336E1AB1fcc2B265845F8";
const GIFT = `0x${"89".repeat(32)}`; const COMMIT = `0x${"42".repeat(32)}`;
const NOW = 1_800_000_000; const FAKE = "0x6001";
const piggy = privateKeyToAccount(generatePrivateKey());
const TMP_S = path.join(HERE, "_a913_sg_sponsor.mjs"); const TMP_E = path.join(HERE, "_a913_sg_executor.mjs");

let M; let X;
try {
  const srcS = readFileSync(path.resolve(HERE, "../src/gift-sponsor-7702.js"), "utf8");
  const block = srcS.slice(srcS.indexOf("codeHash: Object.freeze({"), srcS.indexOf("export const GIFT_SPONSOR_CHAINS"));
  writeFileSync(TMP_S, srcS.replace(block, block.replace(/"0x[0-9a-f]{64}"/g, `"${keccak256(FAKE)}"`)));
  // pre-A-915 baseline: the executor copy imported only ./gift-sponsor-7702.js. [A-915 re-pin] it now also imports ./gift-create-plan.js (the armed 143 create-step match, see a915-create-143-sign-guard.mjs); the copy points at the real module. No assertion changed.
  writeFileSync(TMP_E, readFileSync(path.resolve(HERE, "../src/money-executor.js"), "utf8").replace('"./gift-sponsor-7702.js"', "./_a913_sg_sponsor.mjs".replace(/^/, '"').concat('"')).replace('"./gift-create-plan.js"', '"../src/gift-create-plan.js"'));
  M = await import("./_a913_sg_sponsor.mjs"); X = await import("./_a913_sg_executor.mjs");
} catch (e) { console.log(`FAIL  copy setup ${e.message}`); fail += 1; }

async function brandList(chainId) {
  const s = M.createGiftSponsorSession({ config: { chainId, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 300 }, giftId: GIFT, commitHash: COMMIT,
    account: { address: piggy.address, signAuthorization: (a) => piggy.signAuthorization(a), signTypedData: (t) => piggy.signTypedData(t) }, authNonce: 0, now: () => NOW, readCode: async () => FAKE });
  assert.equal((await s.signAuthorization()).ok, true); assert.equal((await s.signDelegation()).ok, true);
  const b = await s.buildRequest(); assert.equal(b.ok, true, b.reason);
  const list = M.toExecutorAuthorizationList(b.request);
  return { list, data: M.giftSponsorRedeemData(list), request: b.request };
}
const TX = (o) => ({ type: "eip7702", nonce: 1, gas: 400_000n, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, to: GIFT_SPONSOR_PINS.delegationManager, value: 0n, ...o });

if (M && X) {
  const b143 = await brandList(143); const b10143 = await brandList(10143);
  const brand143 = TX({ chainId: 143, authorizationList: b143.list, data: b143.data });
  await check("constants: SIGN_GUARD.chainId is still 10143 (frozen); the 143 exception is a separate constant", () => {
    assert.equal(SIGN_GUARD.chainId, 10143); assert.equal(Object.isFrozen(SIGN_GUARD), true); assert.equal(SIGN_GUARD_SPONSOR_CHAIN_ID, 143);
    assert.deepEqual(Object.keys(SIGN_GUARD), ["chainId", "type", "maxGas", "maxFeePerGas", "maxTxFeeWei"]);
  });
  await check("143 + A-906 brand type-4 (pinned list, to = DelegationManager, branded calldata, value 0) => allowed", () => {
    assert.equal(X.preparedSignProblem(brand143), null);
    assert.equal(X.preparedSignProblem({ ...brand143, value: undefined }), null);
  });
  await check("143 + brand but any deviation keeps a refusal (to / data / value / type / list-chain / extras / bounds)", () => {
    const P = X.preparedSignProblem;
    assert.equal(P({ ...brand143, to: ESCROW }), "unexpected_field");
    assert.equal(P({ ...brand143, data: "0x" }), "sponsor_calldata_mismatch");
    assert.equal(P({ ...brand143, data: undefined }), "sponsor_calldata_mismatch");
    assert.equal(P({ ...brand143, value: 1n }), "value_invalid");
    assert.equal(P({ ...brand143, type: "eip1559" }), "tx_type_unexpected");
    assert.equal(P({ ...brand143, type: "legacy" }), "tx_type_unexpected");
    assert.equal(P({ ...brand143, gasPrice: 1n }), "unexpected_field");
    assert.equal(P({ ...brand143, blobs: ["0x"] }), "unexpected_field");
    assert.equal(P({ ...brand143, accessList: [{ address: ESCROW, storageKeys: [] }] }), "access_list_present");
    assert.equal(P({ ...brand143, gas: 3_000_000n }), "gas_out_of_bounds");
    assert.equal(P({ ...brand143, maxFeePerGas: 2_000_000_000_000n }), "fee_out_of_bounds");
    assert.equal(P({ ...brand143, nonce: -1 }), "nonce_invalid");
  });
  await check("143 + NOT the brand => chain_id_mismatch (plain, copy, empty list, forged object, no list)", async () => {
    const P = X.preparedSignProblem;
    const plain = { chainId: 143, type: "eip1559", nonce: 1, gas: 100_000n, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 1n, to: ESCROW, value: 0n, data: "0x" };
    assert.equal(P(plain), "chain_id_mismatch");
    assert.equal(P({ ...plain, value: 5n }), "chain_id_mismatch");
    assert.equal(P({ ...plain, type: "eip7702" }), "chain_id_mismatch");
    assert.equal(P({ ...plain, authorizationList: [] }), "chain_id_mismatch");
    assert.equal(P({ ...brand143, authorizationList: [...b143.list] }), "chain_id_mismatch");                       // a copy is not the minted object
    assert.equal(P({ ...brand143, authorizationList: Object.freeze([{ ...b143.list[0] }]) }), "chain_id_mismatch"); // a forged frozen entry
    assert.equal(P({ ...brand143, authorizationList: undefined }), "chain_id_mismatch");
    assert.equal(P({ ...brand143, authorizationList: null }), "chain_id_mismatch");
    assert.equal(P({ ...brand143, authorizationList: "x" }), "chain_id_mismatch");
    assert.equal(P(null), "prepared_missing"); assert.equal(P(undefined), "prepared_missing"); assert.equal(P({}), "chain_id_mismatch");
  });
  await check("brand minted for the OTHER chain never crosses: list(143) on tx 10143 and list(10143) on tx 143 => chain_id_mismatch", () => {
    assert.equal(X.preparedSignProblem({ ...brand143, chainId: 10143 }), "chain_id_mismatch");
    assert.equal(X.preparedSignProblem(TX({ chainId: 143, authorizationList: b10143.list, data: b10143.data })), "chain_id_mismatch");
  });
  await check("10143 behaviour unchanged: plain eip1559 ok; branded 10143 ok; every other chain id (0, 1, 142, 10144, '143', 143n) refused even with a brand", () => {
    const P = X.preparedSignProblem;
    const plain = { chainId: 10143, type: "eip1559", nonce: 1, gas: 100_000n, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 1n, to: ESCROW, value: 0n, data: "0x" };
    assert.equal(P(plain), null);
    assert.equal(P(TX({ chainId: 10143, authorizationList: b10143.list, data: b10143.data })), null);
    assert.equal(P({ ...plain, authorizationList: [{}] }), "authorization_list_present");
    for (const chainId of [0, 1, 142, 10144, "143", 143n, 143.5, null, undefined]) {
      assert.equal(P({ ...plain, chainId }), "chain_id_mismatch", String(chainId));
      assert.equal(P({ ...brand143, chainId }), chainId === 143 ? null : "chain_id_mismatch", String(chainId));
    }
  });
  await check("the shipped (un-substituted) module: real pins can't mint a brand offline, so 143 is refused for everything it is given", () => {
    const plain = { chainId: 143, type: "eip1559", nonce: 1, gas: 100_000n, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 1n, to: ESCROW, value: 0n };
    assert.equal(realProblem(plain), "chain_id_mismatch");
    assert.equal(realProblem({ ...brand143, authorizationList: b143.list }), "chain_id_mismatch"); // brand from the COPY's WeakMap is unknown to the real module
  });
  await check("executeMoneyStep (strict path): 143 brand reaches the signer once; a non-brand 143 tx NEVER reaches it", async () => {
    const run = async (prepared) => {
      let signs = 0; let sends = 0;
      const transport = { kind: "viem_raw", walletClient: { prepareTransactionRequest: async () => prepared },
        account: { address: piggy.address, signTransaction: async () => { signs += 1; return "0x04abcd"; } }, publicClient: { sendRawTransaction: async () => { sends += 1; return keccak256("0x04abcd"); } } };
      const r = await X.executeMoneyStep({ tx: { to: GIFT_SPONSOR_PINS.delegationManager, data: "0x" }, transport, authorize: () => true, reserve: () => true, persistHash: () => true });
      return { r, signs, sends };
    };
    const ok = await run(brand143);
    assert.equal(ok.r.status, "broadcast"); assert.equal(ok.signs, 1);
    const bad = await run({ ...brand143, to: ESCROW });
    assert.equal(bad.r.reason, "unexpected_field"); assert.equal(bad.signs, 0); assert.equal(bad.sends, 0);
    const plain143 = await run({ chainId: 143, type: "eip1559", nonce: 1, gas: 100_000n, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 1n, to: ESCROW, value: 0n });
    assert.equal(plain143.r.reason, "chain_id_mismatch"); assert.equal(plain143.signs, 0); assert.equal(plain143.sends, 0);
  });
  await check("source invariant: money-executor mentions 143 only as the brand-gated constant (no other chain widening)", () => {
    const src = readFileSync(path.resolve(HERE, "../src/money-executor.js"), "utf8").replace(/\/\/.*$/gm, "");
    assert.equal((src.match(/\b143\b/g) || []).length, 1);
    assert.match(src, /!\(sponsorList && prepared\.chainId === SIGN_GUARD_SPONSOR_CHAIN_ID\)/);
  });
}
for (const f of [TMP_S, TMP_E]) { try { rmSync(f); } catch {} }
console.log(`\nA-913 sign guard 143: ${pass} PASS${fail ? ` · ${fail} FAIL` : ""}`);
process.exit(fail ? 1 : 0);
