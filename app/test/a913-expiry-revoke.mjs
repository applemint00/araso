// [A-913 C + D client side] Timestamp before = min(now + 300, gift deadline), after = 0, never in the UI; the submitter tolerates the
// relayer's revoke-after-commit (optional revokeTxHash) and a revoke failure never blocks or fakes the claim.
//   node app/test/a913-expiry-revoke.mjs      (no network, no tx; pin-substituted COPY of the sponsor module + claim entry)
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";
import { GIFT_SPONSOR_MAX_EXPIRY_SECONDS, GIFT_SPONSOR_REFUSAL as R, giftSponsorExpiryBefore, buildTimestampTerms } from "../src/gift-sponsor-7702.js";
import { hashClaimToken } from "../src/gift-piggy-claim-link.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
async function check(label, fn) { try { await fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${String(e?.stack || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; } }

const CHAIN = 10143; const ESCROW = "0x20305e402357B51880eF0b5C29758db7B970d93c"; const SPONSOR = "0xAA4cc35BABBC9F2C8c2336E1AB1fcc2B265845F8";
const OTHER = "0xDbA40Dd271190e1B090F80fB1999323952F6b761"; const GIFT = `0x${"89".repeat(32)}`; const COMMIT = `0x${"42".repeat(32)}`;
const NOW = 1_800_000_000; const FAKE = "0x6001";
const piggy = privateKeyToAccount(generatePrivateKey());
const TMP_S = path.join(HERE, "_a913_er_sponsor.mjs"); const TMP_N = path.join(HERE, "_a913_er_entry.mjs");

await check("constant: the cap is 300 (A-556 signer session), pure helper = min(now+300, deadline)", () => {
  assert.equal(GIFT_SPONSOR_MAX_EXPIRY_SECONDS, 300);
  assert.deepEqual(giftSponsorExpiryBefore({ nowSeconds: NOW, giftDeadlineSeconds: NOW + 86400 }), { ok: true, before: NOW + 300 });
  assert.deepEqual(giftSponsorExpiryBefore({ nowSeconds: NOW, giftDeadlineSeconds: NOW + 100 }), { ok: true, before: NOW + 100 });
  assert.deepEqual(giftSponsorExpiryBefore({ nowSeconds: NOW, giftDeadlineSeconds: NOW + 300 }), { ok: true, before: NOW + 300 });
  assert.deepEqual(giftSponsorExpiryBefore({ nowSeconds: NOW, giftDeadlineSeconds: NOW + 1 }), { ok: true, before: NOW + 1 });
});
await check("a cap argument can only LOWER 300; deadline missing/past/NaN/float refuses (no default)", () => {
  assert.equal(giftSponsorExpiryBefore({ nowSeconds: NOW, giftDeadlineSeconds: NOW + 9999, capSeconds: 600 }).before, NOW + 300);
  assert.equal(giftSponsorExpiryBefore({ nowSeconds: NOW, giftDeadlineSeconds: NOW + 9999, capSeconds: 60 }).before, NOW + 60);
  for (const d of [undefined, null, NOW, NOW - 1, NaN, 1.5 + NOW, "1800000500", Infinity]) assert.equal(giftSponsorExpiryBefore({ nowSeconds: NOW, giftDeadlineSeconds: d }).reason, R.GIFT_DEADLINE_INVALID, String(d));
  assert.equal(giftSponsorExpiryBefore({ nowSeconds: 0, giftDeadlineSeconds: NOW }).ok, false);
  assert.equal(giftSponsorExpiryBefore({ nowSeconds: NOW, giftDeadlineSeconds: NOW + 5, capSeconds: 0 }).ok, false);
});

let M; let E;
try {
  const srcS = readFileSync(path.resolve(HERE, "../src/gift-sponsor-7702.js"), "utf8");
  const block = srcS.slice(srcS.indexOf("codeHash: Object.freeze({"), srcS.indexOf("export const GIFT_SPONSOR_CHAINS"));
  writeFileSync(TMP_S, srcS.replace(block, block.replace(/"0x[0-9a-f]{64}"/g, `"${keccak256(FAKE)}"`)));
  writeFileSync(TMP_N, readFileSync(path.resolve(HERE, "../src/gift-claim-entry.js"), "utf8").replace(/from "\.\/gift-sponsor-7702\.js"/g, 'from "./_a913_er_sponsor.mjs"').replace(/from "\.\/(?!_a913)/g, 'from "../src/'));
  M = await import("./_a913_er_sponsor.mjs"); E = await import("./_a913_er_entry.mjs");
} catch (e) { console.log(`FAIL  copy setup ${e.message}`); fail += 1; }

const timestampOf = (request) => { const t = request.delegation.caveats[2].terms; return { after: BigInt(`0x${t.slice(2, 34)}`), before: BigInt(`0x${t.slice(34, 66)}`) }; };
const session = (over = {}) => M.createGiftSponsorSession({ config: { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 600 }, giftId: GIFT, commitHash: COMMIT,
  account: { address: piggy.address, signAuthorization: (a) => piggy.signAuthorization(a), signTypedData: (t) => piggy.signTypedData(t) }, authNonce: 0, now: () => NOW, readCode: async () => FAKE, ...over });
const sign = async (s) => { assert.equal((await s.signAuthorization()).ok, true); const d = await s.signDelegation(); if (!d.ok) return d; return s.buildRequest(); };

if (M && E) {
  await check("session: signed before = min(now+300, gift deadline), after = 0 (even when the injected window is 600)", async () => {
    const far = await sign(session({ giftDeadlineSeconds: NOW + 86400 })); assert.equal(far.ok, true, far.reason);
    assert.deepEqual(timestampOf(far.request), { after: 0n, before: BigInt(NOW + 300) });
    assert.equal(far.expiryBefore, BigInt(NOW + 300));
    const near = await sign(session({ giftDeadlineSeconds: NOW + 90 })); assert.equal(near.ok, true, near.reason);
    assert.deepEqual(timestampOf(near.request), { after: 0n, before: BigInt(NOW + 90) });
    assert.equal(near.request.delegation.caveats[2].terms, buildTimestampTerms({ beforeSeconds: NOW + 90 }));
  });
  await check("session: a deadline that is not after now refuses at the delegation signature; an invalid deadline value builds no session", async () => {
    const s = session({ giftDeadlineSeconds: NOW });
    assert.equal((await s.signAuthorization()).ok, true);
    assert.equal((await s.signDelegation()).reason, R.GIFT_DEADLINE_INVALID);
    for (const d of [0, -5, 1.5, "x", NaN, null]) assert.equal(session({ giftDeadlineSeconds: d }), null, String(d));
  });
  await check("session: a window larger than 300 is capped to 300 once a deadline is given; the signed request passes the relayer-side guard with maxExpiry 300", async () => {
    const r = await sign(session({ giftDeadlineSeconds: NOW + 5000 }));
    const v = await M.validateGiftSponsorRequest(JSON.parse(JSON.stringify(r.request)), { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 300, nowSeconds: NOW, delegator: piggy.address, authNonce: 0 });
    assert.equal(v.ok, true, v.reason);
    const late = await M.validateGiftSponsorRequest(JSON.parse(JSON.stringify(r.request)), { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 300, nowSeconds: NOW + 301, delegator: piggy.address, authNonce: 0 });
    assert.equal(late.reason, R.EXPIRY_INVALID); // expired after 5 minutes
  });
  await check("legacy session (no giftDeadlineSeconds) keeps the pre-A-913 window now+expirySeconds", async () => {
    const r = await sign(session()); assert.equal(r.ok, true);
    assert.equal(timestampOf(r.request).before, BigInt(NOW + 600));
  });

  // submitter: revoke is the relayer's job; the app only tolerates / records it.
  const TOKEN = "token-revoke"; const H = (c) => `0x${c.repeat(32)}`;
  const { binding } = E.bindGiftToNewPiggy({ intent: { giftId: GIFT, token: TOKEN }, piggy: { address: piggy.address, sequence: 1 }, preExistingAddresses: [], signerAddress: piggy.address });
  const record = { giftId: GIFT, senderAddress: OTHER, claimTokenHash: await hashClaimToken(TOKEN), expiresAt: new Date((NOW + 86400) * 1000).toISOString(), gasDeposit: { txHash: `0x${"ee".repeat(32)}` } };
  const run = async (body, { claimed = true } = {}) => {
    const client = { posts: 0, reqs: [], async submit(req) { client.posts += 1; client.reqs.push(req); client.lastCommit = M.sponsorCommitHash(req.claim); return { status: 200, body: typeof body === "function" ? body(req) : body }; } };
    const chain = { chain: { id: CHAIN }, getTransactionCount: async () => 0n, getCode: async () => FAKE, waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 5n }),
      getTransaction: async () => ({ to: ESCROW, from: SPONSOR }), readContract: async ({ functionName }) => (functionName === "commits" ? [client.lastCommit, 4n] : [OTHER, ESCROW, 1n, 0n, claimed, "0x"]) };
    const sub = E.createGiftSponsorClaimSubmitter({ config: { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 600 }, chain, sponsorClient: client, chainScope: "monad-testnet", now: () => NOW, randomBytes: () => new Uint8Array(32).fill(7) });
    const out = await sub.submit({ binding, record, token: TOKEN, account: { address: piggy.address, signAuthorization: (a) => piggy.signAuthorization(a), signTypedData: (t) => piggy.signTypedData(t) } });
    return { out, client };
  };
  const ok = (extra = {}) => (req) => ({ ok: true, state: "CLAIMED", giftId: req.giftId, installTxHash: null, commitTxHash: H("c1"), claimTxHash: H("c2"), ...extra });
  await check("submitter: the delegation it sends expires at min(now+300, gift deadline) and the gift deadline in `claim` is unchanged", async () => {
    const { out, client } = await run(ok());
    assert.equal(out.status, "value_transferred", JSON.stringify(out));
    assert.deepEqual(timestampOf(client.reqs[0]), { after: 0n, before: BigInt(NOW + 300) });
    assert.equal(client.reqs[0].claim.deadline, String(NOW + 86400));
    assert.equal(client.posts, 1);
  });
  await check("submitter: relayer revokeTxHash is recorded; null / absent / garbage revoke never blocks the claim", async () => {
    assert.equal((await run(ok({ revokeTxHash: H("d1") }))).out.txHashes.revoke, H("d1"));
    for (const extra of [{ revokeTxHash: null }, {}, { revokeTxHash: "0x12" }, { revokeTxHash: 7 }]) {
      const r = await run(ok(extra));
      assert.equal(r.out.status, "value_transferred");
      assert.equal("revoke" in r.out.txHashes, false);
    }
  });
  await check("submitter: revoke info cannot fake a claim - unclaimed chain => claim_unverified even with a revokeTxHash", async () => {
    const r = await run(ok({ revokeTxHash: H("d1") }), { claimed: false });
    assert.equal(r.out.status, "claim_unverified");
  });
  // ── revoke authorization (A-913 D): same Face ID session, 0x0 @ n+1 ──
  const ZERO = `0x${"0".repeat(40)}`;
  const acct = (counter) => ({ address: piggy.address, signAuthorization: (a) => { counter.n += 1; return piggy.signAuthorization(a); }, signTypedData: (t) => { counter.n += 1; return piggy.signTypedData(t); } });
  const fullSession = async (over = {}) => {
    const c = { n: 0 }; const s0 = session({ account: acct(c), giftDeadlineSeconds: NOW + 86400, ...over });
    assert.equal((await s0.signAuthorization()).ok, true);
    return { s0, c };
  };
  const CLAIM = { recipient: piggy.address, preimage: "0x746f6b656e", salt: `0x${"7a".repeat(32)}`, deadline: String(NOW + 86400) };
  const claimFor = () => ({ ...CLAIM, ...{} });
  const mkReq = async () => {
    const { s0, c } = await fullSession(); assert.equal((await s0.signRevokeAuthorization()).ok, true);
    assert.equal((await s0.signDelegation()).ok, true);
    const commit = M.sponsorCommitHash({ recipient: piggy.address, preimage: CLAIM.preimage, salt: CLAIM.salt });
    return { s0, c, commit };
  };
  await check("revoke auth: one session signs install auth + revoke auth (0x0 @ n+1) + delegation = 3 signatures; request has the 5th key revokeAuthorization", async () => {
    const c = { n: 0 };
    const commit = M.sponsorCommitHash({ recipient: piggy.address, preimage: CLAIM.preimage, salt: CLAIM.salt });
    const s0 = session({ account: acct(c), commitHash: commit, giftDeadlineSeconds: NOW + 86400 });
    assert.equal((await s0.signAuthorization()).ok, true);
    assert.equal((await s0.signRevokeAuthorization()).ok, true);
    assert.equal((await s0.signDelegation()).ok, true);
    const b = await s0.buildRequest({ claim: CLAIM });
    assert.equal(b.ok, true, b.reason);
    assert.deepEqual(Object.keys(b.request), ["giftId", "authorization", "delegation", "claim", "revokeAuthorization"]);
    assert.equal(c.n, 3);
    assert.equal(b.request.revokeAuthorization.address, ZERO);
    assert.equal(b.request.revokeAuthorization.nonce, b.request.authorization.nonce + 1);
    assert.equal(b.request.revokeAuthorization.chainId, CHAIN);
    const wire = JSON.parse(JSON.stringify(b.request));
    const ctx = { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 300, nowSeconds: NOW, delegator: piggy.address, authNonce: 0, requireClaim: true, requireRevoke: true };
    assert.equal((await M.validateGiftSponsorRequest(wire, ctx)).ok, true);
    // second revoke signature is refused; without #1 first it is NOT_READY
    assert.equal((await s0.signRevokeAuthorization()).reason, R.SECOND_SIGNATURE);
    const fresh = session({ account: acct({ n: 0 }) });
    assert.equal((await fresh.signRevokeAuthorization()).reason, R.NOT_READY);
  });
  await check("revoke auth guard (fail-closed): wrong chain / non-zero address / wrong nonce / foreign signer / bad shape are each refused", async () => {
    const sign = (o) => piggy.signAuthorization({ contractAddress: ZERO, chainId: CHAIN, nonce: 1, ...o });
    const ok = await sign({});
    assert.equal(M.checkRevokeAuthorization(ok, { chainId: CHAIN, authNonce: 0 }).ok, true);
    assert.equal(M.checkRevokeAuthorization(await sign({ chainId: 143 }), { chainId: CHAIN, authNonce: 0 }).reason, R.AUTH_CHAIN_ID);
    assert.equal(M.checkRevokeAuthorization(await sign({ chainId: 0 }), { chainId: CHAIN, authNonce: 0 }).reason, R.AUTH_CHAIN_ID);
    assert.equal(M.checkRevokeAuthorization(await sign({ contractAddress: OTHER }), { chainId: CHAIN, authNonce: 0 }).reason, R.REVOKE_AUTH_ADDRESS);
    assert.equal(M.checkRevokeAuthorization(await sign({ contractAddress: M.GIFT_SPONSOR_PINS.statelessDelegate }), { chainId: CHAIN, authNonce: 0 }).reason, R.REVOKE_AUTH_ADDRESS);
    for (const nonce of [0, 2, 5]) assert.equal(M.checkRevokeAuthorization(await sign({ nonce }), { chainId: CHAIN, authNonce: 0 }).reason, R.AUTH_NONCE);
    assert.equal(M.checkRevokeAuthorization(ok, { chainId: CHAIN, authNonce: undefined }).reason, R.AUTH_NONCE);
    assert.equal(M.checkRevokeAuthorization(ok, { chainId: 1, authNonce: 0 }).reason, R.CHAIN_ID_INVALID);
    assert.equal(M.checkRevokeAuthorization({ ...ok, extra: 1 }, { chainId: CHAIN, authNonce: 0 }).reason, R.AUTH_SHAPE);
    assert.equal(M.checkRevokeAuthorization(null, { chainId: CHAIN, authNonce: 0 }).reason, R.AUTH_SHAPE);
    // foreign signer: the session refuses it
    const stranger = privateKeyToAccount(generatePrivateKey());
    const s1 = session({ account: { address: piggy.address, signAuthorization: (a) => (a.contractAddress === ZERO ? stranger.signAuthorization(a) : piggy.signAuthorization(a)), signTypedData: (t) => piggy.signTypedData(t) } });
    assert.equal((await s1.signAuthorization()).ok, true);
    assert.equal((await s1.signRevokeAuthorization()).reason, R.REVOKE_AUTH_SIGNER);
  });
  await check("request guard: revokeAuthorization signed by another key / wrong nonce / extra key shape is refused; 4-key legacy request still valid", async () => {
    const commit = M.sponsorCommitHash({ recipient: piggy.address, preimage: CLAIM.preimage, salt: CLAIM.salt });
    const s0 = session({ account: acct({ n: 0 }), commitHash: commit, giftDeadlineSeconds: NOW + 86400 });
    await s0.signAuthorization(); await s0.signRevokeAuthorization(); await s0.signDelegation();
    const b = await s0.buildRequest({ claim: CLAIM });
    const ctx = { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 300, nowSeconds: NOW, delegator: piggy.address, authNonce: 0, requireClaim: true };
    const w = () => JSON.parse(JSON.stringify(b.request));
    const stranger = privateKeyToAccount(generatePrivateKey());
    const foreign = await stranger.signAuthorization({ contractAddress: ZERO, chainId: CHAIN, nonce: 1 });
    assert.equal((await M.validateGiftSponsorRequest({ ...w(), revokeAuthorization: { address: foreign.address ?? foreign.contractAddress, chainId: foreign.chainId, nonce: foreign.nonce, r: foreign.r, s: foreign.s, yParity: foreign.yParity } }, ctx)).reason, R.REVOKE_AUTH_SIGNER);
    assert.equal((await M.validateGiftSponsorRequest({ ...w(), revokeAuthorization: { ...w().revokeAuthorization, nonce: 5 } }, ctx)).reason, R.AUTH_NONCE);
    assert.equal((await M.validateGiftSponsorRequest({ ...w(), extra: 1 }, ctx)).reason, R.REQUEST_SHAPE);
    const legacy = w(); delete legacy.revokeAuthorization;
    assert.equal((await M.validateGiftSponsorRequest(legacy, ctx)).ok, true);                       // pre-A-913 4-key shape
    assert.equal((await M.validateGiftSponsorRequest(legacy, { ...ctx, requireRevoke: true })).reason, R.REQUEST_SHAPE); // ... unless the revoke is demanded
  });
  await check("submitter: if the revoke signature is refused, NOTHING is sent (fail-closed) and the relayer is never called", async () => {
    let posts = 0;
    const client = { async submit() { posts += 1; return { status: 200, body: {} }; } };
    const chain = { chain: { id: CHAIN }, getTransactionCount: async () => 0n, getCode: async () => FAKE, waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 5n }), getTransaction: async () => ({}), readContract: async () => [] };
    const sub = E.createGiftSponsorClaimSubmitter({ config: { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 600 }, chain, sponsorClient: client, chainScope: "monad-testnet", now: () => NOW, randomBytes: () => new Uint8Array(32).fill(7) });
    const bad = { address: piggy.address, signAuthorization: (a) => (a.contractAddress === ZERO ? Promise.reject(new Error("declined")) : piggy.signAuthorization(a)), signTypedData: (t) => piggy.signTypedData(t) };
    const out = await sub.submit({ binding, record, token: TOKEN, account: bad });
    assert.equal(out.status, "guard_refused"); assert.equal(out.reason, R.SIGN_FAILED); assert.equal(posts, 0);
  });
  await check("recipient claim (Cowork c): the request is the 5-key body WITHOUT gasTx; an explicit gasTx is passed through only when it is a bytes32", async () => {
    const r5 = await run(ok());
    assert.deepEqual(Object.keys(r5.client.reqs[0]), ["giftId", "authorization", "delegation", "claim", "revokeAuthorization"]);
    const mk = (extra) => { const c = { reqs: [], async submit(req) { c.reqs.push(req); return { status: 409, body: {} }; } };
      const chain = { chain: { id: CHAIN }, getTransactionCount: async () => 0n, getCode: async () => FAKE, waitForTransactionReceipt: async () => ({}), getTransaction: async () => ({}), readContract: async () => { throw new Error("x"); } };
      return { c, sub: E.createGiftSponsorClaimSubmitter({ config: { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 600 }, chain, sponsorClient: c, chainScope: "monad-testnet", now: () => NOW, randomBytes: () => new Uint8Array(32).fill(7) }) }; };
    const acct2 = () => ({ address: piggy.address, signAuthorization: (a) => piggy.signAuthorization(a), signTypedData: (t) => piggy.signTypedData(t) });
    const good = `0x${"ab".repeat(32)}`;
    const a = mk(); await a.sub.submit({ binding, record, token: TOKEN, gasTx: good, account: acct2() });
    assert.equal(a.c.reqs[0].gasTx, good);
    const b = mk(); await b.sub.submit({ binding, record, token: TOKEN, gasTx: "0x12", account: acct2() });
    assert.equal("gasTx" in b.c.reqs[0], false);
  });
  await check("a passed gift deadline is refused BEFORE Face ID on the existing guard_refused path (0 signatures, relayer never called)", async () => {
    for (const expiresAt of [new Date((NOW - 1) * 1000).toISOString(), new Date(NOW * 1000).toISOString()]) {
      let signs = 0; let posts = 0;
      const client = { async submit() { posts += 1; return { status: 200, body: {} }; } };
      const chain = { chain: { id: CHAIN }, getTransactionCount: async () => 0n, getCode: async () => FAKE, waitForTransactionReceipt: async () => ({}), getTransaction: async () => ({}), readContract: async () => [] };
      const sub = E.createGiftSponsorClaimSubmitter({ config: { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: 600 }, chain, sponsorClient: client, chainScope: "monad-testnet", now: () => NOW, randomBytes: () => new Uint8Array(32).fill(7) });
      const acct2 = { address: piggy.address, signAuthorization: (a) => { signs += 1; return piggy.signAuthorization(a); }, signTypedData: (t) => { signs += 1; return piggy.signTypedData(t); } };
      const out = await sub.submit({ binding, record: { ...record, expiresAt }, token: TOKEN, account: acct2 });
      assert.equal(out.status, "guard_refused"); assert.equal(out.reason, R.GIFT_DEADLINE_INVALID); assert.equal(signs, 0); assert.equal(posts, 0);
    }
  });
  await check("not shown in UI: neither main.js nor the Gift paper renders the expiry/300/revoke", () => {
    for (const f of ["../src/gift-send-paper.js", "../src/main.js"]) {
      const src = readFileSync(path.resolve(HERE, f), "utf8");
      assert.ok(!src.includes("GIFT_SPONSOR_MAX_EXPIRY_SECONDS") && !src.includes("giftSponsorExpiryBefore"), f);
    }
  });
}
for (const f of [TMP_S, TMP_N]) { try { rmSync(f); } catch {} }
console.log(`\nA-913 expiry/revoke (client): ${pass} PASS${fail ? ` · ${fail} FAIL` : ""}`);
process.exit(fail ? 1 : 0);
