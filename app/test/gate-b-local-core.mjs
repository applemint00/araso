// [A-579 Lane B] Gate B v1 local core — A-572 findings implemented + A-572 attack-matrix equivalents re-run
// against the ACTUAL app modules (piggy-session / piggy-index / index-backup / gate-b-recovery) and the real
// Mera SDK. Network 0 · real Face ID 0 · remote provider 0 · deterministic fake WebAuthn (PRF = HMAC(secret, salt)).
//   node app/test/gate-b-local-core.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { authRequestForPiggy, bindSigner, bytesToHex, modelASalt, modelASaltHex, sha256Sync } from "../src/piggy-session.js";
import { admitModelAPiggy, admitSequencedPiggy, loadMyPiggiesIndex, myPiggiesIndexKey, myPiggiesLockName, registerControlledPiggy, markBornPiggyIssuance } from "../src/piggy-index.js";
import { backupBaselineKey, buildBackupPayload, indexBackupSalt, publishIndexBackup, readBackupBaseline, restoreFromBackup, sealBackup } from "../src/index-backup.js";
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
async function publishToRemote(remote, user, storage) {
  const lp = await user.requestPrf(user.root, await gateBLocatorPrfSalt());
  const { discoveryKey, backupScope } = await deriveGateBLocator(lp.prfOutput);
  const out = await publishIndexBackup({ adapter: remote.backupStore(backupScope), storage, chainId: CHAIN, rootCredential: user.root, requestPrf: user.requestPrf });
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
    adapter: remote.backupStore(found.backupScope),
    storage, chainId: CHAIN, rootCredential: root, requestPrf: user.requestPrf, deriveAddress: addressOf, locks: fifoLocks(), now: () => AT,
    discovery: found,
  });
  return { found, out, storage };
}

let pass = 0;
const completenessSeen = [];
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }
const seq = (storage) => loadMyPiggiesIndex(storage, CHAIN).index.piggies.filter((p) => p.sequence).map((p) => p.sequence).sort((a, b) => a - b);

// ═════ ITEM 1 — one canonical locator namespace literal + deterministic vectors ═════════════════════════
await check("I1a. canonical namespace literal is exactly araso.gateb.v1.locator; PRF salt = SHA-256(literal) (frozen vector)", async () => {
  assert.equal(GATE_B_LOCATOR_NAMESPACE, "araso.gateb.v1.locator");
  const salt = Buffer.from(await gateBLocatorPrfSalt()).toString("hex");
  assert.equal(salt, "3e0ec374b0f83313eee7200ccfbdca10d786e4e302028d0a8b0bc63d5e3e3c1f");   // shasum -a 256 independent
  assert.equal(salt, crypto.createHash("sha256").update("araso.gateb.v1.locator").digest("hex"));
});

await check("I1b. HKDF locator test vector (prfOutput = 0x00..0x1f) matches node hkdfSync; two labels, one literal", async () => {
  const prf = new Uint8Array([...Array(32).keys()]);
  const got = await deriveGateBLocator(prf);
  assert.deepEqual(got, {
    discoveryKey: "7fd7bb18dfbbae57dbb0557dbead8a32e7f680864b7fa571ebd9674c8088a8d5",
    backupScope: "f27047a7a9a9dada1b738837c937c1351750be01e1de6906893de70541d220e1",
  });
  const h = (info) => Buffer.from(crypto.hkdfSync("sha256", Buffer.from(prf), Buffer.alloc(0), Buffer.from(info), 32)).toString("hex");
  assert.equal(got.discoveryKey, h("araso.gateb.v1.locator"));
  assert.equal(got.backupScope, h("araso.gateb.v1.locator/piggylist"));
  await assert.rejects(() => deriveGateBLocator(new Uint8Array(31)), /invalid_prf_output/);
});

await check("I1c. no other locator salt literal survives in app/src; locator salt ≠ modelASalt(1..64) ≠ indexBackupSalt", async () => {
  const src = readdirSync(SRC_DIR).filter((f) => f.endsWith(".js")).map((f) => [f, readFileSync(new URL(f, SRC_DIR), "utf8")]);
  for (const stale of ["araso.locator.lookup.v1", "araso.locator.index.v1", "araso.gateb.v1.root", "araso.gateb.v1.piggylist", "araso.v1.index.lookup.key"]) {
    assert.deepEqual(src.filter(([, t]) => t.includes(stale)).map(([f]) => f), [], stale);
  }
  const defining = src.filter(([, t]) => t.includes('"araso.gateb.v1.locator"')).map(([f]) => f);
  assert.deepEqual(defining, ["gate-b-recovery.js"]);                                     // defined once, one file
  const loc = Buffer.from(await gateBLocatorPrfSalt()).toString("hex");
  assert.notEqual(loc, Buffer.from(await indexBackupSalt()).toString("hex"));
  for (let n = 1; n <= 64; n += 1) assert.notEqual(loc, modelASaltHex(n));
});

// ═════ ITEM 2 — sequence ↔ modelASalt(sequence) enforced inside the registration path ═════════════════
await check("I2a. sync salt contract: modelASaltHex(n) === subtle modelASalt(n) for n=1..256; A-531 vectors; sha256Sync == node", async () => {
  for (let n = 1; n <= 256; n += 1) assert.equal(modelASaltHex(n), bytesToHex(await modelASalt(n)), `n=${n}`);
  assert.equal(modelASaltHex(1), "b94ebd79a9e716eeb1ddcc7686776d90972de949921dc7032be9f00531aa6caf");
  assert.equal(modelASaltHex(2), "a6f5cd4c67e66ea8516da7ec5bf5a27ab9e6d4c0a81513fbed1155ee5d28af1b");
  assert.equal(modelASaltHex(3), "b4270d902da396a57c8ca0f21ea3e8400b8297722c803b7fd71c78fe0e6b118b");
  for (const bad of [0, -1, 1.5, "1", null]) assert.equal(modelASaltHex(bad), null);
  for (let len = 0; len < 200; len += 7) {
    const b = crypto.randomBytes(len);
    assert.equal(Buffer.from(sha256Sync(new Uint8Array(b))).toString("hex"), crypto.createHash("sha256").update(b).digest("hex"));
  }
});

await check("I2b [C6b]. registerControlledPiggy refuses ANY caller-supplied (address, sequence) pair — even with the correct salt", async () => {
  const alice = makeUser("alice");
  const s = createMemoryStorage();
  // the A-572 C6b attack: a real, self-consistent control proof derived under an unrelated domain (index-backup salt)
  const foreign = addressOf((await alice.requestPrf(alice.root, await indexBackupSalt())).prfOutput);
  for (const prfSalt of [bytesToHex(await indexBackupSalt()), modelASaltHex(1), undefined]) {
    const out = registerControlledPiggy(s, CHAIN, { address: foreign, signerAddress: foreign, locator: { credentialId: alice.id, ...(prfSalt ? { prfSalt } : {}) }, at: AT, sequence: 1 });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "sequence_requires_model_a_path");
  }
  assert.deepEqual(seq(s), []);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 0);
});

await check("I2c. the only sequence path computes modelASalt(n) itself, authenticates with THAT salt, stores it; Gate C reopen binds", async () => {
  const alice = makeUser("alice");
  const s = createMemoryStorage();
  const before = alice.stats().asked;
  const out = await admitSequencedPiggy({ storage: s, chainId: CHAIN, sequence: 1, rootCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, now: () => AT });
  assert.equal(out.ok, true);
  const st = alice.stats();
  assert.equal(st.asked - before, 1);
  assert.equal(st.salts.at(-1), modelASaltHex(1));                                         // the salt handed to the authenticator
  assert.equal(out.piggy.locator.prfSalt, modelASaltHex(1));                               // the salt stored with the row
  assert.equal(out.piggy.address, addressOf((await alice.requestPrf(alice.root, await modelASalt(1))).prfOutput));
  // Gate C: reopening via the stored locator re-derives the same signer
  const { request } = authRequestForPiggy(out.piggy);
  const reopened = await alice.requestPrf(request.credential, request.prfSalt);
  assert.equal(bindSigner({ id: out.piggy.id, address: out.piggy.address }, addressOf(reopened.prfOutput)).ok, true);
  // n cannot skip ahead of the watermark even through the controlled path
  const skip = await admitSequencedPiggy({ storage: s, chainId: CHAIN, sequence: 3, rootCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, now: () => AT });
  assert.equal(skip.reason, "stale_sequence");
});

// ═════ ITEM 4 + 5 — adapter interface, memory adapter only, server = discovery only, no linkable keys ═══
await check("I4a. production adapter stays null; main.js wires no Gate B remote adapter, no discovery, no publish", () => {
  assert.match(MAIN, /const INDEX_BACKUP_ADAPTER = null;/);
  for (const sym of ["createMemoryGateBAdapter", "discoverGateBRoot", "publishIndexBackup", "createMemoryBackupAdapter", "deriveGateBLocator"]) assert.equal(MAIN.includes(sym), false, sym);
  assert.equal(isGateBRemoteAdapter(null), false);
  assert.equal(isGateBRemoteAdapter({ get() {}, put() {} }), false);                      // a bare blob store is not a discovery adapter
  assert.equal(isGateBRemoteAdapter(createMemoryGateBAdapter()), true);
});

await check("I4b. discovery record = exactly 4 fields; extra/missing fields, wrong key, address-like ref → refused", () => {
  const key = "a".repeat(64);
  const good = { schemaVersion: 1, opaqueRecoveryId: key, rootLocatorRef: "ref_00000001", recordVersion: 3 };
  assert.deepEqual([...DISCOVERY_RECORD_FIELDS].sort(), ["opaqueRecoveryId", "recordVersion", "rootLocatorRef", "schemaVersion"]);
  assert.equal(normalizeDiscoveryRecord(good, { expectedKey: key }).error, null);
  assert.equal(normalizeDiscoveryRecord({ ...good, addresses: ["0x" + "1".repeat(40)] }, { expectedKey: key }).error, "discovery_shape");
  assert.equal(normalizeDiscoveryRecord({ ...good, credentialId: "YWxpY2U" }, { expectedKey: key }).error, "discovery_shape");
  assert.equal(normalizeDiscoveryRecord({ ...good, sealedIndexRef: "x" }, { expectedKey: key }).error, "discovery_shape");   // C8c: no stored pointer
  assert.equal(normalizeDiscoveryRecord(good, { expectedKey: "b".repeat(64) }).error, "discovery_key_mismatch");
  assert.equal(normalizeDiscoveryRecord({ ...good, rootLocatorRef: "0x" + "ab".repeat(20) }, { expectedKey: key }).error, "discovery_shape");
  assert.equal(normalizeDiscoveryRecord({ ...good, schemaVersion: 2 }, { expectedKey: key }).error, "discovery_version");
});

await check("I4c. memory adapter refuses non-HKDF lookup keys and any backup field outside {version, nonce, ciphertext}", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  await assert.rejects(() => remote.announce(alice.id, { recordVersion: 1 }), /bad_lookup_key/);          // raw credentialId
  assert.throws(() => remote.backupStore(alice.id), /bad_scope/);
  const scope = "c".repeat(64);
  await assert.rejects(() => remote.backupStore(scope).put("k", { version: 1, nonce: "a", ciphertext: "b", addresses: ["0x" + "1".repeat(40)] }), /bad_envelope/);
});

await check("I5 [C1/C8]. two users published end-to-end: dump has no credentialId, no sha256(credentialId), no address, no PRF; root↔list unlinkable", async () => {
  const remote = createMemoryGateBAdapter();
  const users = [makeUser("alice"), makeUser("bob")];
  const leaks = [];
  const pubs = [];
  for (const u of users) {
    const origin = await originDevice(u, 2);
    pubs.push(await publishToRemote(remote, u, origin.storage));
    const idHex = Buffer.from(u.idBytes).toString("hex");
    leaks.push(u.id, idHex, crypto.createHash("sha256").update(u.id).digest("hex"), crypto.createHash("sha256").update(Buffer.from(u.idBytes)).digest("hex"));
    for (const a of Object.values(origin.addresses)) leaks.push(a.toLowerCase().slice(2));
    for (const salt of [await gateBLocatorPrfSalt(), await indexBackupSalt(), await modelASalt(1)]) leaks.push(Buffer.from((await u.requestPrf(u.root, salt)).prfOutput).toString("hex"));
  }
  const dump = remote._dump();
  const flat = JSON.stringify(dump).toLowerCase();
  for (const l of leaks) assert.equal(flat.includes(l.toLowerCase()), false, `leak ${l.slice(0, 12)}…`);
  assert.equal(/0x[0-9a-f]{40}/.test(flat), false);
  for (const row of dump.discovery) assert.deepEqual(Object.keys(row).sort(), [...DISCOVERY_RECORD_FIELDS].sort());
  for (const row of dump.backups) assert.deepEqual(Object.keys(row).sort(), ["ciphertext", "key", "nonce", "scope", "version"]);
  // C8c: no discovery row carries (or equals) any backup scope — the list table cannot be joined from the root table
  const scopes = new Set(dump.backups.map((b) => b.scope));
  for (const row of dump.discovery) for (const v of Object.values(row)) assert.equal(scopes.has(String(v)), false);
  assert.equal(new Set(pubs.map((p) => p.discoveryKey)).size, 2);
});

// ═════ happy path through the real modules ══════════════════════════════════════════════════════════════
await check("HP. fresh device: discover → pinned proof → product list; addresses re-derived live; completeness never 'complete'", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const origin = await originDevice(alice, 3);
  const pub = await publishToRemote(remote, alice, origin.storage);
  assert.equal(pub.published, true);
  assert.equal(pub.recordVersion, 1);
  const { found, out, storage } = await freshRecover(remote, alice);
  assert.equal(found.status, "member");
  assert.equal(found.candidateCredentialId, alice.id);
  assert.equal(out.status, "ok");
  assert.equal(out.source, "backup");
  assert.deepEqual(out.restored.map((r) => [r.sequence, r.address]), [[1, origin.addresses[1]], [2, origin.addresses[2]], [3, origin.addresses[3]]]);
  assert.equal(out.completeness, "unverified_fresh");                                      // honest: no freshness anchor on a new device
  assert.equal(out.freshnessAnchor, null);
  assert.equal(out.restoredThrough, 3);
  assert.deepEqual(readBackupBaseline(storage, CHAIN), { recordVersion: 1, issuedThrough: 3 });
  completenessSeen.push(out.completeness);
});

// ═════ ITEM 3 — rollback / completeness ═════════════════════════════════════════════════════════════════
await check("I3a. publish seals a monotonic recordVersion (1,2,3) and never regresses a newer remote blob", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const origin = await originDevice(alice, 1);
  assert.equal((await publishToRemote(remote, alice, origin.storage)).recordVersion, 1);
  assert.equal((await publishToRemote(remote, alice, origin.storage)).recordVersion, 2);
  await admitModelAPiggy({ storage: origin.storage, chainId: CHAIN, locks: fifoLocks(), rootCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, now: () => AT });
  const third = await publishToRemote(remote, alice, origin.storage);
  assert.equal(third.recordVersion, 3);
  // a brand-new device (empty index, no baseline) must NOT overwrite the newer remote blob with its empty list
  const blank = createMemoryStorage();
  const envBefore = JSON.stringify(remote._adminGetBackup(third.backupScope, myPiggiesIndexKey(CHAIN)));
  const regress = await publishIndexBackup({ adapter: remote.backupStore(third.backupScope), storage: blank, chainId: CHAIN, rootCredential: alice.root, requestPrf: alice.requestPrf });
  assert.deepEqual(regress, { published: false, reason: "would_regress" });
  assert.equal(JSON.stringify(remote._adminGetBackup(third.backupScope, myPiggiesIndexKey(CHAIN))), envBefore);
  // a blob this root cannot open (another root's / corrupt) is never overwritten blindly
  const bob = makeUser("bob");
  const bobPub = await publishToRemote(remote, bob, (await originDevice(bob, 1)).storage);
  const clobber = await publishIndexBackup({ adapter: remote.backupStore(bobPub.backupScope), storage: origin.storage, chainId: CHAIN, rootCredential: alice.root, requestPrf: alice.requestPrf });
  assert.deepEqual(clobber, { published: false, reason: "existing_unverifiable" });
});

async function rolledBackWorld() {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const origin = await originDevice(alice, 3);
  const v1 = await publishToRemote(remote, alice, origin.storage);                       // rv=1, issuedThrough 3
  const oldEnvelope = remote._adminGetBackup(v1.backupScope, myPiggiesIndexKey(CHAIN));
  await admitModelAPiggy({ storage: origin.storage, chainId: CHAIN, locks: fifoLocks(), rootCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, now: () => AT });
  const v2 = await publishToRemote(remote, alice, origin.storage);                       // rv=2, issuedThrough 4
  assert.equal(v2.recordVersion, 2);
  return { remote, alice, origin, v1, v2, oldEnvelope };
}

await check("I3b [C5a]. blob store rolled back but discovery honest → record_version_mismatch before ANY candidate authentication", async () => {
  const { remote, alice, v2, oldEnvelope } = await rolledBackWorld();
  remote._adminSetBackup(v2.backupScope, myPiggiesIndexKey(CHAIN), oldEnvelope);          // server replays the authentic old blob
  const before = alice.stats().salts.length;
  const { out, storage } = await freshRecover(remote, alice);
  assert.equal(out.status, "refused");
  assert.equal(out.reason, "record_version_mismatch");
  assert.deepEqual(out.restored, []);
  assert.deepEqual(seq(storage), []);
  const saltsUsed = alice.stats().salts.slice(before);
  for (let n = 1; n <= 4; n += 1) assert.equal(saltsUsed.includes(modelASaltHex(n)), false, `no candidate auth for n=${n}`);
});

await check("I3c [C5a residual]. server rolls back BOTH stores consistently → fresh device under-restores but is told 'unverified_fresh', never 'complete'", async () => {
  const { remote, alice, v1, v2, oldEnvelope } = await rolledBackWorld();
  remote._adminSetBackup(v2.backupScope, myPiggiesIndexKey(CHAIN), oldEnvelope);
  remote._adminSetDiscovery(v1.discoveryKey, { schemaVersion: 1, opaqueRecoveryId: v1.discoveryKey, rootLocatorRef: "ref_00000001", recordVersion: 1 });
  const { out, storage } = await freshRecover(remote, alice);
  assert.equal(out.status, "ok");
  assert.deepEqual(seq(storage), [1, 2, 3]);                                               // n=4 hidden — nothing forged, nothing reused
  assert.equal(out.completeness, "unverified_fresh");
  assert.equal(out.freshnessAnchor, null);
  assert.equal(out.recordVersion, 1);
  completenessSeen.push(out.completeness);
});

await check("I3d [C5b]. device with a local baseline refuses an older sealed recordVersion (stale_record_version), zero candidate auth", async () => {
  const { remote, alice, v1, v2, oldEnvelope } = await rolledBackWorld();
  const device = createMemoryStorage();
  const first = await freshRecover(remote, alice, { storage: device });                   // sees rv=2, baseline=2
  assert.equal(first.out.status, "ok");
  assert.deepEqual(readBackupBaseline(device, CHAIN), { recordVersion: 2, issuedThrough: 4 });
  remote._adminSetBackup(v2.backupScope, myPiggiesIndexKey(CHAIN), oldEnvelope);
  remote._adminSetDiscovery(v1.discoveryKey, { schemaVersion: 1, opaqueRecoveryId: v1.discoveryKey, rootLocatorRef: "ref_00000001", recordVersion: 1 });
  const before = alice.stats().salts.length;
  const again = await freshRecover(remote, alice, { storage: device });
  assert.equal(again.out.status, "refused");
  assert.equal(again.out.reason, "stale_record_version");
  assert.equal(alice.stats().salts.slice(before).some((h) => h === modelASaltHex(1)), false);
  assert.deepEqual(seq(device), [1, 2, 3, 4]);
  assert.deepEqual(readBackupBaseline(device, CHAIN), { recordVersion: 2, issuedThrough: 4 });   // baseline never lowered
});

await check("I3e. higher recordVersion but smaller issuedThrough than the local baseline → stale_issued_through", async () => {
  const alice = makeUser("alice");
  const origin = await originDevice(alice, 2);
  const device = createMemoryStorage();
  device.setItem(backupBaselineKey(CHAIN), JSON.stringify({ version: 1, chainId: CHAIN, recordVersion: 1, issuedThrough: 2 }));
  const indexPrf = (await alice.requestPrf(alice.root, await indexBackupSalt())).prfOutput;
  const shrunk = buildBackupPayload({ ...loadMyPiggiesIndex(origin.storage, CHAIN).index, issuedThrough: 1, piggies: loadMyPiggiesIndex(origin.storage, CHAIN).index.piggies.filter((p) => p.sequence === 1) }, { recordVersion: 5 });
  const out = await restoreFromBackup({ adapter: { get: async () => sealBackup(shrunk, indexPrf) }, key: myPiggiesIndexKey(CHAIN), storage: device, chainId: CHAIN, pinnedCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.equal(out.error, "stale_issued_through");
  assert.deepEqual(out.restored, []);
});

await check("I3f. discovery says a backup exists but the blob is missing / unreachable → refused, not silently 'local_only'", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const pub = await publishToRemote(remote, alice, (await originDevice(alice, 1)).storage);
  remote._adminSetBackup(pub.backupScope, myPiggiesIndexKey(CHAIN), null);
  const missing = await freshRecover(remote, alice);
  assert.equal(missing.out.status, "refused");
  assert.equal(missing.out.reason, "backup_missing");
  const found = await discoverGateBRoot({ adapter: remote, requestPrf: alice.requestPrf });
  const out = await recoverProductList({ adapter: { get: async () => { throw new Error("server_unavailable"); } }, storage: createMemoryStorage(), chainId: CHAIN, rootCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, locks: fifoLocks(), discovery: found });
  assert.equal(out.status, "refused");
  assert.equal(out.reason, "backup_unavailable");
});

await check("I3g. a blob that claims more than can be proven (gap) → completeness 'incomplete'", async () => {
  const alice = makeUser("alice");
  const origin = await originDevice(alice, 3);
  const index = loadMyPiggiesIndex(origin.storage, CHAIN).index;
  const gapped = buildBackupPayload({ ...index, piggies: index.piggies.filter((p) => p.sequence !== 2) }, { recordVersion: 1 });
  const indexPrf = (await alice.requestPrf(alice.root, await indexBackupSalt())).prfOutput;
  const out = await restoreFromBackup({ adapter: { get: async () => sealBackup(gapped, indexPrf) }, key: myPiggiesIndexKey(CHAIN), storage: createMemoryStorage(), chainId: CHAIN, pinnedCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.deepEqual(out.restored.map((r) => r.sequence), [1]);
  assert.equal(out.completeness, "incomplete");
  completenessSeen.push(out.completeness);
});

// ═════ A-572 attack-matrix equivalents against the actual modules ══════════════════════════════════════
await check("C1. full DB dump + no authenticator: nothing opens, nothing admitted, no passkey created", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const pub = await publishToRemote(remote, alice, (await originDevice(alice, 2)).storage);
  const dump = remote._dump();
  const stolen = dump.backups.find((b) => b.scope === pub.backupScope);
  const s = createMemoryStorage();
  const out = await restoreFromBackup({ adapter: { get: async () => ({ version: stolen.version, nonce: stolen.nonce, ciphertext: stolen.ciphertext }) }, key: stolen.key, storage: s, chainId: CHAIN, pinnedCredential: alice.root, requestPrf: noPasskey, deriveAddress: addressOf, locks: fifoLocks() });
  assert.equal(out.error, "auth_failed");
  const eve = makeUser("eve");
  const eveOut = await restoreFromBackup({ adapter: { get: async () => stolen }, key: stolen.key, storage: s, chainId: CHAIN, pinnedCredential: eve.root, requestPrf: eve.requestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.equal(eveOut.error, "decrypt_failed");
  assert.deepEqual(seq(s), []);
});

await check("C2. enumeration: knowing the credentialId (raw / sha256 / hex) or guessing never resolves a discovery row", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  await publishToRemote(remote, alice, (await originDevice(alice, 1)).storage);
  const tries = [alice.id, Buffer.from(alice.idBytes).toString("hex"), crypto.createHash("sha256").update(alice.id).digest("hex"), crypto.createHash("sha256").update(Buffer.from(alice.idBytes)).digest("hex")];
  for (let i = 0; i < 25; i += 1) tries.push(crypto.randomBytes(32).toString("hex"));
  for (const t of tries) assert.equal(await remote.lookup(t), null);
});

await check("C3. persisted cross-user swap: Alice's row rewritten to Bob's record → discovery_key_mismatch; swapped blob → decrypt_failed", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const bob = makeUser("bob");
  const a = await publishToRemote(remote, alice, (await originDevice(alice, 1)).storage);
  const b = await publishToRemote(remote, bob, (await originDevice(bob, 2)).storage);
  remote._adminSetDiscovery(a.discoveryKey, (await remote.lookup(b.discoveryKey)));
  assert.deepEqual(await discoverGateBRoot({ adapter: remote, requestPrf: alice.requestPrf }), { status: "refused", reason: "discovery_key_mismatch" });
  // restore Alice's row; swap only the blob in her scope for Bob's envelope
  await remote.announce(a.discoveryKey, { recordVersion: 1 });
  remote._adminSetDiscovery(a.discoveryKey, { schemaVersion: 1, opaqueRecoveryId: a.discoveryKey, rootLocatorRef: "ref_alice001", recordVersion: 1 });
  remote._adminSetBackup(a.backupScope, myPiggiesIndexKey(CHAIN), remote._adminGetBackup(b.backupScope, myPiggiesIndexKey(CHAIN)));
  const { out, storage } = await freshRecover(remote, alice);
  assert.equal(out.reason, "decrypt_failed");
  assert.deepEqual(seq(storage), []);
});

await check("C4. live MITM: forged record re-keyed to Alice's locator passes shape but cannot move her flow onto Bob's data", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const bob = makeUser("bob");
  const a = await publishToRemote(remote, alice, (await originDevice(alice, 1)).storage);
  const b = await publishToRemote(remote, bob, (await originDevice(bob, 2)).storage);
  const mitm = {
    lookup: async (k) => ({ ...(await remote.lookup(b.discoveryKey)), opaqueRecoveryId: k }),
    backupStore: (scope) => ({ get: async (key) => remote.backupStore(b.backupScope).get(key), put: async () => { throw new Error("no"); } }),
    announce: remote.announce,
  };
  const { out, storage } = await freshRecover(mitm, alice);
  assert.equal(out.status, "refused");
  assert.equal(out.reason, "decrypt_failed");
  assert.deepEqual(seq(storage), []);
  // same code, honest server → Alice's own data
  const honest = await freshRecover(remote, alice);
  assert.deepEqual(honest.out.restored.map((r) => r.sequence), [1]);
  assert.equal(a.discoveryKey === b.discoveryKey, false);
});

await check("C6a. no passkey at all: discover = auth_failed; recovery refuses; createCredential never invoked", async () => {
  const remote = createMemoryGateBAdapter();
  assert.deepEqual(await discoverGateBRoot({ adapter: remote, requestPrf: noPasskey }), { status: "auth_failed" });
  const out = await recoverProductList({ adapter: remote.backupStore("d".repeat(64)), storage: createMemoryStorage(), chainId: CHAIN, rootCredential: { credentialId: "YWxpY2U" }, requestPrf: noPasskey, deriveAddress: addressOf, locks: fifoLocks() });
  assert.equal(out.source, "local_only");                                                    // nothing there, nothing claimed
  assert.equal(out.completeness, "unverified_fresh");
});

await check("C7. server edits: ciphertext bit-flip → decrypt_failed; reorder/dup entries collapse; forged issuedThrough never raises the watermark", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const pub = await publishToRemote(remote, alice, (await originDevice(alice, 2)).storage);
  const env = remote._adminGetBackup(pub.backupScope, myPiggiesIndexKey(CHAIN));
  remote._adminSetBackup(pub.backupScope, myPiggiesIndexKey(CHAIN), { ...env, ciphertext: (env.ciphertext[0] === "A" ? "B" : "A") + env.ciphertext.slice(1) });
  assert.equal((await freshRecover(remote, alice)).out.reason, "decrypt_failed");
  const indexPrf = (await alice.requestPrf(alice.root, await indexBackupSalt())).prfOutput;
  const weird = { version: 2, chainId: CHAIN, issuedThrough: 999, entries: [{ sequence: 2, createdAt: AT }, { sequence: 1, createdAt: AT }, { sequence: 1, createdAt: AT }], recordVersion: 1 };
  const s = createMemoryStorage();
  const out = await restoreFromBackup({ adapter: { get: async () => sealBackup(weird, indexPrf) }, key: "k", storage: s, chainId: CHAIN, pinnedCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.deepEqual(out.restored.map((r) => r.sequence), [1, 2]);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 2);                      // not 999
  assert.equal(out.completeness, "incomplete");                                             // claimed 999, proved 2
  completenessSeen.push(out.completeness);
});

await check("C9. outage: discover = unavailable (fail closed); local +Piggy unaffected; no fallback creation", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const origin = await originDevice(alice, 1);
  await publishToRemote(remote, alice, origin.storage);
  remote.setOutage(true);
  assert.deepEqual(await discoverGateBRoot({ adapter: remote, requestPrf: alice.requestPrf }), { status: "unavailable" });
  const more = await admitModelAPiggy({ storage: origin.storage, chainId: CHAIN, locks: fifoLocks(), rootCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, now: () => AT });
  assert.equal(more.ok, true);
  assert.deepEqual(seq(origin.storage), [1, 2]);
});

await check("C10/C11. unregistered or wrong discoverable credential → not_found; pinned root ≠ discovery candidate → refused before any list read", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  const stranger = makeUser("stranger");
  await publishToRemote(remote, alice, (await originDevice(alice, 1)).storage);
  assert.deepEqual(await discoverGateBRoot({ adapter: remote, requestPrf: stranger.requestPrf }), { status: "not_found" });
  const found = await discoverGateBRoot({ adapter: remote, requestPrf: alice.requestPrf });
  let reads = 0;
  const out = await recoverProductList({
    adapter: { get: async () => { reads += 1; return null; } },
    storage: createMemoryStorage(), chainId: CHAIN, rootCredential: stranger.root, requestPrf: stranger.requestPrf, deriveAddress: addressOf, locks: fifoLocks(), discovery: found,
  });
  assert.equal(out.status, "refused");
  assert.equal(out.reason, "root_credential_mismatch");
  assert.equal(reads, 0);
  const notMember = await recoverProductList({ adapter: { get: async () => { reads += 1; return null; } }, storage: createMemoryStorage(), chainId: CHAIN, rootCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, locks: fifoLocks(), discovery: { status: "not_found" } });
  assert.equal(notMember.reason, "discovery_not_member");
  assert.equal(reads, 0);
});

await check("C13. chain mixup: a blob sealed for another chain → chain_mismatch before any candidate auth", async () => {
  const alice = makeUser("alice");
  const origin = await originDevice(alice, 1);
  const indexPrf = (await alice.requestPrf(alice.root, await indexBackupSalt())).prfOutput;
  const other = { ...buildBackupPayload(loadMyPiggiesIndex(origin.storage, CHAIN).index, { recordVersion: 1 }), chainId: "other-chain" };
  const before = alice.stats().salts.length;
  const out = await restoreFromBackup({ adapter: { get: async () => sealBackup(other, indexPrf) }, key: "k", storage: createMemoryStorage(), chainId: CHAIN, pinnedCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, locks: fifoLocks() });
  assert.equal(out.error, "chain_mismatch");
  assert.equal(alice.stats().salts.slice(before).includes(modelASaltHex(1)), false);
});

await check("C14. concurrent discovery-driven restore + local +Piggy (both n=1) under the same Web Lock → one row, watermark once", async () => {
  const remote = createMemoryGateBAdapter();
  const alice = makeUser("alice");
  await publishToRemote(remote, alice, (await originDevice(alice, 1)).storage);
  const found = await discoverGateBRoot({ adapter: remote, requestPrf: alice.requestPrf });
  const s = createMemoryStorage();
  const locks = fifoLocks();
  const [r, a] = await Promise.all([
    recoverProductList({ adapter: remote.backupStore(found.backupScope), storage: s, chainId: CHAIN, rootCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, locks, discovery: found }),
    admitModelAPiggy({ storage: s, chainId: CHAIN, locks, rootCredential: alice.root, requestPrf: alice.requestPrf, deriveAddress: addressOf, now: () => AT }),
  ]);
  assert.equal(r.status, "ok");
  // [A-695 SEQ-5=A] 새 기기(첫 Piggy 행 없음)의 +Piggy 는 번호를 내지 않는다 — 복원이 이기든 +Piggy 가 먼저 오든 닫힌다.
  assert.equal(a.ok, false);
  assert.ok(["origin_index_missing", "origin_index_no_first_piggy"].includes(a.reason), a.reason);
  // restore alone fills n=1; exactly one row, watermark advanced once
  assert.deepEqual(seq(s), [1]);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.filter((p) => p.sequence === 1).length, 1);
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.issuedThrough, 1);
  assert.equal(new Set(locks.names).size, 1);
  assert.equal(locks.names[0], myPiggiesLockName(CHAIN));
});

await check("SUMMARY. no recovery result in this suite ever reported completeness 'complete'", () => {
  assert.ok(completenessSeen.length >= 4);
  assert.equal(completenessSeen.includes("complete"), false);
});

console.log(`\n${pass}/${pass} PASS`);
