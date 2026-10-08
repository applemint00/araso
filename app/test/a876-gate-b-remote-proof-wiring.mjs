// [A-876] Gate B remote-proof runtime adapter boundary. A-871 release-grade capability reaches Gate B
// recovery/publish ONLY through the optional `releaseProof` hook. SAME_SECRET (A-857 HMAC) = local_proof_only,
// never "complete"; anchored_fresh only for ASYMMETRIC_VERIFIER / INDEPENDENT_ANCHOR; provider unavailable =
// existing unverified_fresh semantics; adapter absent = byte-identical legacy behaviour.
// LOCAL ONLY: memory adapter, deterministic fake WebAuthn, network 0, provider 0.
//   node app/test/a876-gate-b-remote-proof-wiring.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { admitModelAPiggy, loadMyPiggiesIndex, myPiggiesIndexKey, registerControlledPiggy, markBornPiggyIssuance } from "../src/piggy-index.js";
import { publishIndexBackup, resolveReleaseTrust, RELEASE_TRUST } from "../src/index-backup.js";
import { createMemoryGateBAdapter, deriveGateBLocator, discoverGateBRoot, gateBLocatorPrfSalt, recoverProductList } from "../src/gate-b-recovery.js";
import { createMemoryStorage } from "../src/second-journey-state.js";
import { modelASaltHex } from "../src/piggy-session.js";
import {
  CAPABILITY, advanceMessage, classifyAuthority, createEd25519Verifier, ed25519KeyFromSeed, signAdvance, trustLabel,
} from "../src/gate-b-remote-proof.js";

const SRC = new URL("../src/", import.meta.url);
const CHAIN = "monad-testnet";
const AT = "2026-10-07T12:00:00.000Z";
const RP = "araso-harness.local.test";
const KEY = myPiggiesIndexKey(CHAIN);

// ── fake user (PRF = HMAC(secret, salt), this run only) ────────────────────────────────────────────────
function makeUser(label) {
  const idBytes = new Uint8Array(Buffer.from(`${label}-root`));
  const id = Buffer.from(idBytes).toString("base64url");
  const secret = crypto.randomBytes(32);
  let asked = 0;
  const client = {
    async createCredential() { throw new Error("createCredential must never be called"); },
    async getCredential(req) {
      asked += 1;
      return { credentialId: idBytes, prfOutput: new Uint8Array(crypto.createHmac("sha256", secret).update(Buffer.from(req.prfSalt)).digest()) };
    },
  };
  const requestPrf = (credential, prfSalt) => getPasskeyPrfOutput({ rpId: RP, ...(credential ? { credential } : {}), prfSalt, webAuthnClient: client });
  return { id, root: { credentialId: id }, requestPrf, asked: () => asked };
}
const addressOf = (prf) => getEvmAddress(createSecp256k1SigningSession({ privateKey: prf }).publicKey);
function fifoLocks() {
  const tails = new Map();
  return { request(name, _o, fn) { const run = (tails.get(name) || Promise.resolve()).then(() => fn()); tails.set(name, run.catch(() => {})); return run; } };
}
async function originDevice(user, n) {
  const s = createMemoryStorage();
  const first = "0x" + crypto.createHash("sha256").update(`first/${user.id}`).digest("hex").slice(0, 40);
  assert.equal(registerControlledPiggy(s, CHAIN, { address: first, signerAddress: first, locator: { credentialId: user.id }, at: AT }).ok, true);
  assert.equal(markBornPiggyIssuance(s, CHAIN, { address: first }).ok, true);
  for (let i = 1; i <= n; i += 1) {
    const out = await admitModelAPiggy({ storage: s, chainId: CHAIN, locks: fifoLocks(), rootCredential: user.root, requestPrf: user.requestPrf, deriveAddress: addressOf, now: () => AT });
    assert.equal(out.ok, true, out.reason);
  }
  return s;
}
async function scopesOf(user) {
  const lp = await user.requestPrf(user.root, await gateBLocatorPrfSalt());
  return deriveGateBLocator(lp.prfOutput);
}
async function publish(remote, user, storage, extra = {}) {
  const { discoveryKey, backupScope } = await scopesOf(user);
  const out = await publishIndexBackup({ adapter: remote.backupStore(backupScope), storage, chainId: CHAIN, rootCredential: user.root, requestPrf: user.requestPrf, anchor: remote.anchor, anchorScope: backupScope, ...extra });
  if (out.published) await remote.announce(discoveryKey, { recordVersion: out.recordVersion });
  return { ...out, backupScope };
}
async function recover(remote, user, { releaseProof, anchor = remote.anchor, requestPrf = user.requestPrf, storage = createMemoryStorage() } = {}) {
  const found = await discoverGateBRoot({ adapter: remote, requestPrf: user.requestPrf });
  assert.equal(found.status, "member");
  return recoverProductList({
    adapter: remote.backupStore(found.backupScope), anchor, anchorScope: found.backupScope, storage, chainId: CHAIN,
    rootCredential: { credentialId: found.candidateCredentialId }, requestPrf, deriveAddress: addressOf, locks: fifoLocks(), now: () => AT, discovery: found,
    ...(releaseProof !== undefined ? { releaseProof } : {}),
  });
}

// ── A-871 capability fixtures ─────────────────────────────────────────────────────────────────────────
const SEED = new Uint8Array(32).fill(7);
const signer = await ed25519KeyFromSeed(SEED);
const verifier = await createEd25519Verifier(signer.publicKeyHex);
let chSeq = 0;
const nextChallenge = () => crypto.createHash("sha256").update(`challenge/${++chSeq}`).digest("hex");
const DESC = {
  asymmetric: { writeProof: { verifier }, storage: { authorityId: "store" }, anchor: { authorityId: "store" } },
  independent: { writeProof: { scheme: "ed25519" }, storage: { authorityId: "store-a", secretFingerprint: "fp-a" }, anchor: { authorityId: "anchor-b", secretFingerprint: "fp-b" } },
  sameSecret: { writeProof: { scheme: "hmac-sha256", verifierHoldsSigningSecret: true }, storage: { authorityId: "store" }, anchor: { authorityId: "store" } },
  unknown: {},
};
const toMsg = (t, challenge) => advanceMessage({ scopeId: t.scope, prevVersion: t.prevVersion, version: t.nextVersion, digest: t.envelopeDigest, challenge });
function hook(desc, { sign = false, verifySelf = false, tupleSeen = null } = {}) {
  const verdict = classifyAuthority(desc);
  const h = { trust: ({ anchorOutcome }) => trustLabel({ authority: verdict, anchorOutcome }) };
  if (sign) {
    h.makeProof = async (t) => {
      if (tupleSeen) tupleSeen.push(t);
      const challenge = nextChallenge();
      return { challenge, signature: await signAdvance(signer.privateKey, { scopeId: t.scope, prevVersion: t.prevVersion, version: t.nextVersion, digest: t.envelopeDigest, challenge }), publicKey: signer.publicKeyHex };
    };
  }
  if (verifySelf) h.verifyProof = (t, p) => verifier.verify(toMsg(t, p.challenge), p.signature);
  return h;
}
// anchor-side verifier for the memory adapter: public key only, single-use challenge
function asymAnchorVerify() {
  const used = new Set();
  return async (t, p) => {
    if (!p || typeof p !== "object" || p.publicKey !== verifier.publicKeyHex || used.has(p.challenge)) return false;
    const ok = await verifier.verify(toMsg(t, p.challenge), p.signature);
    if (ok) used.add(p.challenge);
    return ok;
  };
}

let pass = 0;
const seen = [];
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }
const seq = (s) => loadMyPiggiesIndex(s, CHAIN).index.piggies.filter((p) => p.sequence).map((p) => p.sequence).sort((a, b) => a - b);

// legacy (A-857 HMAC) world: anchor matches rv=1
async function hmacWorld() {
  const remote = createMemoryGateBAdapter();
  const user = makeUser("alice");
  const storage = await originDevice(user, 3);
  const v1 = await publish(remote, user, storage);
  assert.deepEqual(v1.anchor, { advanced: true, reason: null });    // no hook → legacy result shape, unchanged
  return { remote, user, storage, v1 };
}

// ════════════════════════════════════ recovery matrix ════════════════════════════════════════════════
await check("R1. no hook + A-857 HMAC anchor match → local_proof_only (never anchored_fresh, never complete)", async () => {
  const { remote, user } = await hmacWorld();
  const out = await recover(remote, user);
  assert.equal(out.status, "ok");
  assert.equal(out.completeness, "local_proof_only");
  assert.equal(out.freshnessAnchor.state, "local_proof_only");
  assert.deepEqual(out.freshnessAnchor.trust, { label: "local_proof_only", capability: "same_secret", releaseGrade: false, globallyLatest: false });
  seen.push(out.completeness);
});

await check("R2. SAME_SECRET hook → local_proof_only; UNKNOWN hook → local_proof_only", async () => {
  const { remote, user } = await hmacWorld();
  for (const [d, cap] of [[DESC.sameSecret, CAPABILITY.SAME_SECRET], [DESC.unknown, CAPABILITY.UNKNOWN]]) {
    const out = await recover(remote, user, { releaseProof: hook(d) });
    assert.equal(out.completeness, "local_proof_only");
    assert.equal(out.freshnessAnchor.trust.capability, cap);
    assert.equal(out.freshnessAnchor.trust.releaseGrade, false);
    seen.push(out.completeness);
  }
});

// [A-876 review F1 · RESIDUAL / Owner + release gate] R3 pairs an A-857 HMAC (same-secret) memory anchor with a caller-declared
// ASYMMETRIC / INDEPENDENT verdict and gets anchored_fresh. That is deliberate: the runtime does NOT bind the hook's capability
// to the anchor actually queried — the pairing is a CALLER OBLIGATION, not a property this boundary checks. The future
// provider card must build {anchor, releaseProof} from one descriptor/verifier (single factory) and be reviewed for it.
await check("R3. ASYMMETRIC_VERIFIER hook + match → anchored_fresh (globallyLatest false); INDEPENDENT_ANCHOR hook → anchored_fresh", async () => {
  const { remote, user } = await hmacWorld();
  for (const [d, cap] of [[DESC.asymmetric, "asymmetric_verifier"], [DESC.independent, "independent_anchor"]]) {
    const storage = createMemoryStorage();
    const out = await recover(remote, user, { releaseProof: hook(d), storage });
    assert.equal(out.completeness, "anchored_fresh");
    assert.equal(out.freshnessAnchor.state, "anchored_fresh");
    assert.deepEqual(out.freshnessAnchor.trust, { label: "anchored_fresh", capability: cap, releaseGrade: true, globallyLatest: false });
    assert.deepEqual(seq(storage), [1, 2, 3]);
    seen.push(out.completeness);
  }
});

await check("R4. forged / malformed / throwing hook answers fail closed → local_proof_only", async () => {
  const { remote, user } = await hmacWorld();
  const forged = [
    { label: "anchored_fresh", capability: "same_secret", releaseGrade: true, globallyLatest: false },
    { label: "anchored_fresh", capability: "unknown", releaseGrade: true, globallyLatest: false },
    { label: "anchored_fresh", capability: "asymmetric_verifier", releaseGrade: "true", globallyLatest: false },
    { label: "anchored_fresh", capability: "asymmetric_verifier", releaseGrade: true, globallyLatest: true },
    { label: "anchored_fresh", capability: "asymmetric_verifier", releaseGrade: true },
    { label: "local_proof_only", capability: "asymmetric_verifier", releaseGrade: true, globallyLatest: false },
    { label: "complete", capability: "asymmetric_verifier", releaseGrade: true, globallyLatest: false },
    null, [], "anchored_fresh",
  ];
  for (const t of forged) {
    const out = await recover(remote, user, { releaseProof: { trust: () => t } });
    assert.equal(out.completeness, "local_proof_only", JSON.stringify(t));
  }
  const throwing = await recover(remote, user, { releaseProof: { trust: () => { throw new Error("x"); } } });
  assert.equal(throwing.completeness, "local_proof_only");
  const notFn = await recover(remote, user, { releaseProof: { trust: "anchored_fresh" } });
  assert.equal(notFn.completeness, "local_proof_only");
  // look-alike verdict object passed to A-871 trustLabel is re-classified (fails closed) → local_proof_only
  const lookAlike = { capability: "asymmetric_verifier", releaseGrade: true, reasons: [] };
  const viaA871 = await recover(remote, user, { releaseProof: { trust: ({ anchorOutcome }) => trustLabel({ authority: lookAlike, anchorOutcome }) } });
  assert.equal(viaA871.completeness, "local_proof_only");
});

await check("R5. provider unavailable / ahead / null anchor with release-grade hook → existing unverified_fresh semantics", async () => {
  const { remote, user, storage } = await hmacWorld();
  const rel = hook(DESC.asymmetric);
  remote.setAnchorOutage(true);
  const down = await recover(remote, user, { releaseProof: rel });
  assert.equal(down.status, "ok");
  assert.equal(down.completeness, "unverified_fresh");
  assert.equal(down.freshnessAnchor.state, "unreachable");
  assert.equal("trust" in down.freshnessAnchor, false);
  remote.setAnchorOutage(false);
  const malformed = await recover(remote, user, { releaseProof: rel, anchor: { get: async () => ({ recordVersion: "1" }), advance: async () => {} } });
  assert.equal(malformed.completeness, "unverified_fresh");
  assert.equal(malformed.freshnessAnchor.state, "unreachable");
  // anchor behind the blob (advance failed) → ahead_of_anchor → unverified_fresh
  await admitModelAPiggy({ storage, chainId: CHAIN, locks: fifoLocks(), rootCredential: user.root, requestPrf: user.requestPrf, deriveAddress: addressOf, now: () => AT });
  remote.setAnchorOutage(true);
  const v2 = await publish(remote, user, storage);
  assert.equal(v2.published, true);
  remote.setAnchorOutage(false);
  const ahead = await recover(remote, user, { releaseProof: rel });
  assert.equal(ahead.freshnessAnchor.state, "ahead_of_anchor");
  assert.equal(ahead.completeness, "unverified_fresh");
  // a device with a local baseline keeps the existing not_older_than_local_baseline label
  const again = await recover(remote, user, { releaseProof: rel, storage });
  assert.equal(again.completeness === "anchored_fresh", false);
  seen.push(down.completeness, ahead.completeness);
});

await check("R6. release-grade hook never overrides refusals: anchor_rollback / anchor_digest_mismatch still refused; skipped → incomplete", async () => {
  const { remote, user, v1 } = await hmacWorld();
  const rel = hook(DESC.asymmetric);
  remote._adminSetAnchor(v1.backupScope, { recordVersion: 5, envelopeDigest: "a".repeat(64) });
  const rb = await recover(remote, user, { releaseProof: rel });
  assert.deepEqual([rb.status, rb.reason, rb.completeness], ["refused", "anchor_rollback", "unverified_fresh"]);
  remote._adminSetAnchor(v1.backupScope, { recordVersion: 1, envelopeDigest: "b".repeat(64) });
  const dm = await recover(remote, user, { releaseProof: rel });
  assert.deepEqual([dm.status, dm.reason], ["refused", "anchor_digest_mismatch"]);
  const fresh = await hmacWorld();
  const flaky = async (cred, salt) => {
    if (salt && Buffer.from(salt).toString("hex") === modelASaltHex(2)) throw new Error("NotAllowedError");
    return fresh.user.requestPrf(cred, salt);
  };
  const inc = await recover(fresh.remote, fresh.user, { releaseProof: rel, requestPrf: flaky });
  assert.equal(inc.freshnessAnchor.state, "anchored_fresh");
  assert.ok(inc.skipped.length >= 1);
  assert.equal(inc.completeness, "incomplete");
  seen.push(inc.completeness);
});

await check("R7. resolveReleaseTrust contract: unmatched → unverified_fresh regardless of hook", async () => {
  for (const h of [null, hook(DESC.asymmetric), hook(DESC.sameSecret)]) {
    const t = await resolveReleaseTrust(h, { matched: false });
    assert.equal(t.label, RELEASE_TRUST.UNVERIFIED);
    assert.equal(t.releaseGrade, false);
  }
  assert.equal((await resolveReleaseTrust(null, { matched: true })).label, RELEASE_TRUST.LOCAL_ONLY);
});

// ════════════════════════════════════ absent path ════════════════════════════════════════════════════
await check("X1. adapter absent: no_adapter, PRF asked 0 times, hook never consulted (with or without releaseProof)", async () => {
  const user = makeUser("bob");
  let consulted = 0;
  const spy = { trust: () => { consulted += 1; return null; }, makeProof: () => { consulted += 1; } };
  const base = { storage: createMemoryStorage(), chainId: CHAIN, rootCredential: user.root, requestPrf: user.requestPrf, deriveAddress: addressOf, locks: fifoLocks() };
  const a = await recoverProductList({ ...base, adapter: null });
  const b = await recoverProductList({ ...base, adapter: null, releaseProof: spy });
  assert.deepEqual(a, b);
  assert.equal(a.status, "no_adapter");
  const p = await publishIndexBackup({ adapter: null, storage: base.storage, chainId: CHAIN, rootCredential: user.root, requestPrf: user.requestPrf, releaseProof: spy });
  assert.deepEqual(p, { published: false, reason: "no_adapter" });
  assert.equal(user.asked(), 0);
  assert.equal(consulted, 0);
});

await check("X2. backup adapter but NO anchor: hook ignored, result identical to legacy (freshnessAnchor null, unverified_fresh)", async () => {
  const { remote, user } = await hmacWorld();
  const found = await discoverGateBRoot({ adapter: remote, requestPrf: user.requestPrf });
  let consulted = 0;
  const spy = { trust: () => { consulted += 1; return { label: "anchored_fresh", capability: "asymmetric_verifier", releaseGrade: true, globallyLatest: false }; } };
  const args = { adapter: remote.backupStore(found.backupScope), chainId: CHAIN, rootCredential: { credentialId: found.candidateCredentialId }, requestPrf: user.requestPrf, deriveAddress: addressOf, locks: fifoLocks(), now: () => AT, discovery: found };
  const legacy = await recoverProductList({ ...args, storage: createMemoryStorage() });
  const hooked = await recoverProductList({ ...args, storage: createMemoryStorage(), releaseProof: spy });
  assert.deepEqual(hooked, legacy);
  assert.equal(legacy.completeness, "unverified_fresh");
  assert.equal(legacy.freshnessAnchor, null);
  assert.equal(consulted, 0);
  // publish without anchor: same shape as before, no anchor block
  const s = await originDevice(user, 1);
  const { backupScope } = await scopesOf(user);
  const store = createMemoryGateBAdapter().backupStore(backupScope);
  const pub = await publishIndexBackup({ adapter: store, storage: s, chainId: CHAIN, rootCredential: user.root, requestPrf: user.requestPrf, releaseProof: spy });
  assert.deepEqual(Object.keys(pub).sort(), ["key", "published", "reason", "recordVersion"]);
  assert.equal(consulted, 0);
});

// ════════════════════════════════════ publish matrix ═════════════════════════════════════════════════
async function asymRemote() {
  const remote = createMemoryGateBAdapter({ verifyAnchorProof: asymAnchorVerify() });
  const user = makeUser("carol");
  const storage = await originDevice(user, 2);
  return { remote, user, storage };
}

await check("P1. release-grade hook with a real Ed25519 proof → anchor advanced; fresh device with the same hook → anchored_fresh", async () => {
  const { remote, user, storage } = await asymRemote();
  const tuples = [];
  const rel = hook(DESC.asymmetric, { sign: true, verifySelf: true, tupleSeen: tuples });
  const pub = await publish(remote, user, storage, { releaseProof: rel });
  assert.equal(pub.published, true);
  assert.deepEqual(pub.anchor, { advanced: true, reason: null, capability: "asymmetric_verifier" });
  // hook got the tuple only — no PRF output, credential or address
  assert.deepEqual(Object.keys(tuples[0]).sort(), ["envelopeDigest", "nextVersion", "prevVersion", "scope"]);
  const out = await recover(remote, user, { releaseProof: rel });
  assert.equal(out.completeness, "anchored_fresh");
  const noHook = await recover(remote, user);
  assert.equal(noHook.completeness, "local_proof_only");
  seen.push(out.completeness, noHook.completeness);
});

await check("P2. capability/proof mismatch: release-grade hook without makeProof → release_proof_unavailable, never falls back to HMAC", async () => {
  const { remote, user, storage } = await asymRemote();
  let hmacUsed = 0;
  const pub = await publish(remote, user, storage, { releaseProof: hook(DESC.asymmetric), makeProof: async () => { hmacUsed += 1; return "0".repeat(64); } });
  assert.equal(pub.published, true);
  assert.deepEqual(pub.anchor, { advanced: false, reason: "release_proof_unavailable", capability: "asymmetric_verifier" });
  assert.equal(hmacUsed, 0);
  assert.equal(await remote.anchor.get(pub.backupScope), null);
  const throwing = await publish(remote, user, storage, { releaseProof: { ...hook(DESC.asymmetric), makeProof: async () => { throw new Error("anchor_cas_conflict"); } } });
  assert.equal(throwing.anchor.reason, "release_proof_unavailable");
});

await check("P3. mismatch: release-grade hook returning HMAC hex / extra identity fields / bad shapes → release_proof_mismatch, nothing uploaded", async () => {
  const { remote, user, storage } = await asymRemote();
  let advanceCalls = 0;
  const anchor = { get: remote.anchor.get, advance: async (...a) => { advanceCalls += 1; return remote.anchor.advance(...a); } };
  const good = await hook(DESC.asymmetric, { sign: true }).makeProof({ scope: "1".repeat(64), prevVersion: 0, nextVersion: 1, envelopeDigest: "2".repeat(64) });
  const bads = [
    "0".repeat(64),                                                         // A-857 HMAC shape
    { ...good, credentialId: "alice-root" },
    { ...good, address: "0x" + "1".repeat(40) },
    { ...good, prfOutput: "3".repeat(64) },
    { ...good, privateKey: "4".repeat(64) },
    { challenge: good.challenge, signature: good.signature },
    { ...good, signature: good.signature.toUpperCase() },
    { ...good, publicKey: { toString: () => signer.publicKeyHex } },
    [good.challenge, good.signature, good.publicKey],
    null,
  ];
  const { backupScope } = await scopesOf(user);
  for (const b of bads) {
    const rel = { ...hook(DESC.asymmetric), makeProof: async () => b };
    const pub = await publishIndexBackup({ adapter: remote.backupStore(backupScope), storage, chainId: CHAIN, rootCredential: user.root, requestPrf: user.requestPrf, anchor, anchorScope: backupScope, releaseProof: rel });
    assert.equal(pub.published, true);
    assert.equal(pub.anchor.reason, "release_proof_mismatch", JSON.stringify(b));
  }
  assert.equal(advanceCalls, 0);
  assert.equal(await remote.anchor.get(backupScope), null);
});

await check("P4. mismatch: proof for another tuple / another key → local self-check (verifyProof) or anchor verifier rejects", async () => {
  const { remote, user, storage } = await asymRemote();
  const other = await ed25519KeyFromSeed(new Uint8Array(32).fill(9));
  const wrongTuple = { ...hook(DESC.asymmetric, { verifySelf: true }), makeProof: async (t) => {
    const challenge = nextChallenge();
    return { challenge, signature: await signAdvance(signer.privateKey, { scopeId: t.scope, prevVersion: t.prevVersion, version: t.nextVersion + 1, digest: t.envelopeDigest, challenge }), publicKey: signer.publicKeyHex };
  } };
  const p1 = await publish(remote, user, storage, { releaseProof: wrongTuple });
  assert.equal(p1.anchor.reason, "release_proof_mismatch");
  const wrongKey = { ...hook(DESC.asymmetric), makeProof: async (t) => {
    const challenge = nextChallenge();
    return { challenge, signature: await signAdvance(other.privateKey, { scopeId: t.scope, prevVersion: t.prevVersion, version: t.nextVersion, digest: t.envelopeDigest, challenge }), publicKey: other.publicKeyHex };
  } };
  const p2 = await publish(remote, user, storage, { releaseProof: wrongKey });
  assert.equal(p2.anchor.reason, "anchor_write_unauthorized");
  assert.equal(await remote.anchor.get(p2.backupScope), null);
});

await check("P5. SAME_SECRET / UNKNOWN hook on publish → legacy HMAC path (capability reported), recovery stays local_proof_only", async () => {
  const remote = createMemoryGateBAdapter();
  const user = makeUser("dave");
  const storage = await originDevice(user, 1);
  const pub = await publish(remote, user, storage, { releaseProof: hook(DESC.sameSecret) });
  assert.deepEqual(pub.anchor, { advanced: true, reason: null, capability: "same_secret" });
  const pubU = await publish(remote, user, storage, { releaseProof: hook(DESC.unknown) });
  assert.deepEqual(pubU.anchor, { advanced: true, reason: null, capability: "unknown" });
  const out = await recover(remote, user, { releaseProof: hook(DESC.sameSecret) });
  assert.equal(out.completeness, "local_proof_only");
  // a same-secret anchor can never be relabelled anchored_fresh by a forged hook answer either
  const forged = await recover(remote, user, { releaseProof: { trust: () => ({ label: "anchored_fresh", capability: "same_secret", releaseGrade: true, globallyLatest: false }) } });
  assert.equal(forged.completeness, "local_proof_only");
  // anchor unreachable on publish keeps the A-857 semantics (published true, anchor_unreachable)
  remote.setAnchorOutage(true);
  const down = await publish(remote, user, storage, { releaseProof: hook(DESC.asymmetric, { sign: true }) });
  assert.equal(down.published, true);
  assert.equal(down.anchor.reason, "anchor_unreachable");
  seen.push(out.completeness);
});

await check("P7. [review F2] hook present but trust() throws / malformed / inconsistent → release_proof_unavailable, no advance, no HMAC, no prfOutput", async () => {
  const remote = createMemoryGateBAdapter();                      // symmetric anchor that WOULD accept an HMAC hex proof
  const user = makeUser("erin");
  const storage = await originDevice(user, 1);
  const { backupScope } = await scopesOf(user);
  let legacyCalls = 0;
  const legacyMakeProof = async (args) => { legacyCalls += 1; assert.fail(`legacy makeProof reached with keys ${Object.keys(args)}`); };
  const broken = [
    { trust: () => { throw new Error("transient"); } },
    { trust: async () => { throw new Error("transient"); } },
    { trust: () => null },
    { trust: () => "local_proof_only" },
    { trust: () => ({ label: "local_proof_only", capability: "same_secret" }) },                                              // missing booleans
    { trust: () => ({ label: "anchored_fresh", capability: "same_secret", releaseGrade: true, globallyLatest: false }) },      // inconsistent
    { trust: () => ({ label: "anchored_fresh", capability: "asymmetric_verifier", releaseGrade: true, globallyLatest: true }) },
    { trust: () => ({ label: "local_proof_only", capability: "asymmetric_verifier", releaseGrade: false, globallyLatest: false }) },
    { trust: () => ({ label: "weird", capability: "unknown", releaseGrade: false, globallyLatest: false }) },
    { trust: "anchored_fresh" },
    {},
  ];
  for (const rp of broken) {
    const pub = await publishIndexBackup({ adapter: remote.backupStore(backupScope), storage, chainId: CHAIN, rootCredential: user.root, requestPrf: user.requestPrf, anchor: remote.anchor, anchorScope: backupScope, makeProof: legacyMakeProof, releaseProof: rp });
    assert.equal(pub.published, true);
    assert.equal(pub.anchor.advanced, false);
    assert.equal(pub.anchor.reason, "release_proof_unavailable", JSON.stringify(rp));
  }
  assert.equal(legacyCalls, 0);
  assert.equal(await remote.anchor.get(backupScope), null);
  // explicit SAME_SECRET answer still takes the legacy path (P5 contract)
  const ok = await publish(remote, user, storage, { releaseProof: hook(DESC.sameSecret) });
  assert.deepEqual(ok.anchor, { advanced: true, reason: null, capability: "same_secret" });
});

await check("P8. [review F3] throwing getters on the hook or its answer never throw out of restore/publish; a stored blob reports published:true", async () => {
  const boom = () => { throw new Error("getter"); };
  const sig = await hook(DESC.asymmetric, { sign: true });
  const hooks = [
    Object.defineProperty({}, "trust", { get: boom, enumerable: true }),
    { trust: () => Object.defineProperty({ capability: "asymmetric_verifier", releaseGrade: true, globallyLatest: false }, "label", { get: boom, enumerable: true }) },
    { trust: () => Object.defineProperty({ label: "anchored_fresh", releaseGrade: true, globallyLatest: false }, "capability", { get: boom, enumerable: true }) },
    Object.defineProperty({ trust: sig.trust }, "makeProof", { get: boom, enumerable: true }),
    Object.defineProperty({ trust: sig.trust, makeProof: sig.makeProof }, "verifyProof", { get: boom, enumerable: true }),
    new Proxy({}, { get: boom, has: boom, ownKeys: boom, getOwnPropertyDescriptor: boom }),
  ];
  // restore: never throws, never anchored_fresh from a broken hook
  const { remote, user } = await hmacWorld();
  for (const [i, rp] of hooks.entries()) {
    const out = await recover(remote, user, { releaseProof: rp });
    assert.equal(out.status, "ok", `restore hook ${i}`);
    assert.equal(out.completeness, "local_proof_only", `restore hook ${i}`);
  }
  // publish: blob put + baseline happen first; result must still be published:true, anchor not advanced
  for (const [i, rp] of hooks.entries()) {
    const r = await asymRemote();
    const pub = await publish(r.remote, r.user, r.storage, { releaseProof: rp });
    assert.equal(pub.published, true, `publish hook ${i}`);
    assert.equal(pub.anchor.advanced, false, `publish hook ${i}`);
    assert.equal(pub.anchor.reason, "release_proof_unavailable", `publish hook ${i}`);
    assert.ok(r.remote._adminGetBackup(pub.backupScope, KEY), `blob stored ${i}`);
    assert.equal(await r.remote.anchor.get(pub.backupScope), null);
  }
});

await check("P6. memory anchor: object proofs only with an injected verifier; default anchor keeps 64-hex-only rule", async () => {
  const plain = createMemoryGateBAdapter();
  const good = await hook(DESC.asymmetric, { sign: true }).makeProof({ scope: "5".repeat(64), prevVersion: 0, nextVersion: 1, envelopeDigest: "6".repeat(64) });
  await assert.rejects(() => plain.anchor.advance("5".repeat(64), 0, 1, "6".repeat(64), good), /anchor_write_unauthorized/);
  const strict = createMemoryGateBAdapter({ verifyAnchorProof: asymAnchorVerify() });
  await assert.rejects(() => strict.anchor.advance("5".repeat(64), 0, 1, "6".repeat(64), { ...good, credentialId: "x" }), /anchor_write_unauthorized/);
  assert.deepEqual(await strict.anchor.advance("5".repeat(64), 0, 1, "6".repeat(64), good), { recordVersion: 1, envelopeDigest: "6".repeat(64) });
  await assert.rejects(() => strict.anchor.advance("5".repeat(64), 1, 2, "7".repeat(64), good), /anchor_write_unauthorized/);   // replayed challenge / other tuple
});

// ════════════════════════════════════ static boundary ════════════════════════════════════════════════
await check("S1. runtime files: no network, no provider, A-871 module not imported (stays isolated), INDEX_BACKUP_ADAPTER = null", () => {
  for (const f of ["index-backup.js", "gate-b-recovery.js"]) {
    const src = readFileSync(new URL(f, SRC), "utf8");
    assert.equal(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|https?:\/\//.test(src), false, f);
    assert.equal(src.includes("gate-b-remote-proof"), false, f);
  }
  const main = readFileSync(new URL("main.js", SRC), "utf8");
  assert.match(main, /^const INDEX_BACKUP_ADAPTER = null;$/m);
  assert.equal(seen.includes("complete"), false);
});

console.log(`\n${pass}/${pass} PASS`);
