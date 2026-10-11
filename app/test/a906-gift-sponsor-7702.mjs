// [A-906] Gift claim via 7702 sponsor-submit: app guards, signing session, executor exception, claim path switch.
//   node app/test/a906-gift-sponsor-7702.mjs
// No network, no tx, no browser: local viem accounts + fake code reader. Every guard is exercised negatively.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";

import {
  GIFT_SPONSOR_PINS, GIFT_SPONSOR_REFUSAL as R, buildCommitClaimCalldata, buildExactExecutionTerms, buildLimitedCallsTerms, buildTimestampTerms,
  checkAuthorization, checkDelegation, checkPinnedCode, createGiftSponsorSession, delegationTypedData, isGiftSponsorAuthorizationList,
  isGiftSponsorRequest, normalizeGiftSponsorConfig, checkClaim, sponsorCommitHash, toExecutorAuthorizationList, validateGiftSponsorRequest,
} from "../src/gift-sponsor-7702.js";
import { preparedSignProblem } from "../src/money-executor.js";
import { createGiftSponsorClaimSubmitter, selectGiftClaimPath } from "../src/gift-claim-entry.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String(e && e.stack ? e.stack : e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; }
}

const CHAIN = 10143;
const ESCROW = "0x20305e402357B51880eF0b5C29758db7B970d93c";
const SPONSOR = "0xAA4cc35BABBC9F2C8c2336E1AB1fcc2B265845F8";
const OTHER = "0xDbA40Dd271190e1B090F80fB1999323952F6b761";
const GIFT = `0x${"89".repeat(32)}`;
const COMMIT = `0x${"42".repeat(32)}`;
const NOW = 1_800_000_000;
const EXPIRY = 600; // TEST FIXTURE ONLY. The real value is an Owner number (UNKNOWN); the module has no default.
const CFG = { chainId: CHAIN, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: EXPIRY };

// Fake code reader that returns bytecode whose keccak equals the pinned hash is impossible; build a reader over a patched pin table instead.
// So: the real table is checked with a reader that returns wrong code (negative) and a table-aware stub for the positive case.
const okPins = GIFT_SPONSOR_PINS.codeHash[CHAIN];
const codeByAddr = new Map(); // address(lc) -> code with desired keccak is not constructible; use a monkey-free approach below.
const piggy = privateKeyToAccount(generatePrivateKey());

// ── Positive path needs checkPinnedCode to pass. We cannot forge a preimage for the pinned hashes, so the session is
//    exercised with a readCode whose result the test makes valid by temporarily replacing the frozen table via a
//    test-only module copy? No: we do not weaken the module. Instead the session positive path is tested through
//    `codeVerified` indirection below (skipped when pins cannot be satisfied), and the guards are tested directly.
async function realSession(overrides = {}) {
  // readCode returns the *pinned-hash-matching* code is impossible, so session tests use the real pins against a fork-less stub:
  // we return null to prove refusal, and the positive e2e lives in a906-fork-sponsor.mjs (real on-chain code).
  return createGiftSponsorSession({ config: CFG, giftId: GIFT, commitHash: COMMIT, account: piggy, authNonce: 0, now: () => NOW, readCode: async () => "0x6001", ...overrides });
}

const goodTerms = () => buildExactExecutionTerms({ escrowAddress: ESCROW, giftId: GIFT, commitHash: COMMIT });
const goodCaveats = () => [
  { enforcer: GIFT_SPONSOR_PINS.exactExecutionEnforcer, terms: goodTerms(), args: "0x" },
  { enforcer: GIFT_SPONSOR_PINS.limitedCallsEnforcer, terms: buildLimitedCallsTerms(), args: "0x" },
  { enforcer: GIFT_SPONSOR_PINS.timestampEnforcer, terms: buildTimestampTerms({ beforeSeconds: NOW + EXPIRY }), args: "0x" },
];
async function signedDelegation(patch = {}) {
  const d = { delegate: SPONSOR, delegator: piggy.address, authority: GIFT_SPONSOR_PINS.root, caveats: goodCaveats(), salt: 12345n, signature: "0x", ...patch };
  d.signature = await piggy.signTypedData(delegationTypedData({ chainId: CHAIN, delegation: { ...d, salt: BigInt(d.salt) } }));
  return d;
}
const CTX = { chainId: CHAIN, giftId: GIFT, escrowAddress: ESCROW, sponsorAddress: SPONSOR, expirySeconds: EXPIRY, nowSeconds: NOW, delegator: piggy.address, commitHash: COMMIT };
async function signedAuth(patch = {}) {
  return piggy.signAuthorization({ contractAddress: GIFT_SPONSOR_PINS.statelessDelegate, chainId: CHAIN, nonce: 0, ...patch });
}
const REQ_CTX = { ...CTX, authNonce: 0 };
async function goodRequest() {
  const d = await signedDelegation();
  return { giftId: GIFT, authorization: await signedAuth(), delegation: { ...d, salt: d.salt.toString(10) } };
}

// ── config ──
await check("config: complete config accepted; expirySeconds missing/0/negative/float -> refused (UNKNOWN is never defaulted)", () => {
  assert.equal(normalizeGiftSponsorConfig(CFG).ok, true);
  for (const bad of [undefined, null, 0, -1, 1.5, "600", Infinity]) {
    const { expirySeconds: _e, ...rest } = CFG;
    const r = normalizeGiftSponsorConfig(bad === undefined ? rest : { ...CFG, expirySeconds: bad });
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.reason, R.EXPIRY_UNKNOWN);
  }
});
await check("config: chainId 0 / 1 / 10144 / string / null and zero or malformed addresses and extra keys -> refused", () => {
  for (const chainId of [0, 1, 10144, "10143", null, undefined]) assert.equal(normalizeGiftSponsorConfig({ ...CFG, chainId }).ok, false);
  for (const patch of [{ escrowAddress: "0x" + "0".repeat(40) }, { sponsorAddress: "0x12" }, { escrowAddress: undefined }, { extra: 1 }]) assert.equal(normalizeGiftSponsorConfig({ ...CFG, ...patch }).ok, false);
  assert.equal(normalizeGiftSponsorConfig(null).ok, false);
  assert.equal(normalizeGiftSponsorConfig({ ...CFG, chainId: 143 }).ok, true);
});

// ── authorization ──
await check("authorization: exact chain + pinned delegate accepted", async () => {
  const a = await signedAuth();
  const r = checkAuthorization(a, { chainId: CHAIN, authNonce: 0 });
  assert.equal(r.ok, true, r.reason);
});
await check("authorization: chainId 0 (any-chain replay) refused", async () => {
  assert.equal(checkAuthorization(await signedAuth({ chainId: 0 }), { chainId: CHAIN }).reason, R.AUTH_CHAIN_ID);
});
await check("authorization: other chain (1, 143 while gift is 10143, 143 vs 10143 swapped) refused", async () => {
  for (const c of [1, 143, 10144]) assert.equal(checkAuthorization(await signedAuth({ chainId: c }), { chainId: CHAIN }).reason, R.AUTH_CHAIN_ID);
  assert.equal(checkAuthorization(await signedAuth({ chainId: CHAIN }), { chainId: 143 }).reason, R.AUTH_CHAIN_ID);
  assert.equal(checkAuthorization(await signedAuth(), { chainId: 0 }).reason, R.CHAIN_ID_INVALID);
});
await check("authorization: any other delegate (zero address = revoke, attacker, sponsor, DM) refused", async () => {
  for (const d of ["0x" + "0".repeat(40), OTHER, SPONSOR, GIFT_SPONSOR_PINS.delegationManager, GIFT_SPONSOR_PINS.exactExecutionEnforcer]) {
    assert.equal(checkAuthorization(await signedAuth({ contractAddress: d }), { chainId: CHAIN }).reason, R.AUTH_DELEGATE);
  }
});
await check("authorization: wrong nonce / malformed r s yParity / extra field / missing field refused", async () => {
  const a = await signedAuth();
  assert.equal(checkAuthorization(a, { chainId: CHAIN, authNonce: 1 }).reason, R.AUTH_NONCE);
  assert.equal(checkAuthorization({ ...a, nonce: -1 }, { chainId: CHAIN }).reason, R.AUTH_NONCE);
  assert.equal(checkAuthorization({ ...a, nonce: 1.5 }, { chainId: CHAIN }).reason, R.AUTH_NONCE);
  assert.equal(checkAuthorization({ ...a, r: "0x12" }, { chainId: CHAIN }).reason, R.AUTH_SHAPE);
  assert.equal(checkAuthorization({ ...a, yParity: 2 }, { chainId: CHAIN }).reason, R.AUTH_SHAPE);
  assert.equal(checkAuthorization({ ...a, extra: 1 }, { chainId: CHAIN }).reason, R.AUTH_SHAPE);
  const { r: _r, ...noR } = a;
  assert.equal(checkAuthorization(noR, { chainId: CHAIN }).reason, R.AUTH_SHAPE);
  assert.equal(checkAuthorization(null, { chainId: CHAIN }).reason, R.AUTH_SHAPE);
  assert.equal(checkAuthorization({ ...a, address: GIFT_SPONSOR_PINS.statelessDelegate, contractAddress: OTHER }, { chainId: CHAIN }).reason, R.AUTH_SHAPE);
});

// ── delegation ──
await check("delegation: exact scope (sponsor, ROOT, ExactExecution commitClaim, LimitedCalls 1, Timestamp) accepted; commitHash read back", async () => {
  const d = await signedDelegation();
  const r = checkDelegation(d, CTX);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.commitHash, COMMIT);
  const { commitHash: _c, ...serverCtx } = CTX; // relayer cannot know the commitHash: it is taken from the terms
  assert.equal(checkDelegation(d, serverCtx).commitHash, COMMIT);
});
await check("delegation: delegate not the sponsor (other address, ANY_DELEGATE 0x..a11, zero) refused", async () => {
  for (const delegate of [OTHER, "0x0000000000000000000000000000000000000a11", "0x" + "0".repeat(40)]) assert.equal(checkDelegation(await signedDelegation({ delegate }), CTX).reason, R.DELEGATE_NOT_SPONSOR);
});
await check("delegation: authority not ROOT (chained delegation) refused", async () => {
  assert.equal(checkDelegation(await signedDelegation({ authority: `0x${"11".repeat(32)}` }), CTX).reason, R.AUTHORITY_NOT_ROOT);
});
await check("delegation: wrong delegator refused when the bound Piggy is given", async () => {
  assert.equal(checkDelegation(await signedDelegation({ delegator: OTHER }), CTX).reason, R.DELEGATOR_MISMATCH);
});
await check("delegation: other contract (target != Gift escrow) refused", async () => {
  const terms = buildExactExecutionTerms({ escrowAddress: OTHER, giftId: GIFT, commitHash: COMMIT });
  const cv = goodCaveats(); cv[0] = { ...cv[0], terms };
  assert.equal(checkDelegation(await signedDelegation({ caveats: cv }), CTX).reason, R.EXEC_TARGET);
});
await check("delegation: native value != 0 refused", async () => {
  const bytes = goodTerms();
  const withValue = bytes.slice(0, 2 + 40) + (1n).toString(16).padStart(64, "0") + bytes.slice(2 + 40 + 64);
  const cv = goodCaveats(); cv[0] = { ...cv[0], terms: withValue };
  assert.equal(checkDelegation(await signedDelegation({ caveats: cv }), CTX).reason, R.EXEC_VALUE);
});
await check("delegation: other method (claim selector / approve / transfer / empty calldata) refused", async () => {
  const base = goodTerms();
  const head = base.slice(0, 2 + 40 + 64);
  for (const sel of ["251f312d", "095ea7b3", "a9059cbb", "00000000"]) {
    const cv = goodCaveats(); cv[0] = { ...cv[0], terms: head + sel + base.slice(head.length + 8) };
    assert.equal(checkDelegation(await signedDelegation({ caveats: cv }), CTX).reason, R.EXEC_METHOD, sel);
  }
  const cv = goodCaveats(); cv[0] = { ...cv[0], terms: head };
  assert.equal(checkDelegation(await signedDelegation({ caveats: cv }), CTX).reason, R.EXEC_CALLDATA);
});
await check("delegation: calldata for another giftId / another commitHash / trailing bytes refused", async () => {
  const mk = (terms) => { const cv = goodCaveats(); cv[0] = { ...cv[0], terms }; return cv; };
  assert.equal(checkDelegation(await signedDelegation({ caveats: mk(buildExactExecutionTerms({ escrowAddress: ESCROW, giftId: `0x${"01".repeat(32)}`, commitHash: COMMIT })) }), CTX).reason, R.EXEC_CALLDATA);
  assert.equal(checkDelegation(await signedDelegation({ caveats: mk(buildExactExecutionTerms({ escrowAddress: ESCROW, giftId: GIFT, commitHash: `0x${"43".repeat(32)}` })) }), CTX).reason, R.EXEC_CALLDATA);
  assert.equal(checkDelegation(await signedDelegation({ caveats: mk(goodTerms() + "00") }), CTX).reason, R.EXEC_CALLDATA);
});
await check("delegation: LimitedCalls 2 / 0 / huge / not 32 bytes refused", async () => {
  for (const terms of [`0x${"0".repeat(63)}2`, `0x${"0".repeat(64)}`, `0x${"f".repeat(64)}`, `0x${"0".repeat(60)}01`, "0x"]) {
    const cv = goodCaveats(); cv[1] = { ...cv[1], terms };
    assert.equal(checkDelegation(await signedDelegation({ caveats: cv }), CTX).reason, R.LIMIT_NOT_ONE, terms);
  }
});
await check("delegation: expiry caveat missing / expired / now / beyond injected window / nonzero after / wrong size refused", async () => {
  const two = goodCaveats().slice(0, 2);
  assert.equal(checkDelegation(await signedDelegation({ caveats: two }), CTX).reason, R.CAVEATS_SHAPE);
  for (const before of [NOW - 1, NOW, NOW + EXPIRY + 1, NOW + 10 * EXPIRY]) {
    const cv = goodCaveats(); cv[2] = { ...cv[2], terms: buildTimestampTerms({ beforeSeconds: before }) };
    assert.equal(checkDelegation(await signedDelegation({ caveats: cv }), CTX).reason, R.EXPIRY_INVALID, String(before));
  }
  const cvAfter = goodCaveats(); cvAfter[2] = { ...cvAfter[2], terms: `0x${"0".repeat(31)}1${"0".repeat(31)}${(NOW + 5).toString(16).padStart(1, "0")}`.slice(0, 66) };
  assert.equal(checkDelegation(await signedDelegation({ caveats: cvAfter }), CTX).ok, false);
  const cvSize = goodCaveats(); cvSize[2] = { ...cvSize[2], terms: "0x" + "00".repeat(33) };
  assert.equal(checkDelegation(await signedDelegation({ caveats: cvSize }), CTX).reason, R.EXPIRY_INVALID);
  // missing injected window => refused before anything is read
  assert.equal(checkDelegation(await signedDelegation(), { ...CTX, expirySeconds: undefined }).reason, R.EXPIRY_UNKNOWN);
  // the boundary itself is accepted
  const edge = goodCaveats(); edge[2] = { ...edge[2], terms: buildTimestampTerms({ beforeSeconds: NOW + EXPIRY }) };
  assert.equal(checkDelegation(await signedDelegation({ caveats: edge }), CTX).ok, true);
});
await check("delegation: extra caveat / reordered / unpinned enforcer / non-empty args refused", async () => {
  const cv = goodCaveats();
  assert.equal(checkDelegation(await signedDelegation({ caveats: [...cv, { enforcer: OTHER, terms: "0x", args: "0x" }] }), CTX).reason, R.CAVEATS_SHAPE);
  assert.equal(checkDelegation(await signedDelegation({ caveats: [cv[1], cv[0], cv[2]] }), CTX).reason, R.ENFORCER_NOT_PINNED);
  assert.equal(checkDelegation(await signedDelegation({ caveats: [{ ...cv[0], enforcer: OTHER }, cv[1], cv[2]] }), CTX).reason, R.ENFORCER_NOT_PINNED);
  assert.equal(checkDelegation(await signedDelegation({ caveats: [{ ...cv[0], args: "0x01" }, cv[1], cv[2]] }), CTX).reason, R.CAVEATS_SHAPE);
});
await check("delegation: unknown extra field / bad signature shape / bad salt refused", async () => {
  const d = await signedDelegation();
  assert.equal(checkDelegation({ ...d, extra: 1 }, CTX).reason, R.DELEGATION_SHAPE);
  assert.equal(checkDelegation({ ...d, signature: "0x12" }, CTX).reason, R.SIGNATURE_INVALID);
  assert.equal(checkDelegation({ ...d, salt: "-1" }, CTX).reason, R.DELEGATION_SHAPE);
  assert.equal(checkDelegation({ ...d, salt: 2n ** 256n }, CTX).reason, R.DELEGATION_SHAPE);
});

// ── whole request ──
await check("request: accepted when authority(auth) == delegator == signer; recovered authority is the Piggy", async () => {
  const r = await validateGiftSponsorRequest(await goodRequest(), REQ_CTX);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.authority, piggy.address);
});
await check("request: shape (extra/missing key), bad giftId refused", async () => {
  const req = await goodRequest();
  assert.equal((await validateGiftSponsorRequest({ ...req, extra: 1 }, REQ_CTX)).reason, R.REQUEST_SHAPE);
  const { delegation: _d, ...noDel } = req;
  assert.equal((await validateGiftSponsorRequest(noDel, REQ_CTX)).reason, R.REQUEST_SHAPE);
  assert.equal((await validateGiftSponsorRequest({ ...req, giftId: "0x12" }, REQ_CTX)).reason, R.GIFT_ID);
  assert.equal((await validateGiftSponsorRequest({ ...req, giftId: `0x${"01".repeat(32)}` }, REQ_CTX)).reason, R.EXEC_CALLDATA); // delegation was for another gift
});
await check("request: authorization signed by someone else than the delegator refused", async () => {
  const req = await goodRequest();
  const stranger = privateKeyToAccount(generatePrivateKey());
  const auth = await stranger.signAuthorization({ contractAddress: GIFT_SPONSOR_PINS.statelessDelegate, chainId: CHAIN, nonce: 0 });
  assert.equal((await validateGiftSponsorRequest({ ...req, authorization: auth }, REQ_CTX)).reason, R.AUTH_SIGNER);
});
await check("request: delegation signed by a different key (tampered after signing) refused", async () => {
  const req = await goodRequest();
  const stranger = privateKeyToAccount(generatePrivateKey());
  const d = { ...req.delegation };
  d.signature = await stranger.signTypedData(delegationTypedData({ chainId: CHAIN, delegation: { ...d, salt: BigInt(d.salt) } }));
  assert.equal((await validateGiftSponsorRequest({ ...req, delegation: d }, REQ_CTX)).reason, R.SIGNATURE_INVALID);
  // salt changed after signing -> different hash -> recovers to someone else
  assert.equal((await validateGiftSponsorRequest({ ...req, delegation: { ...req.delegation, salt: "999" } }, REQ_CTX)).reason, R.SIGNATURE_INVALID);
});
await check("request: signature made for another chainId domain (143 vs 10143) refused", async () => {
  const d = await signedDelegation();
  const wrongDomainSig = await piggy.signTypedData(delegationTypedData({ chainId: 143, delegation: { ...d, salt: BigInt(d.salt) } }));
  const req = { giftId: GIFT, authorization: await signedAuth(), delegation: { ...d, salt: d.salt.toString(10), signature: wrongDomainSig } };
  assert.equal((await validateGiftSponsorRequest(req, REQ_CTX)).reason, R.SIGNATURE_INVALID);
});
await check("request: replay (same request, later clock past the expiry) refused", async () => {
  const req = await goodRequest();
  assert.equal((await validateGiftSponsorRequest(req, { ...REQ_CTX, nowSeconds: NOW + EXPIRY + 1 })).reason, R.EXPIRY_INVALID);
});

// ── claim reveal (4th wire key) ──
const SALT32 = `0x${"7a".repeat(32)}`;
const PRE = "0x746f6b656e";
const goodClaim = (over = {}) => ({ recipient: piggy.address, preimage: PRE, salt: SALT32, deadline: "1800003600", ...over });
const COMMIT_REAL = sponsorCommitHash({ recipient: piggy.address, preimage: PRE, salt: SALT32 });
await check("claim: matching reveal accepted; recipient != delegator / wrong salt / wrong preimage / bad deadline / extra key / missing key refused", () => {
  const ctx = { delegator: piggy.address, commitHash: COMMIT_REAL };
  assert.equal(checkClaim(goodClaim(), ctx).ok, true);
  assert.equal(checkClaim(goodClaim({ recipient: OTHER }), ctx).reason, R.DELEGATOR_MISMATCH);
  assert.equal(checkClaim(goodClaim({ salt: `0x${"7b".repeat(32)}` }), ctx).reason, R.EXEC_CALLDATA);
  assert.equal(checkClaim(goodClaim({ preimage: "0x746f6b656f" }), ctx).reason, R.EXEC_CALLDATA);
  assert.equal(checkClaim(goodClaim({ deadline: "-1" }), ctx).reason, R.REQUEST_SHAPE);
  assert.equal(checkClaim(goodClaim({ deadline: 5 }), ctx).reason, R.REQUEST_SHAPE);
  assert.equal(checkClaim({ ...goodClaim(), extra: 1 }, ctx).reason, R.REQUEST_SHAPE);
  const { salt: _s, ...noSalt } = goodClaim();
  assert.equal(checkClaim(noSalt, ctx).reason, R.REQUEST_SHAPE);
});
await check("request: 4-key wire shape with claim validates; requireClaim without claim refused; claim bound to the delegation's commitHash", async () => {
  const mkCaveats = (ch) => { const cv = goodCaveats(); cv[0] = { ...cv[0], terms: buildExactExecutionTerms({ escrowAddress: ESCROW, giftId: GIFT, commitHash: ch }) }; return cv; };
  const d = await signedDelegation({ caveats: mkCaveats(COMMIT_REAL) });
  const base = { giftId: GIFT, authorization: await signedAuth(), delegation: { ...d, salt: d.salt.toString(10) } };
  const ctx = { ...REQ_CTX, commitHash: undefined };
  assert.equal((await validateGiftSponsorRequest({ ...base, claim: goodClaim() }, ctx)).ok, true);
  assert.equal((await validateGiftSponsorRequest(base, { ...ctx, requireClaim: true })).reason, R.REQUEST_SHAPE);
  assert.equal((await validateGiftSponsorRequest({ ...base, claim: goodClaim({ salt: `0x${"7b".repeat(32)}` }) }, ctx)).reason, R.EXEC_CALLDATA);
  assert.equal((await validateGiftSponsorRequest({ ...base, claim: goodClaim({ recipient: OTHER }) }, ctx)).reason, R.DELEGATOR_MISMATCH);
});

// ── pinned code ──
await check("pinned code: wrong bytecode, empty code, reader throw, missing reader, unknown chain refused", async () => {
  assert.equal((await checkPinnedCode({ chainId: CHAIN, readCode: async () => "0x6001" })).reason, R.CODE_HASH_MISMATCH);
  assert.equal((await checkPinnedCode({ chainId: CHAIN, readCode: async () => "0x" })).reason, R.CODE_UNVERIFIED);
  assert.equal((await checkPinnedCode({ chainId: CHAIN, readCode: async () => { throw new Error("rpc"); } })).reason, R.CODE_UNVERIFIED);
  assert.equal((await checkPinnedCode({ chainId: CHAIN })).reason, R.CODE_UNVERIFIED);
  assert.equal((await checkPinnedCode({ chainId: 0, readCode: async () => "0x6001" })).reason, R.CHAIN_ID_INVALID);
  assert.equal(keccak256("0x6001") === okPins.statelessDelegate, false);
});
await check("pinned code: table pins the official delegate address and per-chain hashes (A-814 PREFLIGHT / Part F)", () => {
  assert.equal(GIFT_SPONSOR_PINS.statelessDelegate, "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B");
  assert.equal(GIFT_SPONSOR_PINS.delegationManager, "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3");
  assert.equal(GIFT_SPONSOR_PINS.codeHash[10143].statelessDelegate, "0x399646560cadf8e8f30b232c75d0be4e629939b4eba8019589c6d0d4b69ff9f9");
  assert.equal(GIFT_SPONSOR_PINS.codeHash[143].statelessDelegate, "0xd4dee59ae6be4a997964e8f19ae6905f0a233c6ae88d9bc5d945bc60738376c1");
  assert.equal(GIFT_SPONSOR_PINS.codeHash[143].timestampEnforcer, "0x1da353833766081398664c131a50988f6f7190d6a1a974f497607b974705900c"); // fork-read
  assert.equal(GIFT_SPONSOR_PINS.codeHash[10143].timestampEnforcer, undefined); // UNKNOWN on testnet: not invented
  assert.ok(Object.isFrozen(GIFT_SPONSOR_PINS) && Object.isFrozen(GIFT_SPONSOR_PINS.codeHash[10143]));
});

// ── session ──
await check("session: missing/invalid inputs -> null (no half-built session)", async () => {
  assert.equal(await realSession({ config: { ...CFG, expirySeconds: undefined } }), null);
  assert.equal(await realSession({ config: null }), null);
  assert.equal(await realSession({ giftId: "0x12" }), null);
  assert.equal(await realSession({ commitHash: "0x12" }), null);
  assert.equal(await realSession({ account: { address: piggy.address } }), null);
  assert.equal(await realSession({ authNonce: -1 }), null);
  assert.equal(await realSession({ readCode: undefined }), null);
  assert.equal(await realSession({ now: undefined }), null);
});
await check("session: nothing is signed when the delegate's code is not the pinned code (wrong hash / reader down)", async () => {
  let signed = 0;
  const spy = { address: piggy.address, signAuthorization: async () => { signed += 1; return signedAuth(); }, signTypedData: async () => { signed += 1; return "0x"; } };
  for (const readCode of [async () => "0x6001", async () => { throw new Error("x"); }]) {
    const s = await realSession({ account: spy, readCode });
    assert.equal((await s.signAuthorization()).ok, false);
    assert.equal((await s.signDelegation()).reason, R.SECOND_SIGNATURE === "" ? "" : R.NOT_READY);
  }
  assert.equal(signed, 0);
});
await check("session: a second authorization or second delegation request in the same session is refused (even concurrently)", async () => {
  let signed = 0;
  const spy = { address: piggy.address, signAuthorization: async (a) => { signed += 1; return piggy.signAuthorization(a); }, signTypedData: async (t) => { signed += 1; return piggy.signTypedData(t); } };
  const s = await realSession({ account: spy, readCode: async () => "0x6001" });
  const [a1, a2] = await Promise.all([s.signAuthorization(), s.signAuthorization()]);
  assert.equal([a1, a2].filter((r) => r.reason === R.SECOND_SIGNATURE).length, 1);
  assert.equal((await s.signAuthorization()).reason, R.SECOND_SIGNATURE);
  assert.equal((await s.signDelegation()).reason, R.NOT_READY); // code never verified -> no delegation signature either
  assert.equal((await s.signDelegation()).reason, R.SECOND_SIGNATURE);
  assert.equal(signed, 0);
});
await check("session: an account that signs a foreign delegate/chain is refused after the fact (no request is built)", async () => {
  // Patch the pins check by exercising the post-sign guard directly: a signer returning chainId 0 / attacker delegate is refused by checkAuthorization.
  const bad = { address: piggy.address, signAuthorization: async () => signedAuth({ chainId: 0 }), signTypedData: async () => "0x" };
  const s = await realSession({ account: bad });
  assert.equal((await s.buildRequest()).reason, R.NOT_READY);
});
await check("session: delegation API has no target/method/value/calldata parameter (scope is fixed inside)", () => {
  const src = readFileSync(path.resolve(HERE, "../src/gift-sponsor-7702.js"), "utf8");
  assert.match(src, /async signDelegation\(\) \{/);
  assert.match(src, /async signAuthorization\(\) \{/);
  assert.doesNotMatch(src, /signDelegation\(\s*\{/);
});

// ── brand + executor exception ──
async function brandedList() {
  const req = await goodRequest();
  const v = await validateGiftSponsorRequest(req, REQ_CTX);
  assert.ok(v.ok);
  // Only the session may brand a request; replicate through a session whose pins check is the real one is impossible offline,
  // so the brand is checked negatively here and positively in the fork test (real code). Verify unbranded objects never pass:
  return { req, v };
}
const PREP = Object.freeze({ chainId: 10143, type: "eip1559", nonce: 1, gas: 300_000n, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, to: GIFT_SPONSOR_PINS.delegationManager, value: 0n });
await check("executor: baseline refusals unchanged (authorizationList present / empty / eip7702 type / unknown field)", () => {
  assert.equal(preparedSignProblem(PREP), null);
  assert.equal(preparedSignProblem({ ...PREP, authorizationList: [] }), "authorization_list_present");
  assert.equal(preparedSignProblem({ ...PREP, authorizationList: [{ address: GIFT_SPONSOR_PINS.statelessDelegate }] }), "authorization_list_present");
  assert.equal(preparedSignProblem({ ...PREP, type: "eip7702" }), "tx_type_unexpected");
  assert.equal(preparedSignProblem({ ...PREP, type: "eip7702", authorizationList: [] }), "tx_type_unexpected");
  assert.equal(preparedSignProblem({ ...PREP, gasPrice: 1n }), "unexpected_field");
  assert.equal(preparedSignProblem({ ...PREP, chainId: 143 }), "chain_id_mismatch");
});
await check("executor: a hand-built / forged / cloned authorizationList is NOT the brand (even with the pinned delegate on type-4)", async () => {
  const { req } = await brandedList();
  const forged = Object.freeze([{ ...req.authorization }]);
  assert.equal(isGiftSponsorAuthorizationList(forged), false);
  assert.equal(preparedSignProblem({ ...PREP, type: "eip7702", authorizationList: forged }), "tx_type_unexpected");
  assert.equal(preparedSignProblem({ ...PREP, authorizationList: forged }), "authorization_list_present");
  assert.equal(isGiftSponsorAuthorizationList([]), false);
  assert.equal(isGiftSponsorAuthorizationList(null), false);
  assert.equal(toExecutorAuthorizationList(req), null); // an unbranded request cannot mint a list
  assert.equal(isGiftSponsorRequest(req), false);
});
await check("executor: source keeps exactly one exception site and the SEND_PIGGY/other refusals text", () => {
  const src = readFileSync(path.resolve(HERE, "../src/money-executor.js"), "utf8");
  assert.equal((src.match(/isGiftSponsorAuthorizationList\(/g) || []).length, 1);
  assert.match(src, /"authorization_list_present"/);
  assert.equal((src.match(/\[A-906\]/g) || []).length >= 2, true);
});

// ── claim path switch + submitter factory (default OFF) ──
await check("path switch: no sponsor config -> current /gift-gas path; foreign object as sponsor submitter -> none; invalid config -> null submitter", () => {
  const legacy = { submit() {} };
  assert.deepEqual(selectGiftClaimPath({ legacySubmitter: legacy }), { path: "gift_gas", submitter: legacy });
  assert.deepEqual(selectGiftClaimPath(), { path: "gift_gas", submitter: null });
  assert.deepEqual(selectGiftClaimPath({ sponsorSubmitter: { submit() {} }, legacySubmitter: legacy }), { path: "none", submitter: null });
  assert.equal(createGiftSponsorClaimSubmitter(), null);
  assert.equal(createGiftSponsorClaimSubmitter({ config: null }), null);
  const chain = { chain: { id: CHAIN }, getTransactionCount() {}, readContract() {}, getTransaction() {}, waitForTransactionReceipt() {}, getCode() {} };
  const client = { submit() {} };
  assert.equal(createGiftSponsorClaimSubmitter({ config: { ...CFG, expirySeconds: undefined }, chain, sponsorClient: client, chainScope: "monad-testnet" }), null);
  assert.equal(createGiftSponsorClaimSubmitter({ config: CFG, chain, sponsorClient: {}, chainScope: "monad-testnet" }), null);
  assert.equal(createGiftSponsorClaimSubmitter({ config: CFG, chain, sponsorClient: client, chainScope: "monad-testnet", claimSigner: 1 }), null);
  const ok = createGiftSponsorClaimSubmitter({ config: CFG, chain, sponsorClient: client, chainScope: "monad-testnet" });
  assert.ok(ok);
  assert.equal(selectGiftClaimPath({ sponsorSubmitter: ok, legacySubmitter: legacy }).path, "sponsor_7702");
});
await check("default OFF: main.js passes no sponsor config; the old /gift-gas code is still present", () => {
  // [A-966 re-pin] the one [A-966] block builds a sponsor submitter on the shared-fork profile only (its own tests: a966-*). pre-A-966: the whole main.js
  const main = readFileSync(path.resolve(HERE, "../src/main.js"), "utf8").replace(/^\/\/ ── \[A-966\] Gift on the shared fork[\s\S]*?^\/\/ ── \[A-966\] end Gift on the shared fork ──\n/m, "");
  assert.doesNotMatch(main, /gift-sponsor-7702|createGiftSponsorClaimSubmitter|GIFT_SPONSOR/);
  const entry = readFileSync(path.resolve(HERE, "../src/gift-claim-entry.js"), "utf8");
  assert.match(entry, /export function createGiftClaimSubmitter/);
  assert.match(entry, /export function createGiftGasClientDelivery/);
});

// ── positive paths through a PIN-SUBSTITUTED COPY of the module ──
// The real pinned code hashes cannot be satisfied offline (no preimage). To run the accepted paths and the executor exception
// WITHOUT weakening the shipped module, the test makes a throwaway copy where ONLY the four per-chain code-hash constants are
// replaced by keccak("0x6001"); logic is byte-identical. The real-code positive path is a906-fork-sponsor.mjs.
const FAKE_CODE = "0x6001";
const TMP_S = path.join(HERE, "_a906_tmp_sponsor.mjs");
const TMP_E = path.join(HERE, "_a906_tmp_executor.mjs");
const TMP_N = path.join(HERE, "_a906_tmp_entry.mjs");
let M = null; let X = null;
try {
  const srcS = readFileSync(path.resolve(HERE, "../src/gift-sponsor-7702.js"), "utf8");
  const block = srcS.slice(srcS.indexOf("codeHash: Object.freeze({"), srcS.indexOf("export const GIFT_SPONSOR_CHAINS"));
  const patched = srcS.replace(block, block.replace(/"0x[0-9a-f]{64}"/g, `"${keccak256(FAKE_CODE)}"`));
  assert.notEqual(patched, srcS);
  writeFileSync(TMP_S, patched);
  const srcE = readFileSync(path.resolve(HERE, "../src/money-executor.js"), "utf8").replace('"./gift-sponsor-7702.js"', '"./_a906_tmp_sponsor.mjs"')
    // pre-A-915 baseline: the executor copy imported only ./gift-sponsor-7702.js. [A-915 re-pin] it now also imports ./gift-create-plan.js (the armed 143 create-step match); the copy points at the real module. No assertion changed.
    .replace('"./gift-create-plan.js"', '"../src/gift-create-plan.js"');
  writeFileSync(TMP_E, srcE);
  const srcN = readFileSync(path.resolve(HERE, "../src/gift-claim-entry.js"), "utf8")
    .replace(/from "\.\/gift-sponsor-7702\.js"/g, 'from "./_a906_tmp_sponsor.mjs"')
    .replace(/from "\.\/(?!_a906)/g, 'from "../src/');
  writeFileSync(TMP_N, srcN);
  M = await import(`./_a906_tmp_sponsor.mjs`);
  // money-executor copy must sit next to the sponsor copy for the relative import; both live in app/test.
  X = await import(`./_a906_tmp_executor.mjs`);
} catch (e) { console.log(`FAIL  copy setup: ${e.message}`); fail += 1; }

if (M && X) {
  const mk = async (over = {}) => {
    let signs = 0;
    const acct = { address: piggy.address, signAuthorization: async (a) => { signs += 1; return piggy.signAuthorization(a); }, signTypedData: async (t) => { signs += 1; return piggy.signTypedData(t); } };
    const s = M.createGiftSponsorSession({ config: CFG, giftId: GIFT, commitHash: COMMIT, account: acct, authNonce: 0, now: () => NOW, readCode: async () => FAKE_CODE, ...over });
    return { s, signs: () => signs };
  };
  await check("session (pins substituted): pinned code ok -> authorization + ONE delegation -> branded request that re-validates", async () => {
    const { s, signs } = await mk();
    assert.equal((await s.signAuthorization()).ok, true);
    assert.equal((await s.signDelegation()).ok, true);
    const b = await s.buildRequest();
    assert.equal(b.ok, true, b.reason);
    assert.deepEqual(Object.keys(b.request), ["giftId", "authorization", "delegation"]);
    assert.equal(b.commitHash, COMMIT);
    assert.equal(M.isGiftSponsorRequest(b.request), true);
    assert.equal(signs(), 2); // exactly two signatures, one Face ID step
    assert.equal((await s.signAuthorization()).reason, R.SECOND_SIGNATURE);
    assert.equal((await s.signDelegation()).reason, R.SECOND_SIGNATURE);
    assert.equal(signs(), 2);
    const re = await M.validateGiftSponsorRequest(JSON.parse(JSON.stringify(b.request)), { ...REQ_CTX });
    assert.equal(re.ok, true, re.reason); // wire round trip (what the relayer receives) passes the same guard
  });
  await check("session (pins substituted): wrong code on ONE pinned contract (e.g. DM) -> nothing signed", async () => {
    const { s, signs } = await mk({ readCode: async (a) => (a.toLowerCase() === GIFT_SPONSOR_PINS.delegationManager.toLowerCase() ? "0x6002" : FAKE_CODE) });
    assert.equal((await s.signAuthorization()).reason, R.CODE_HASH_MISMATCH);
    assert.equal(signs(), 0);
  });
  await check("session (pins substituted): a signer that returns chainId 0 / attacker delegate / wrong-chain is refused, no request", async () => {
    for (const patch of [{ chainId: 0 }, { contractAddress: OTHER }, { chainId: 143 }]) {
      const { s } = await mk({ account: { address: piggy.address, signAuthorization: async () => signedAuth(patch), signTypedData: async (t) => piggy.signTypedData(t) } });
      const r = await s.signAuthorization();
      assert.equal(r.ok, false);
      assert.equal((await s.buildRequest()).ok, false);
    }
  });
  await check("session (pins substituted): a signer whose authorization recovers to another account is refused", async () => {
    const stranger = privateKeyToAccount(generatePrivateKey());
    const { s } = await mk({ account: { address: piggy.address, signAuthorization: (a) => stranger.signAuthorization(a), signTypedData: (t) => piggy.signTypedData(t) } });
    assert.equal((await s.signAuthorization()).reason, R.AUTH_SIGNER);
  });
  await check("session (pins substituted): delegation signed by a different key than the Piggy is refused", async () => {
    const stranger = privateKeyToAccount(generatePrivateKey());
    const { s } = await mk({ account: { address: piggy.address, signAuthorization: (a) => piggy.signAuthorization(a), signTypedData: (t) => stranger.signTypedData(t) } });
    assert.equal((await s.signAuthorization()).ok, true);
    assert.equal((await s.signDelegation()).reason, R.SIGNATURE_INVALID);
    assert.equal((await s.buildRequest()).reason, R.NOT_READY);
  });
  await check("executor exception (copy): branded list on type-4 tx to DelegationManager passes; every deviation keeps its refusal", async () => {
    const { s } = await mk();
    await s.signAuthorization(); await s.signDelegation();
    const { request } = await s.buildRequest();
    const list = M.toExecutorAuthorizationList(request);
    assert.ok(list && Object.isFrozen(list) && list.length === 1);
    assert.equal(M.isGiftSponsorAuthorizationList(list), true);
    const redeemData = M.giftSponsorRedeemData(list);
    assert.equal(redeemData, M.buildRedeemCalldata(request.delegation).toLowerCase());
    const ok = { ...PREP, type: "eip7702", authorizationList: list, data: redeemData };
    assert.equal(X.preparedSignProblem(ok), null); // F2 positive: branded list on 10143, type-4, to=DelegationManager, data = this delegation's redeemDelegations
    assert.equal(X.preparedSignProblem({ ...ok, data: "0x" }), "sponsor_calldata_mismatch");
    assert.equal(X.preparedSignProblem({ ...ok, data: undefined }), "sponsor_calldata_mismatch");
    assert.equal(X.preparedSignProblem({ ...ok, data: redeemData.slice(0, -2) + (redeemData.endsWith("00") ? "01" : "00") }), "sponsor_calldata_mismatch");
    assert.equal(X.preparedSignProblem({ ...ok, type: "eip1559" }), "tx_type_unexpected");
    assert.equal(X.preparedSignProblem({ ...ok, to: ESCROW }), "unexpected_field"); // not the DelegationManager
    assert.equal(X.preparedSignProblem({ ...ok, value: 1n }), "value_invalid");
    assert.equal(X.preparedSignProblem({ ...ok, chainId: 143 }), "chain_id_mismatch");
    assert.equal(X.preparedSignProblem({ ...ok, gasPrice: 1n }), "unexpected_field");
    assert.equal(X.preparedSignProblem({ ...ok, blobs: ["0x"] }), "unexpected_field");
    assert.equal(X.preparedSignProblem({ ...ok, accessList: [{ address: ESCROW, storageKeys: [] }] }), "access_list_present");
    assert.equal(X.preparedSignProblem({ ...ok, gas: 3_000_000n }), "gas_out_of_bounds");
    assert.equal(X.preparedSignProblem({ ...ok, authorizationList: [...list] }), "tx_type_unexpected"); // a copy is not the minted object
    assert.equal(X.preparedSignProblem({ ...ok, authorizationList: Object.freeze([{ ...list[0] }]) }), "tx_type_unexpected");
    assert.equal(X.preparedSignProblem({ ...PREP, authorizationList: list, data: redeemData }), "tx_type_unexpected"); // brand without type-4 is not enough
  });
  await check("executor exception (copy): a list minted for another chain id than the tx chain is refused", async () => {
    // brand records the chain it was validated for; the tx chainId (10143 only) must equal it
    const { s } = await mk({ config: { ...CFG, chainId: 143 }, readCode: async () => FAKE_CODE, account: { address: piggy.address, signAuthorization: (a) => piggy.signAuthorization(a), signTypedData: (t) => piggy.signTypedData(t) } });
    await s.signAuthorization(); await s.signDelegation();
    const b = await s.buildRequest();
    assert.equal(b.ok, true, b.reason);
    const list = M.toExecutorAuthorizationList(b.request);
    assert.equal(X.preparedSignProblem({ ...PREP, type: "eip7702", authorizationList: list, data: M.giftSponsorRedeemData(list) }), "chain_id_mismatch");
  });

  await check("submitter (copy): Piggy only signs; ONE relayer call {giftId,authorization,delegation,claim}; both txs verified on chain; no MON path", async () => {
    const E = await import("./_a906_tmp_entry.mjs");
    const { binding } = E.bindGiftToNewPiggy({ intent: { giftId: GIFT, token: "token-1" }, piggy: { address: piggy.address, sequence: 1 }, preExistingAddresses: [], signerAddress: piggy.address });
    const CL = await import("../src/gift-piggy-claim-link.js");
    const record = { giftId: GIFT, senderAddress: OTHER, claimTokenHash: await CL.hashClaimToken("token-1"), // pre-A-913 baseline: expiresAt "2027-01-01T00:00:00Z" (already passed vs NOW=1.8e9); A-913 refuses a passed deadline before Face ID, so the fixture is a future date.
    expiresAt: "2030-01-01T00:00:00Z" };
    const H1 = `0x${"c1".repeat(32)}`; const H2 = `0x${"c2".repeat(32)}`;
    // [A-966 O1] the mock now behaves like the real escrow (GiftPiggyUSDC.sol:202): claim() DELETES commits[giftId][committer], so after a
    // claim commits() reads zero; the commit tx's receipt carries the escrow's Committed(giftId, committer, commitHash) log, as a real chain does.
    // pre-A-966 mock: commits() kept returning the commit after the claim, and the receipt had no logs:
    //   waitForTransactionReceipt: async () => ({ status: receiptStatus, blockNumber: 5n }),
    //   readContract: ... functionName === "commits" ? [storedHashOverride ?? client.lastCommit, 4n] : ...
    const ZERO32 = `0x${"0".repeat(64)}`;
    const COMMITTED_TOPIC = keccak256(new TextEncoder().encode("Committed(bytes32,address,bytes32)"));
    const CLAIMED_TOPIC = keccak256(new TextEncoder().encode("Claimed(bytes32,address,address,uint256)")); // [A-979 ① r2] GiftPiggyUSDC.sol:141
    const run = async ({ client, claimed = true, storedHashOverride = null, receiptStatus = "success", txFrom = SPONSOR }) => {
      const calls = [];
      const committed = () => storedHashOverride ?? client.lastCommit ?? ZERO32;
      const claimedLog = () => ({ address: ESCROW, topics: [CLAIMED_TOPIC, GIFT, `0x${"0".repeat(24)}${piggy.address.slice(2).toLowerCase()}`], data: "0x", blockNumber: 5n, transactionHash: H2 }); // [A-979 ① r2]
      const chain = {
        chain: { id: CHAIN },
        getTransactionCount: async () => 0n, getCode: async () => FAKE_CODE,
        // [A-979 ① r2] pre-A-979 r2: the H2 (claim) receipt had no logs. A real claim receipt carries the escrow's Claimed(giftId, recipient) log.
        waitForTransactionReceipt: async ({ hash }) => ({ status: receiptStatus, blockNumber: 5n, logs: hash === H1 ? [{ address: ESCROW, topics: [COMMITTED_TOPIC, GIFT, `0x${"0".repeat(24)}${piggy.address.slice(2).toLowerCase()}`], data: committed() }] : hash === H2 && claimed ? [claimedLog()] : [] }),
        getTransaction: async () => ({ to: ESCROW, from: txFrom }),
        readContract: async ({ functionName }) => { calls.push(functionName); return functionName === "commits" ? (claimed ? [ZERO32, 0n] : [committed(), 4n]) : [OTHER, ESCROW, 1n, 0n, claimed, "0x"]; },
        // [A-979 ①] pre-A-979: no getLogs / getBlockNumber. A real RPC node offers both; the 409 replay finds the commit tx (H1) by the escrow's
        // Committed log and then checks that receipt (same rule as the 200 path). The log exists once a commit was made (committed() != 0).
        getBlockNumber: async () => 5n,
        getLogs: async ({ event }) => { calls.push("getLogs"); if (event?.name === "Claimed") return claimed ? [claimedLog()] : []; return committed() === ZERO32 ? [] : [{ address: ESCROW, topics: [COMMITTED_TOPIC, GIFT, `0x${"0".repeat(24)}${piggy.address.slice(2).toLowerCase()}`], data: committed(), blockNumber: 5n, transactionHash: H1 }]; },
      };
      const sub = E.createGiftSponsorClaimSubmitter({ config: CFG, chain, sponsorClient: client, chainScope: "monad-testnet", now: () => NOW, randomBytes: () => new Uint8Array(32).fill(7) });
      assert.ok(sub);
      const out = await sub.submit({ binding, record, token: "token-1", account: acctFor() });
      return { out, calls };
    };
    let signs = 0;
    const acctFor = () => ({ address: piggy.address, signAuthorization: (a) => { signs += 1; return piggy.signAuthorization(a); }, signTypedData: (t) => { signs += 1; return piggy.signTypedData(t); } });
    const okClient = () => { const c = { posts: 0, async submit(req) { c.posts += 1; c.req = req; c.lastCommit = M.sponsorCommitHash(req.claim); return { status: 200, body: { ok: true, state: "CLAIMED", giftId: req.giftId, installTxHash: null, commitTxHash: H1, claimTxHash: H2 } }; } }; return c; };
    const c1 = okClient();
    const r1 = await run({ client: c1 });
    assert.equal(r1.out.status, "value_transferred", JSON.stringify(r1.out));
    assert.equal(c1.posts, 1);
    // pre-A-913 baseline: 4 keys, 2 signatures. A-913: the same Face ID session also signs the revoke authorization (0x0 @ nonce n+1) -> 5 keys (gasTx is registered by the sender beforehand, Cowork c), 3 signatures.
    assert.deepEqual(Object.keys(c1.req), ["giftId", "authorization", "delegation", "claim", "revokeAuthorization"]);
    assert.equal(signs, 3);
    assert.equal(c1.req.claim.recipient, piggy.address);
    assert.ok(!JSON.stringify(r1.out).includes("746f6b656e") && !JSON.stringify(r1.out).includes(SALT32)); // result never carries preimage/salt
    const bad1 = await run({ client: { async submit() { return { status: 409, body: { ok: false, error: "not_available" } }; } }, storedHashOverride: COMMIT, claimed: false });
    assert.equal(bad1.out.status, "commit_failed");
    const bad2 = await run({ client: { async submit() { throw new Error("net"); } } });
    assert.equal(bad2.out.status, "commit_failed");
    const bad3 = await run({ client: { async submit() { return { status: 200, body: { ok: true, state: "CLAIMED", giftId: GIFT, installTxHash: null, commitTxHash: H1 } }; } } });
    assert.equal(bad3.out.status, "commit_failed"); // drifted/partial shape is refused, never half-trusted
    const bad3b = await run({ client: { async submit() { return { status: 200, body: { ok: true, state: "CLAIMED", giftId: GIFT, commitTxHash: H1, claimTxHash: H2 } }; } } });
    assert.equal(bad3b.out.status, "commit_failed"); // installTxHash missing (old/foreign shape)
    // 409 after an on-chain claim: the chain decides (our commit + claimed) -> verified, NOT commit_failed
    const conflict = { async submit(req) { conflict.lastCommit = M.sponsorCommitHash(req.claim); return { status: 409, body: { ok: false, error: "not_available" } }; } };
    const r409 = await run({ client: conflict });
    // [A-979 ①] restored to the pre-A-966 value: the replay now proves "our commit" by the Committed log in the commit receipt (found via getLogs).
    // A-966 interim (pre-A-979): assert.equal(r409.out.status, "commit_failed") — the replay still read commits() at latest, which claim() deletes.
    assert.equal(r409.out.status, "already_claimed_verified");
    assert.ok(r409.calls.includes("gifts"));
    const r409b = await run({ client: conflict, claimed: false });
    assert.equal(r409b.out.status, "commit_failed");
    const r409c = await run({ client: conflict, storedHashOverride: COMMIT });
    assert.equal(r409c.out.status, "commit_failed"); // claimed by someone else's commit: not ours
    const withInstall = { async submit(req) { withInstall.lastCommit = M.sponsorCommitHash(req.claim); return { status: 200, body: { ok: true, state: "CLAIMED", giftId: req.giftId, installTxHash: H1, commitTxHash: H1, claimTxHash: H2 } }; } };
    const rInstall = await run({ client: withInstall });
    assert.equal(rInstall.out.status, "value_transferred");
    assert.equal(rInstall.out.txHashes.install, H1);
    const c4 = okClient();
    assert.equal((await run({ client: c4, storedHashOverride: COMMIT })).out.status, "commit_unverified");
    assert.equal((await run({ client: okClient(), claimed: false })).out.status, "claim_unverified");
    assert.equal((await run({ client: okClient(), txFrom: OTHER })).out.status, "claim_unverified"); // claim not sent by our sponsor
    assert.equal((await run({ client: okClient(), receiptStatus: "reverted" })).out.status, "commit_failed");
  });
  await check("submitter (copy): chain-id mismatch and a sponsor client making no call when guards refuse", async () => {
    const E = await import("./_a906_tmp_entry.mjs");
    const { binding } = E.bindGiftToNewPiggy({ intent: { giftId: GIFT, token: "token-2" }, piggy: { address: piggy.address, sequence: 1 }, preExistingAddresses: [], signerAddress: piggy.address });
    const CL = await import("../src/gift-piggy-claim-link.js");
    const record = { giftId: GIFT, senderAddress: OTHER, claimTokenHash: await CL.hashClaimToken("token-2"), // pre-A-913 baseline: expiresAt "2027-01-01T00:00:00Z" (already passed vs NOW=1.8e9); A-913 refuses a passed deadline before Face ID, so the fixture is a future date.
    expiresAt: "2030-01-01T00:00:00Z" };
    let posts = 0;
    const client = { async submit() { posts += 1; return { ok: false }; } };
    const mkChain = (code) => ({ chain: { id: CHAIN }, getTransactionCount: async () => 0n, getCode: async () => code, waitForTransactionReceipt: async () => null, getTransaction: async () => null, readContract: async () => [] });
    const acct = { address: piggy.address, signAuthorization: (a) => piggy.signAuthorization(a), signTypedData: (t) => piggy.signTypedData(t) };
    // delegate code differs from the pinned hash -> guard refuses, nothing is posted
    const sub = E.createGiftSponsorClaimSubmitter({ config: CFG, chain: mkChain("0x6002"), sponsorClient: client, chainScope: "monad-testnet", now: () => NOW, randomBytes: () => new Uint8Array(32).fill(7) });
    const out = await sub.submit({ binding, record, token: "token-2", account: acct });
    assert.deepEqual([out.status, out.reason], ["guard_refused", R.CODE_HASH_MISMATCH]);
    assert.equal(posts, 0);
    const other = E.createGiftSponsorClaimSubmitter({ config: { ...CFG, chainId: 143 }, chain: mkChain(FAKE_CODE), sponsorClient: client, chainScope: "monad-mainnet" });
    assert.equal((await other.submit({ binding, record, token: "token-2", account: acct })).status, "chain_scope_mismatch");
    assert.equal(posts, 0);
  });

  await check("CONTRACT: the REAL relayer gift-sponsor-service handle() output (offline, stubbed chain reads) is accepted by the app submitter; shapes cannot drift", async () => {
    const SV = await import("../../relayer/src/gift-sponsor-service.mjs");
    const E = await import("./_a906_tmp_entry.mjs");
    const CL = await import("../src/gift-piggy-claim-link.js");
    const { sha256, stringToHex, keccak256: k256 } = await import("viem");
    const TOKEN = "token-contract";
    const { binding } = E.bindGiftToNewPiggy({ intent: { giftId: GIFT, token: TOKEN }, piggy: { address: piggy.address, sequence: 1 }, preExistingAddresses: [], signerAddress: piggy.address });
    const expiresAt = "2030-01-01T00:00:00Z";
    const record = { giftId: GIFT, senderAddress: OTHER, claimTokenHash: await CL.hashClaimToken(TOKEN), expiresAt };
    const deadlineSec = BigInt(Math.floor(Date.parse(expiresAt) / 1000));
    const fakeHash = k256(FAKE_CODE);
    const policy = SV.createGiftSponsorPolicy({
      chainId: CHAIN, escrow: ESCROW, delegationManager: GIFT_SPONSOR_PINS.delegationManager, delegateImpl: GIFT_SPONSOR_PINS.statelessDelegate, sponsorAddress: SPONSOR,
      exactExecutionEnforcer: GIFT_SPONSOR_PINS.exactExecutionEnforcer, limitedCallsEnforcer: GIFT_SPONSOR_PINS.limitedCallsEnforcer, timestampEnforcer: GIFT_SPONSOR_PINS.timestampEnforcer,
      implCodeHash: fakeHash, delegationManagerCodeHash: fakeHash, exactExecutionCodeHash: fakeHash, limitedCallsCodeHash: fakeHash, timestampCodeHash: fakeHash, maxExpirySeconds: 300, // pre-A-913 baseline: maxExpirySeconds: 3600
      gasUnits: { install: 46429n, commit: 174887n, revoke: 46382n, claim: 100000n }, gasBufferBps: 1000, // [A-913] injected gas units + buffer (min deposit is computed per gift)
    }, { addresses: SV.GIFT_SPONSOR_PIN_TABLE.addresses, hashes: { [CHAIN]: {} } }); // test-only pin table: addresses real, code hashes = the fake code
    assert.ok(policy);
    let gift = { exists: true, claimed: false, sender: OTHER, expiry: deadlineSec, claimTokenHash: null };
    const sent = [];
    const hashFor = (kind) => `0x${Buffer.from(`${kind}`).toString("hex").padEnd(64, "0")}`;
    const relayerChain = {
      getGift: async () => ({ ...gift, claimTokenHash: sha256(stringToHex(TOKEN)) }),
      getCode: async (a) => (a.toLowerCase() === piggy.address.toLowerCase() ? "0x" : FAKE_CODE),
      getNonce: async () => 0n, getTimestamp: async () => BigInt(NOW), simulate: async () => "0x", waitBlockAfter: async () => {},
      // [A-913] new relayer chain methods (pre-A-913 baseline: none of these existed)
      getFeePerGasWei: async () => 100n, getSponsorBalance: async () => 10n ** 18n, getSponsorNonces: async () => ({ latest: 0n, pending: 0n }),
      confirmCommit: async () => true, getCommit: async () => null, getReceipt: async () => null,
      getGasDepositTx: async () => ({ from: OTHER, to: SPONSOR, value: 10n ** 18n, data: GIFT, status: "success" }),
    };
    const sponsorStub = { address: SPONSOR, send: async ({ kind, value }) => { assert.equal(value, 0n); sent.push(kind); if (kind === "claim") gift = { ...gift, claimed: true }; return { txHash: hashFor(kind), blockNumber: 7n, status: "success" }; } };
    const contractLedger = SV.openGiftSponsorLedger(null);
    await contractLedger.registerGasTx(GIFT, `0x${"ee".repeat(32)}`); // [A-913 Cowork c] the sender registered its deposit tx beforehand; the recipient claim carries no gasTx
    const service = SV.createGiftSponsorService({ ledger: contractLedger, policy, chain: relayerChain, sponsor: sponsorStub, preflight: async () => true }); // pre-A-913 baseline: no preflight
    const outputs = [];
    const client = { submit: async (req) => { const r = await service.handle(JSON.parse(JSON.stringify(req))); outputs.push(r); return r; } };
    // [A-966 O1] real-escrow mock: claim() deletes the commit (commits() = 0 once claimed); the commit (redeem) receipt carries the Committed log.
    // pre-A-966: waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 7n }) · commits() = [client.lastCommit, 7n] even after the claim
    const Z32 = `0x${"0".repeat(64)}`;
    const COMMITTED_T0 = k256(stringToHex("Committed(bytes32,address,bytes32)"));
    const claimedL = () => ({ address: ESCROW, topics: [k256(stringToHex("Claimed(bytes32,address,address,uint256)")), GIFT, `0x${"0".repeat(24)}${piggy.address.slice(2).toLowerCase()}`], data: "0x", blockNumber: 7n, transactionHash: hashFor("claim") }); // [A-979 ① r2]
    const chain = {
      chain: { id: CHAIN }, getTransactionCount: async () => 0n, getCode: async () => FAKE_CODE,
      // [A-979 ① r2] pre-A-979 r2: the claim receipt had no logs; a real one carries Claimed(giftId, recipient)
      waitForTransactionReceipt: async ({ hash }) => ({ status: "success", blockNumber: 7n, logs: hash === hashFor("redeem") ? [{ address: ESCROW, topics: [COMMITTED_T0, GIFT, `0x${"0".repeat(24)}${piggy.address.slice(2).toLowerCase()}`], data: client.lastCommit }] : hash === hashFor("claim") && gift.claimed ? [claimedL()] : [] }),
      getTransaction: async () => ({ to: ESCROW, from: SPONSOR }),
      readContract: async ({ functionName, args }) => (functionName === "commits" ? (gift.claimed ? [Z32, 0n] : [client.lastCommit, 7n]) : [OTHER, ESCROW, 1n, deadlineSec, gift.claimed, "0x"]),
      // [A-979 ①] pre-A-979: no getLogs / getBlockNumber. Once the redeem (commit) tx was sent, the escrow's Committed log is findable by getLogs.
      getBlockNumber: async () => 7n,
      getLogs: async ({ event }) => (event?.name === "Claimed" ? (gift.claimed ? [claimedL()] : []) : sent.includes("redeem") ? [{ address: ESCROW, topics: [COMMITTED_T0, GIFT, `0x${"0".repeat(24)}${piggy.address.slice(2).toLowerCase()}`], data: client.lastCommit, blockNumber: 7n, transactionHash: hashFor("redeem") }] : []),
    };
    const origSubmit = client.submit;
    client.submit = async (req) => { client.lastCommit = M.sponsorCommitHash(req.claim); return origSubmit(req); };
    const sub = E.createGiftSponsorClaimSubmitter({ config: CFG, chain, sponsorClient: client, chainScope: "monad-testnet", now: () => NOW, randomBytes: () => new Uint8Array(32).fill(9) });
    assert.ok(sub);
    const acct = { address: piggy.address, signAuthorization: (a) => piggy.signAuthorization(a), signTypedData: (t) => piggy.signTypedData(t) };
    const out = await sub.submit({ binding, record, token: TOKEN, account: acct });
    assert.equal(out.status, "value_transferred", JSON.stringify({ out, relayer: outputs[0] }));
    assert.equal(outputs[0].status, 200);
    for (const k of ["claimTxHash", "commitTxHash", "giftId", "installTxHash", "ok", "state"]) assert.ok(Object.hasOwn(outputs[0].body, k), `relayer body lacks ${k}`); // required keys; extras are ignored
    assert.deepEqual(sent, ["install", "redeem", "claim"]); // revoke is skipped here: this stub never installs the designator, so the Piggy already reads clean (pre-A-913 baseline: same list)
    assert.equal(out.txHashes.claim, outputs[0].body.claimTxHash);
    // replay: the relayer answers 409; the gift is claimed on chain with our commit -> verified, not commit_failed
    const again = await sub.submit({ binding, record, token: TOKEN, account: acct });
    // [A-979 ①] restored to the pre-A-966 value (already_claimed_verified | guard_refused).
    // A-966 interim (pre-A-979): assert.equal(again.status, "commit_failed", JSON.stringify(again)) — the replay read commits() at latest.
    assert.equal(again.status === "already_claimed_verified" || again.status === "guard_refused", true, JSON.stringify(again));
  });
}
if (!process.env.A906_KEEP) for (const f of [TMP_S, TMP_E, TMP_N]) { try { rmSync(f); } catch {} }

console.log(`\nA-906: ${pass}/${pass + fail} PASS${fail ? ` · ${fail} FAIL` : ""}`);
process.exit(fail ? 1 : 0);
