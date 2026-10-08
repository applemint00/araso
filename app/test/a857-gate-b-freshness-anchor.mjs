// [A-857] Gate B freshness anchor — provider-neutral contract (anchor.get / anchor.advance), pre-admission
// freshness check, anchored_fresh / anchor_rollback / ahead_of_anchor / unreachable states, CAS + write-proof
// boundary. LOCAL ONLY: memory adapter, deterministic fake WebAuthn, network 0, vendor 0.
//   node app/test/a857-gate-b-freshness-anchor.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { authRequestForPiggy, bindSigner, bytesToHex, modelASalt, modelASaltHex, sha256Sync } from "../src/piggy-session.js";
import { admitModelAPiggy, admitSequencedPiggy, loadMyPiggiesIndex, myPiggiesIndexKey, myPiggiesLockName, registerControlledPiggy, markBornPiggyIssuance } from "../src/piggy-index.js";
import { backupBaselineKey, buildBackupPayload, indexBackupSalt, publishIndexBackup, readBackupBaseline, restoreFromBackup, sealBackup } from "../src/index-backup.js";
import { ANCHOR_MAX_VERSION, computeEnvelopeDigest, hasGateBAnchor, makeAnchorWriteProof, normalizeAnchorRecord } from "../src/index-backup.js";
import {
  DISCOVERY_RECORD_FIELDS,
  GATE_B_LOCATOR_NAMESPACE,
  createMemoryGateBAdapter,
  deriveGateBLocator,
  discoverGateBRoot,
  gateBLocatorPrfSalt,
  isGateBRemoteAdapter,
  normalizeDiscoveryRecord,
  recoverProductList,
} from "../src/gate-b-recovery.js";
import { createMemoryStorage } from "../src/second-journey-state.js";

const SRC_DIR = new URL("../src/", import.meta.url);
const MAIN = readFileSync(new URL("main.js", SRC_DIR), "utf8");
const CHAIN = "monad-testnet";
const AT = "2026-09-25T12:00:00.000Z";
const RP = "araso-harness.local.test";

// ── fake users: one credential each, PRF = HMAC(secret, salt), lives only for this run ─────────────────
function makeUser(label) {
  const idBytes = new Uint8Array(Buffer.from(`${label}-root`));
  const id = Buffer.from(idBytes).toString("base64url");
  const secret = crypto.randomBytes(32);
  let asked = 0;
  const salts = [];
  const client = {
    async createCredential() { throw new Error("createCredential must never be called in Gate B recovery"); },
    async getCredential(req) {
      asked += 1;
      salts.push(Buffer.from(req.prfSalt).toString("hex"));
      return { credentialId: idBytes, prfOutput: new Uint8Array(crypto.createHmac("sha256", secret).update(Buffer.from(req.prfSalt)).digest()) };
    },
  };
  const requestPrf = (credential, prfSalt) => getPasskeyPrfOutput({ rpId: RP, ...(credential ? { credential } : {}), prfSalt, webAuthnClient: client });
  return { label, idBytes, id, root: { credentialId: id }, requestPrf, stats: () => ({ asked, salts: [...salts] }) };
}
const noPasskey = async () => { throw new Error("NotAllowedError: no credential on this device"); };
const addressOf = (prf) => getEvmAddress(createSecp256k1SigningSession({ privateKey: prf }).publicKey);

function fifoLocks() {
  const tails = new Map();
  return {
    names: [],
    request(name, _opts, fn) {
      this.names.push(name);
      const prev = tails.get(name) || Promise.resolve();
      const run = prev.then(() => fn());
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

async function originDevice(user, n) {
  const s = createMemoryStorage();
  const locks = fifoLocks();
  const addresses = {};
  // [A-695 SEQ-5=A] 원 기기 = 첫 Piggy(레거시) 행이 이 사용자의 루트로 색인된 기기.
  const firstAddress = "0x" + crypto.createHash("sha256").update(`first/${user.id}`).digest("hex").slice(0, 40);   // 통계(asked)를 건드리지 않는 고정 주소
  assert.equal(registerControlledPiggy(s, CHAIN, { address: firstAddress, signerAddress: firstAddress, locator: { credentialId: user.id }, at: AT }).ok, true);
  assert.equal(markBornPiggyIssuance(s, CHAIN, { address: firstAddress }).ok, true);
  for (let i = 1; i <= n; i += 1) {
    const out = await admitModelAPiggy({ storage: s, chainId: CHAIN, locks, rootCredential: user.root, requestPrf: user.requestPrf, deriveAddress: addressOf, now: () => AT });
    assert.equal(out.ok, true, out.reason);
    addresses[i] = out.piggy.address;
  }
  return { storage: s, addresses };
}

// Full publish through the actual modules: locator (unpinned ceremony) → publishIndexBackup into the
// scope → announce the sealed recordVersion to discovery. Cadence is OWNER_GATE — this is test wiring only.
async function publishToRemote(remote, user, storage, extra = {}) {
  const lp = await user.requestPrf(user.root, await gateBLocatorPrfSalt());
  const { discoveryKey, backupScope } = await deriveGateBLocator(lp.prfOutput);
  const out = await publishIndexBackup({ adapter: remote.backupStore(backupScope), storage, chainId: CHAIN, rootCredential: user.root, requestPrf: user.requestPrf, anchor: remote.anchor, anchorScope: backupScope, ...extra });
  if (out.published) await remote.announce(discoveryKey, { recordVersion: out.recordVersion });
  return { ...out, discoveryKey, backupScope };
}

// Fresh-device recovery exactly as RECOVERY_PROTOCOL orders it: discover (unpinned) → pinned root control
// proof (stand-in for main.js recoverPiggy: requestPrf pinned to the candidate) → only then product list.
async function freshRecover(remote, user, { storage = createMemoryStorage(), discovery = undefined, pinnedRoot = null } = {}) {
  const found = discovery === undefined ? await discoverGateBRoot({ adapter: remote, requestPrf: user.requestPrf }) : discovery;
  if (found.status !== "member") return { found, out: null, storage };
  const root = pinnedRoot ?? { credentialId: found.candidateCredentialId };
  const proof = await user.requestPrf(root, undefined).catch(() => null);          // pinned root control proof first
  if (!proof || proof.credentialId !== root.credentialId) return { found, out: { status: "refused", reason: "root_proof_failed" }, storage };
  const out = await recoverProductList({
    adapter: remote.backupStore(found.backupScope), anchor: remote.anchor, anchorScope: found.backupScope,
    storage, chainId: CHAIN, rootCredential: root, requestPrf: user.requestPrf, deriveAddress: addressOf, locks: fifoLocks(), now: () => AT,
    discovery: found,
  });
  return { found, out, storage };
}

let pass = 0;
const completenessSeen = [];
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }
const seq = (storage) => loadMyPiggiesIndex(storage, CHAIN).index.piggies.filter((p) => p.sequence).map((p) => p.sequence).sort((a, b) => a - b);
const KEY = myPiggiesIndexKey(CHAIN);

async function world({ verifyAnchorProof = null } = {}) {
  const remote = createMemoryGateBAdapter({ verifyAnchorProof });
  const alice = makeUser("alice");
  const origin = await originDevice(alice, 3);
  const v1 = await publishToRemote(remote, alice, origin.storage);                       // rv=1, through 3
  assert.equal(v1.recordVersion, 1);
  assert.deepEqual(v1.anchor, { advanced: true, reason: null });
  const oldEnvelope = remote._adminGetBackup(v1.backupScope, KEY);
  const oldAnchor = await remote.anchor.get(v1.backupScope);
  await admitModelAPiggy({ storage: origin.storage, chainId: CHAIN, locks: fifoLocks(), rootCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, now: () => AT });
  const v2 = await publishToRemote(remote, alice, origin.storage);                       // rv=2, through 4
  assert.equal(v2.recordVersion, 2);
  return { remote, alice, origin, v1, v2, oldEnvelope, oldAnchor };
}
const noSaltsFor = (alice, before) => {
  const used = alice.stats().salts.slice(before);
  for (let n = 1; n <= 4; n += 1) assert.equal(used.includes(modelASaltHex(n)), false, `no candidate auth for n=${n}`);
};

await check("A0. interface helpers: hasGateBAnchor, strict normalizeAnchorRecord, digest shape, memory adapter exposes anchor", async () => {
  const remote = createMemoryGateBAdapter();
  assert.equal(hasGateBAnchor(remote.anchor), true);
  assert.equal(hasGateBAnchor({ get() {} }), false);
  assert.equal(isGateBRemoteAdapter({ lookup() {}, backupStore() {} }), true);              // anchor stays optional
  const d = "a".repeat(64);
  assert.deepEqual(normalizeAnchorRecord({ recordVersion: 1, envelopeDigest: d }), { recordVersion: 1, envelopeDigest: d });
  for (const bad of [null, [], {}, { recordVersion: 1 }, { recordVersion: 0, envelopeDigest: d }, { recordVersion: 1.5, envelopeDigest: d },
    { recordVersion: ANCHOR_MAX_VERSION + 1, envelopeDigest: d }, { recordVersion: 1, envelopeDigest: "A".repeat(64) }, { recordVersion: 1, envelopeDigest: "ab" },
    { recordVersion: 1, envelopeDigest: d, extra: "0x" + "1".repeat(40) }]) assert.equal(normalizeAnchorRecord(bad), null);
  const env = { version: 1, nonce: "abc", ciphertext: "def" };
  const dig = await computeEnvelopeDigest(env);
  assert.equal(dig, crypto.createHash("sha256").update("1|abc|def").digest("hex"));
  assert.equal(await computeEnvelopeDigest({ version: 2 }), null);
});

await check("A1. honest publish → fresh device: anchored_fresh, state reported, never 'complete'", async () => {
  const { remote, alice, origin, v2 } = await world();
  const { out, storage } = await freshRecover(remote, alice);
  assert.equal(out.status, "ok");
  assert.deepEqual(seq(storage), [1, 2, 3, 4]);
  assert.equal(out.completeness, "local_proof_only");   // pre-A-876 baseline: "anchored_fresh" (A-857 HMAC anchor = SAME_SECRET, A-871)
  assert.equal(out.freshnessAnchor.state, "local_proof_only");   // pre-A-876 baseline: "anchored_fresh" (A-857 HMAC anchor = SAME_SECRET, A-871)
  assert.equal(out.freshnessAnchor.anchorVersion, 2);
  assert.equal(out.freshnessAnchor.sealedVersion, 2);
  assert.equal(out.recordVersion, 2);
  completenessSeen.push(out.completeness);
  assert.deepEqual((await remote.anchor.get(v2.backupScope)).recordVersion, 2);
  void origin;
});

await check("A2. I3c replay (older authentic blob + matching older discovery) with anchor → anchor_rollback, ZERO candidate auth, nothing admitted, baseline untouched", async () => {
  const { remote, alice, v1, v2, oldEnvelope } = await world();
  remote._adminSetBackup(v2.backupScope, KEY, oldEnvelope);
  remote._adminSetDiscovery(v1.discoveryKey, { schemaVersion: 1, opaqueRecoveryId: v1.discoveryKey, rootLocatorRef: "ref_00000001", recordVersion: 1 });
  const before = alice.stats().salts.length;
  const { out, storage } = await freshRecover(remote, alice);
  assert.equal(out.status, "refused");
  assert.equal(out.reason, "anchor_rollback");
  assert.equal(out.freshnessAnchor.state, "anchor_rollback");
  assert.deepEqual(out.restored, []);
  assert.deepEqual(seq(storage), []);
  assert.equal(readBackupBaseline(storage, CHAIN), null);
  noSaltsFor(alice, before);
});

await check("A3. same version, tampered/other bytes → anchor_digest_mismatch, zero candidate auth", async () => {
  const { remote, alice, v2 } = await world();
  const env = remote._adminGetBackup(v2.backupScope, KEY);
  const flipped = { ...env, ciphertext: env.ciphertext.slice(0, -2) + (env.ciphertext.endsWith("AA") ? "BB" : "AA") };
  remote._adminSetBackup(v2.backupScope, KEY, flipped);
  const before = alice.stats().salts.length;
  const { out } = await freshRecover(remote, alice);
  assert.equal(out.status, "refused");
  assert.ok(["decrypt_failed", "anchor_digest_mismatch"].includes(out.reason));            // AEAD may reject first; both fail closed
  noSaltsFor(alice, before);
  // authentic re-seal at the same version but different nonce: opens fine, digest differs
  const { remote: r2, alice: a2, v2: p2, origin: o2 } = await world();
  const lp = await a2.requestPrf(a2.root, await indexBackupSalt());
  const { index } = loadMyPiggiesIndex(o2.storage, CHAIN);
  const other = await sealBackup(buildBackupPayload(index, { recordVersion: 2 }), lp.prfOutput);
  r2._adminSetBackup(p2.backupScope, KEY, other);
  const b2 = a2.stats().salts.length;
  const res = await freshRecover(r2, a2);
  assert.equal(res.out.reason, "anchor_digest_mismatch");
  assert.equal(res.out.freshnessAnchor.state, "anchor_digest_mismatch");
  noSaltsFor(a2, b2);
});

await check("A4. anchor lags the blob (publish window) → ahead_of_anchor, unverified_fresh, restore proceeds", async () => {
  const { remote, alice, v2, oldAnchor } = await world();
  remote._adminSetAnchor(v2.backupScope, oldAnchor);                                       // anchor still says rv=1
  const { out, storage } = await freshRecover(remote, alice);
  assert.equal(out.status, "ok");
  assert.deepEqual(seq(storage), [1, 2, 3, 4]);
  assert.equal(out.completeness, "unverified_fresh");
  assert.equal(out.freshnessAnchor.state, "ahead_of_anchor");
  assert.equal(out.freshnessAnchor.anchorVersion, 1);
  completenessSeen.push(out.completeness);
});

await check("A4b. never-anchored scope (anchor null) → ahead_of_anchor, not proof", async () => {
  const { remote, alice, v2 } = await world();
  remote._adminSetAnchor(v2.backupScope, null);
  const { out } = await freshRecover(remote, alice);
  assert.equal(out.completeness, "unverified_fresh");
  assert.equal(out.freshnessAnchor.state, "ahead_of_anchor");
  assert.equal(out.freshnessAnchor.anchorVersion, 0);
});

await check("A5. anchor unreachable → unverified_fresh (never complete), restore still works", async () => {
  const { remote, alice } = await world();
  remote.setAnchorOutage(true);
  const { out, storage } = await freshRecover(remote, alice);
  assert.equal(out.status, "ok");
  assert.deepEqual(seq(storage), [1, 2, 3, 4]);
  assert.equal(out.completeness, "unverified_fresh");
  assert.equal(out.freshnessAnchor.state, "unreachable");
  completenessSeen.push(out.completeness);
});

await check("A6. malformed / absurd anchor responses are never evidence: treated as unreachable", async () => {
  const { remote, alice, v2 } = await world();
  const d = "b".repeat(64);
  for (const bad of [{ recordVersion: 99, envelopeDigest: "zz" }, { recordVersion: ANCHOR_MAX_VERSION + 1, envelopeDigest: d }, { recordVersion: 1, envelopeDigest: d, addr: "0x" + "2".repeat(40) }, { recordVersion: -1, envelopeDigest: d }]) {
    remote._adminSetAnchor(v2.backupScope, bad);
    const { out } = await freshRecover(remote, alice);
    assert.equal(out.status, "ok");
    assert.equal(out.freshnessAnchor.state, "unreachable");
    assert.equal(out.completeness, "unverified_fresh");
  }
  // anchor object that is not an adapter anchor at all
  const found = await discoverGateBRoot({ adapter: remote, requestPrf: alice.requestPrf });
  const out = await recoverProductList({ adapter: remote.backupStore(found.backupScope), anchor: { get: async () => ({}) }, anchorScope: found.backupScope, storage: createMemoryStorage(), chainId: CHAIN, rootCredential: { credentialId: found.candidateCredentialId }, requestPrf: alice.requestPrf, deriveAddress: addressOf, locks: fifoLocks(), now: () => AT, discovery: found });
  assert.equal(out.freshnessAnchor.state, "unreachable");
});

await check("A7. malicious anchor alone can only REFUSE (availability), never upgrade a bad state to complete", async () => {
  const { remote, alice, v2 } = await world();
  remote._adminSetAnchor(v2.backupScope, { recordVersion: 500, envelopeDigest: "c".repeat(64) });   // claims a far newer version
  const before = alice.stats().salts.length;
  const { out, storage } = await freshRecover(remote, alice);
  assert.equal(out.status, "refused");
  assert.equal(out.reason, "anchor_rollback");
  assert.deepEqual(seq(storage), []);
  noSaltsFor(alice, before);
  // forged equal-version anchor with wrong digest cannot make the blob pass either
  remote._adminSetAnchor(v2.backupScope, { recordVersion: 2, envelopeDigest: "d".repeat(64) });
  assert.equal((await freshRecover(remote, alice)).out.reason, "anchor_digest_mismatch");
  // anchor cannot rescue what the local core refuses (chain / discovery checks run regardless)
  const { remote: r2, alice: a2, v1: w1, v2: w2, oldEnvelope } = await world();
  r2._adminSetBackup(w2.backupScope, KEY, oldEnvelope);                                    // blob store rolled back, discovery honest
  r2._adminSetAnchor(w2.backupScope, { recordVersion: 1, envelopeDigest: await computeEnvelopeDigest(oldEnvelope) });   // colluding anchor says rv=1 matches
  const res = await freshRecover(r2, a2);
  assert.equal(res.out.reason, "record_version_mismatch");
  void w1;
});

await check("A8. wiped local baseline + anchor: anchored_fresh; same scenario without anchor: unverified_fresh", async () => {
  const { remote, alice, v2 } = await world();
  const wiped = createMemoryStorage();                                                      // device lost its baseline
  const { out } = await freshRecover(remote, alice, { storage: wiped });
  assert.equal(out.completeness, "local_proof_only");   // pre-A-876 baseline: "anchored_fresh" (A-857 HMAC anchor = SAME_SECRET, A-871)
  // no anchor injected → byte-identical legacy behavior
  const found = await discoverGateBRoot({ adapter: remote, requestPrf: alice.requestPrf });
  const legacy = await recoverProductList({ adapter: remote.backupStore(found.backupScope), storage: createMemoryStorage(), chainId: CHAIN, rootCredential: { credentialId: found.candidateCredentialId }, requestPrf: alice.requestPrf, deriveAddress: addressOf, locks: fifoLocks(), now: () => AT, discovery: found });
  assert.equal(legacy.completeness, "unverified_fresh");
  assert.equal(legacy.freshnessAnchor, null);
  void v2;
});

await check("A9. anchored match never hides unproven candidates: a skipped sequence stays 'incomplete'", async () => {
  const { remote, alice, v2 } = await world();
  const { storage: s0 } = await freshRecover(remote, alice);
  void s0;
  // fresh device where the 2nd sequence fails authentication
  const found = await discoverGateBRoot({ adapter: remote, requestPrf: alice.requestPrf });
  let calls = 0;
  const flaky = async (cred, salt) => {
    if (salt && Buffer.from(salt).toString("hex") === modelASaltHex(2)) { calls += 1; throw new Error("NotAllowedError"); }
    return alice.requestPrf(cred, salt);
  };
  const out = await recoverProductList({ adapter: remote.backupStore(found.backupScope), anchor: remote.anchor, anchorScope: found.backupScope, storage: createMemoryStorage(), chainId: CHAIN, rootCredential: { credentialId: found.candidateCredentialId }, requestPrf: flaky, deriveAddress: addressOf, locks: fifoLocks(), now: () => AT, discovery: found });
  assert.ok(calls >= 1);
  assert.equal(out.completeness, "incomplete");
  assert.equal(out.freshnessAnchor.state, "local_proof_only");   // pre-A-876 baseline: "anchored_fresh" (A-857 HMAC anchor = SAME_SECRET, A-871)
  void v2;
});

await check("A10. publish order: put failure leaves anchor untouched; advance failure keeps published:true and next publish heals idempotently", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const origin = await originDevice(alice, 2);
  const lp = await alice.requestPrf(alice.root, await gateBLocatorPrfSalt());
  const { backupScope } = await deriveGateBLocator(lp.prfOutput);
  // put fails
  const failing = { get: async () => null, put: async () => { throw new Error("down"); } };
  const r0 = await publishIndexBackup({ adapter: failing, storage: origin.storage, chainId: CHAIN, rootCredential: alice.root, requestPrf: alice.requestPrf, anchor: remote.anchor, anchorScope: backupScope });
  assert.deepEqual(r0, { published: false, reason: "adapter_put_failed" });
  assert.equal(await remote.anchor.get(backupScope), null);
  // advance fails (anchor outage) after the blob is live
  remote.setAnchorOutage(true);
  const r1 = await publishToRemote(remote, alice, origin.storage);
  assert.equal(r1.published, true);
  assert.deepEqual(r1.anchor, { advanced: false, reason: "anchor_unreachable" });
  remote.setAnchorOutage(false);
  assert.equal(await remote.anchor.get(r1.backupScope), null);
  // anchor behind the blob is safe: restore reports ahead_of_anchor, not rollback
  const mid = await freshRecover(remote, alice);
  assert.equal(mid.out.freshnessAnchor.state, "ahead_of_anchor");
  // next publish heals
  const r2 = await publishToRemote(remote, alice, origin.storage);
  assert.equal(r2.published, true);
  assert.deepEqual(r2.anchor, { advanced: true, reason: null });
  assert.equal((await remote.anchor.get(r2.backupScope)).recordVersion, r2.recordVersion);
  // advance failure never flips published to false and never raises the anchor past the blob
  const post = await freshRecover(remote, alice);
  assert.equal(post.out.completeness, "local_proof_only");   // pre-A-876 baseline: "anchored_fresh" (A-857 HMAC anchor = SAME_SECRET, A-871)
});

await check("A11. CAS: stale prevVersion, replayed advance with other digest, downgrade → rejected; same (next,digest) is idempotent", async () => {
  const remote = createMemoryGateBAdapter();
  const scope = "e".repeat(64);
  const proof = "f".repeat(64);
  const d1 = "1".repeat(64), d2 = "2".repeat(64), d3 = "3".repeat(64);
  await remote.anchor.advance(scope, 0, 1, d1, proof);
  await remote.anchor.advance(scope, 1, 2, d2, proof);
  await assert.rejects(() => remote.anchor.advance(scope, 1, 3, d3, proof), /anchor_cas_conflict/);       // stale prev
  await assert.rejects(() => remote.anchor.advance(scope, 0, 1, d3, proof), /anchor_cas_conflict/);       // replay v1 with other digest
  await assert.rejects(() => remote.anchor.advance(scope, 2, 2, d3, proof), /anchor_downgrade/);          // no progress
  await assert.rejects(() => remote.anchor.advance(scope, 2, 1, d3, proof), /anchor_downgrade/);
  assert.deepEqual(await remote.anchor.advance(scope, 1, 2, d2, proof), { recordVersion: 2, envelopeDigest: d2 });   // idempotent
  assert.deepEqual(await remote.anchor.get(scope), { recordVersion: 2, envelopeDigest: d2 });
  await assert.rejects(() => remote.anchor.advance("bad", 0, 1, d1, proof), /bad_scope/);
  await assert.rejects(() => remote.anchor.advance(scope, 2, 3, "nothex", proof), /bad_digest/);
});

await check("A12. write proof: missing / malformed / wrong-key / other-tuple proofs rejected; the real HMAC proof verifies", async () => {
  const alice = makeUser("alice");
  const lp = await alice.requestPrf(alice.root, await indexBackupSalt());
  const macKey = Buffer.from(crypto.hkdfSync("sha256", lp.prfOutput, Buffer.alloc(0), Buffer.from("araso.gateb.v1.anchor.write"), 32));
  const verify = (t, p) => p === crypto.createHmac("sha256", macKey).update(`${t.scope}|${t.prevVersion}|${t.nextVersion}|${t.envelopeDigest}`).digest("hex");
  const remote = createMemoryGateBAdapter({ verifyAnchorProof: verify });
  const scope = "9".repeat(64), d = "8".repeat(64);
  for (const bad of [undefined, null, "", "zz", "0".repeat(64), 12345]) await assert.rejects(() => remote.anchor.advance(scope, 0, 1, d, bad), /anchor_write_unauthorized/);
  const good = await makeAnchorWriteProof({ prfOutput: lp.prfOutput, scope, prevVersion: 0, nextVersion: 1, envelopeDigest: d });
  assert.match(good, /^[0-9a-f]{64}$/);
  await assert.rejects(() => remote.anchor.advance(scope, 0, 1, "7".repeat(64), good), /anchor_write_unauthorized/);   // proof bound to the tuple
  await assert.rejects(() => remote.anchor.advance(scope, 0, 2, d, good), /anchor_write_unauthorized/);
  const other = makeUser("mallory");
  const lpM = await other.requestPrf(other.root, await indexBackupSalt());
  const forged = await makeAnchorWriteProof({ prfOutput: lpM.prfOutput, scope, prevVersion: 0, nextVersion: 1, envelopeDigest: d });
  await assert.rejects(() => remote.anchor.advance(scope, 0, 1, d, forged), /anchor_write_unauthorized/);   // other user's key
  assert.equal(await remote.anchor.get(scope), null);                                       // nothing written by any rejected attempt
  await remote.anchor.advance(scope, 0, 1, d, good);
  assert.equal((await remote.anchor.get(scope)).recordVersion, 1);
  // end-to-end: publishIndexBackup's default proof is accepted by the verifier; an unauthorized anchor reports, never un-publishes
  const origin = await originDevice(alice, 2);
  const r2 = createMemoryGateBAdapter({ verifyAnchorProof: verify });
  const pub = await publishToRemote(r2, alice, origin.storage);
  assert.equal(pub.published, true);
  assert.deepEqual(pub.anchor, { advanced: true, reason: null });
  const r3 = createMemoryGateBAdapter({ verifyAnchorProof: verify });
  const pub3 = await publishToRemote(r3, alice, origin.storage, { makeProof: async () => "0".repeat(64) });
  assert.equal(pub3.published, true);
  assert.deepEqual(pub3.anchor, { advanced: false, reason: "anchor_write_unauthorized" });
});

await check("A13. F1: wiped baseline + blob withheld + anchor ahead → publish REFUSED before put (anchor_unseen_state); nothing written, anchor unchanged", async () => {
  const { remote, alice, origin, v2 } = await world();
  remote._adminSetBackup(v2.backupScope, KEY, null);                                       // server withholds the blob; anchor says rv=2
  const clone = createMemoryStorage();
  clone.setItem(KEY, origin.storage.getItem(KEY));
  assert.equal(readBackupBaseline(clone, CHAIN), null);
  const r = await publishToRemote(remote, alice, clone);
  assert.deepEqual({ published: r.published, reason: r.reason }, { published: false, reason: "anchor_unseen_state" });
  assert.equal(remote._adminGetBackup(v2.backupScope, KEY), null);                         // no put happened
  assert.equal((await remote.anchor.get(v2.backupScope)).recordVersion, 2);
  // device that HAS seen the version (baseline or opened blob) is not blocked
  const ok = await publishToRemote(remote, alice, origin.storage);
  assert.equal(ok.published, true);
  assert.equal(ok.recordVersion, 3);
});

await check("A13b. F1 probe regression: withheld blob + small-index device can never turn a regressed blob into anchored_fresh", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const origin = await originDevice(alice, 3);
  const v1 = await publishToRemote(remote, alice, origin.storage);
  await admitModelAPiggy({ storage: origin.storage, chainId: CHAIN, locks: fifoLocks(), rootCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, now: () => AT });
  await publishToRemote(remote, alice, origin.storage);                                    // rv=2, through 4; anchor rv=2
  remote._adminSetBackup(v1.backupScope, KEY, null);                                       // blob withheld
  const small = await originDevice(alice, 1);                                              // smaller index, no baseline
  const pub = await publishToRemote(remote, alice, small.storage);
  assert.equal(pub.published, false);
  assert.equal(pub.reason, "anchor_unseen_state");
  const { out } = await freshRecover(remote, alice);                                       // blob still missing
  assert.notEqual(out?.completeness, "anchored_fresh");
  assert.equal(out.status, "refused");
});

await check("A14. server-visible anchor shape: scope(64-hex) + recordVersion + digest only — no credentialId / address / PRF", async () => {
  const { remote, alice } = await world();
  const dump = remote._dump();
  assert.ok(dump.anchors.length === 1);
  for (const a of dump.anchors) {
    assert.deepEqual(Object.keys(a).sort(), ["envelopeDigest", "recordVersion", "scope"]);
    assert.match(a.scope, /^[0-9a-f]{64}$/);
    assert.match(a.envelopeDigest, /^[0-9a-f]{64}$/);
  }
  const blob = JSON.stringify(dump.anchors);
  assert.equal(blob.includes(alice.id), false);
  assert.equal(blob.includes(Buffer.from(alice.idBytes).toString("hex")), false);
  assert.equal(/0x[0-9a-fA-F]{40}/.test(blob), false);
  assert.equal(blob.includes(modelASaltHex(1)), false);
});

await check("A15. static: main.js untouched by this card (INDEX_BACKUP_ADAPTER null, no anchor wiring) and no 'complete' completeness literal in sources", () => {
  assert.match(MAIN, /const INDEX_BACKUP_ADAPTER = null;/);
  assert.equal(/anchor\.(get|advance)|computeEnvelopeDigest|makeAnchorWriteProof/.test(MAIN), false);
  for (const f of ["index-backup.js", "gate-b-recovery.js"]) {
    const src = readFileSync(new URL(f, SRC_DIR), "utf8");
    assert.equal(/completeness\s*[:=]\s*["']complete["']/.test(src), false, f);
    assert.equal(/["']complete["']\s*:/.test(src), false, f);
  }
  assert.equal(completenessSeen.includes("complete"), false);
});

console.log(`\n${pass}/${pass} PASS`);
