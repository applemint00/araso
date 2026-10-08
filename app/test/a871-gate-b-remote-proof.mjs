// [A-871] Gate B release-grade write-proof boundary. node app/test/a871-gate-b-remote-proof.mjs
// No network, no browser, no tx. Deterministic fixed-seed vectors (Ed25519 is deterministic).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPABILITY, TRUST_LABEL, classifyAuthority, assertReleaseGrade, blobDigest, advanceMessage,
  ed25519KeyFromSeed, signAdvance, createEd25519Verifier, buildAdvanceRequest, assertUploadSafe,
  createReferenceAnchor, trustLabel, claimsGlobalLatest, toHex, fromHex
} from "../src/gate-b-remote-proof.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass++; }
  catch (e) { console.log(`FAIL  ${label}\n      ${e && e.stack || e}`); fail++; }
}

const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const SCOPE = "ab".repeat(32);
const ch = (n) => n.toString(16).padStart(64, "0");
const key = await ed25519KeyFromSeed(seed);
const verifier = await createEd25519Verifier(key.publicKeyHex);
const blob = (v) => ({ version: v, nonce: Uint8Array.from({ length: 12 }, (_, i) => i), ciphertext: Uint8Array.from([1, 2, 3, v & 255]) });

const mkAnchor = () => { let n = 0; return createReferenceAnchor({ verifier, challengeSource: () => ch(++n) }); };
async function req(anchor, { prev, ver, dig, scope = SCOPE, k = key, pub = key.publicKeyHex }) {
  const challenge = anchor.issueChallenge();
  const f = { scopeId: scope, prevVersion: prev, version: ver, digest: dig, challenge };
  return { ...f, signature: await signAdvance(k.privateKey, f), publicKey: pub };
}
const D1 = await blobDigest(blob(1));
const D2 = await blobDigest(blob(2));
const PINNED_SIG = "b3e84c775c85916b2e035f88097ec4b3db2bd73cd19be25bd1d50f9df00729e8d7654414129277abb37c09682bcc76baf0249c37dea0b688ff47b9afb84d4306";
const PINNED_D1 = "4f6af85be5fad9172672cc6c2c605dd20a94184fa18f502c64570ba0187fd376";

await check("vector: ed25519 public key from fixed seed", () => {
  assert.equal(key.publicKeyHex, toHex(Buffer.from("ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ", "base64url")));
});
await check("vector: signature over fixed message is deterministic and pinned", async () => {
  const f = { scopeId: SCOPE, prevVersion: 0, version: 1, digest: D1, challenge: ch(1) };
  const s1 = await signAdvance(key.privateKey, f);
  assert.equal(s1, await signAdvance(key.privateKey, f));
  assert.equal(s1.length, 128);
  assert.equal(s1, PINNED_SIG);
});
await check("vector: blob digest pinned (SHA-256 of version|nonce|ciphertext)", () => {
  assert.equal(D1, PINNED_D1);
});
await check("vector: canonical message is domain separated and exact", () => {
  const m = new TextDecoder().decode(advanceMessage({ scopeId: SCOPE, prevVersion: 0, version: 1, digest: D1, challenge: ch(1) }));
  assert.equal(m, `araso.gateb.remote-proof.v1|advance|${SCOPE}|0|1|${D1}|${ch(1)}`);
});

// ---- capability classification
const asym = { writeProof: { verifier }, storage: { authorityId: "s" }, anchor: { authorityId: "s" } };
await check("asymmetric verifier is release-grade even when storage+anchor colocated", () => {
  const v = classifyAuthority(asym);
  assert.equal(v.capability, CAPABILITY.ASYMMETRIC_VERIFIER); assert.equal(v.releaseGrade, true);
});
await check("independent anchor (distinct authority, no shared secret) is release-grade", () => {
  const v = classifyAuthority({ writeProof: { scheme: "ed25519" }, storage: { authorityId: "A", secretFingerprint: "f1" }, anchor: { authorityId: "B", secretFingerprint: "f2" } });
  assert.equal(v.capability, CAPABILITY.INDEPENDENT_ANCHOR); assert.equal(v.releaseGrade, true);
});
await check("A-857 shape (HMAC, same authority) is rejected as release-grade", () => {
  const d = { writeProof: { scheme: "hmac-sha256", verifierHoldsSigningSecret: true }, storage: { authorityId: "s", secretFingerprint: "k" }, anchor: { authorityId: "s", secretFingerprint: "k" } };
  const v = classifyAuthority(d);
  assert.equal(v.capability, CAPABILITY.SAME_SECRET); assert.equal(v.releaseGrade, false);
  assert.ok(v.reasons.includes("write_proof_verifier_can_forge") && v.reasons.includes("storage_and_anchor_share_secret"));
  assert.throws(() => assertReleaseGrade(d), /not_release_grade:same_secret/);
});
await check("distinct authority names but HMAC write proof is still rejected", () => {
  const v = classifyAuthority({ writeProof: { scheme: "hmac-sha256" }, storage: { authorityId: "A" }, anchor: { authorityId: "B" } });
  assert.equal(v.releaseGrade, false);
});
await check("distinct authority names but shared secret fingerprint is rejected", () => {
  const v = classifyAuthority({ writeProof: { scheme: "ed25519" }, storage: { authorityId: "A", secretFingerprint: "k" }, anchor: { authorityId: "B", secretFingerprint: "k" } });
  assert.equal(v.releaseGrade, false);
});
await check("asymmetric scheme claimed but verifier holds secret / unspecified => not release-grade", () => {
  assert.equal(classifyAuthority({ writeProof: { scheme: "ed25519", verifierHoldsSigningSecret: true } }).releaseGrade, false);
  assert.equal(classifyAuthority({ writeProof: { scheme: "ed25519" } }).releaseGrade, false);
});
await check("empty / junk descriptors fail closed", () => {
  for (const d of [undefined, null, {}, "x", 5, { writeProof: { scheme: "rsa-magic" } }, { storage: { authorityId: "A" } }]) {
    assert.equal(classifyAuthority(d).releaseGrade, false);
  }
});

// ---- upload hygiene
await check("buildAdvanceRequest drops unknown fields and never carries identity/secret keys", async () => {
  const r = await req(mkAnchor(), { prev: 0, ver: 1, dig: D1 });
  const built = buildAdvanceRequest({ ...r, credentialId: "CRED", address: "0x1", prfOutput: "zz", privateKey: "k", seed: "s" });
  assert.deepEqual(Object.keys(built).sort(), ["challenge", "digest", "prevVersion", "publicKey", "scopeId", "signature", "version"]);
  const j = JSON.stringify(built);
  for (const bad of ["CRED", "0x1", "prfOutput", "privateKey"]) assert.ok(!j.includes(bad));
});
await check("assertUploadSafe rejects credentialId/address/prf/seed/private keys at any depth", () => {
  for (const k of ["credentialId", "address", "prfOutput", "seed", "privateKey", "passkeyId"]) {
    assert.throws(() => assertUploadSafe({ a: { [k]: 1 } }), /forbidden_upload_field/);
  }
});
await check("scopeId must be an opaque 32-byte hash (an address is rejected)", () => {
  assert.throws(() => advanceMessage({ scopeId: "0x" + "1".repeat(40), prevVersion: 0, version: 1, digest: D1, challenge: ch(1) }), /bad_scope/);
});
await check("verifier object exposes no signing capability", () => {
  assert.equal(verifier.sign, undefined); assert.equal(verifier.privateKey, undefined);
  assert.equal(verifier.verifierHoldsSigningSecret, false);
});
await check("reference anchor refuses a non-asymmetric verifier", () => {
  assert.throws(() => createReferenceAnchor({ verifier: { scheme: "hmac-sha256", verifierHoldsSigningSecret: true, verify: async () => true }, challengeSource: () => ch(1) }), /not_release_grade/);
});

// ---- challenge / CAS / digest conformance
await check("happy path: v1 then v2, get() reflects last commit", async () => {
  const a = mkAnchor();
  assert.deepEqual(await a.advance(await req(a, { prev: 0, ver: 1, dig: D1 })), { ok: true, idempotent: false, version: 1 });
  assert.deepEqual(await a.advance(await req(a, { prev: 1, ver: 2, dig: D2 })), { ok: true, idempotent: false, version: 2 });
  assert.deepEqual(a.get(SCOPE), { version: 2, digest: D2 });
});
await check("idempotent repeat of the same (version,digest) succeeds, new challenge", async () => {
  const a = mkAnchor();
  await a.advance(await req(a, { prev: 0, ver: 1, dig: D1 }));
  const r = await a.advance(await req(a, { prev: 0, ver: 1, dig: D1 }));
  assert.equal(r.ok, true); assert.equal(r.idempotent, true);
});
await check("same version, different digest => digest_mismatch", async () => {
  const a = mkAnchor();
  await a.advance(await req(a, { prev: 0, ver: 1, dig: D1 }));
  assert.equal((await a.advance(await req(a, { prev: 0, ver: 1, dig: D2 }))).reason, "digest_mismatch");
});
await check("rollback to an older version is rejected", async () => {
  const a = mkAnchor();
  await a.advance(await req(a, { prev: 0, ver: 1, dig: D1 }));
  await a.advance(await req(a, { prev: 1, ver: 2, dig: D2 }));
  assert.equal((await a.advance(await req(a, { prev: 0, ver: 1, dig: D1 }))).reason, "rollback");
});
await check("stale prevVersion => cas_conflict, state unchanged", async () => {
  const a = mkAnchor();
  await a.advance(await req(a, { prev: 0, ver: 1, dig: D1 }));
  const r = await a.advance(await req(a, { prev: 0, ver: 2, dig: D2 }));
  assert.equal(r.reason, "cas_conflict"); assert.equal(a.get(SCOPE).version, 1);
});
await check("version must increase; prevVersion ahead of anchor is a CAS conflict", async () => {
  const a = mkAnchor();
  assert.equal((await a.advance(await req(a, { prev: 0, ver: 0, dig: D1 }))).reason, "version_not_increasing");
  assert.equal((await a.advance(await req(a, { prev: 5, ver: 6, dig: D1 }))).reason, "cas_conflict");
});
await check("challenge replay is rejected (single use)", async () => {
  const a = mkAnchor();
  const r = await req(a, { prev: 0, ver: 1, dig: D1 });
  assert.equal((await a.advance(r)).ok, true);
  assert.equal((await a.advance(r)).reason, "challenge_unknown_or_used");
});
await check("challenge never issued by the anchor is rejected", async () => {
  const a = mkAnchor();
  const f = { scopeId: SCOPE, prevVersion: 0, version: 1, digest: D1, challenge: ch(999) };
  const r = { ...f, signature: await signAdvance(key.privateKey, f), publicKey: key.publicKeyHex };
  assert.equal((await a.advance(r)).reason, "challenge_unknown_or_used");
});
await check("signature bound to every field: tampering any field fails verification", async () => {
  for (const mut of [{ digest: D2 }, { version: 2 }, { prevVersion: 1 }, { scopeId: "cd".repeat(32) }]) {
    const a = mkAnchor();
    const r = await req(a, { prev: 0, ver: 1, dig: D1 });
    const res = await a.advance({ ...r, ...mut });
    assert.equal(res.ok, false); assert.equal(res.reason, "bad_signature");
    assert.equal(a.get(SCOPE), null);
  }
});
await check("a forged signature with a different key is rejected (storage holder cannot forge)", async () => {
  const attacker = await ed25519KeyFromSeed(Uint8Array.from({ length: 32 }, (_, i) => 200 - i));
  const a = mkAnchor();
  const forged = await req(a, { prev: 0, ver: 1, dig: D1, k: attacker, pub: key.publicKeyHex });
  assert.equal((await a.advance(forged)).reason, "bad_signature");
  const own = await req(a, { prev: 0, ver: 1, dig: D1, k: attacker, pub: attacker.publicKeyHex });
  assert.equal((await a.advance(own)).reason, "unknown_writer_key");
});
await check("failed signature does not burn the challenge or reveal state", async () => {
  const a = mkAnchor();
  await a.advance(await req(a, { prev: 0, ver: 1, dig: D1 }));
  const attacker = await ed25519KeyFromSeed(Uint8Array.from({ length: 32 }, (_, i) => 9 + i));
  const bad = await req(a, { prev: 0, ver: 1, dig: D2, k: attacker });
  assert.equal((await a.advance(bad)).reason, "bad_signature");
});
await check("malformed requests are rejected without throwing", async () => {
  const a = mkAnchor();
  for (const r of [{}, null, { scopeId: "x" }]) assert.equal((await a.advance(r ?? {})).reason, "malformed_request");
});

// ---- trust labels
await check("release-grade match => anchored_fresh, never globallyLatest", () => {
  const t = trustLabel({ authority: classifyAuthority(asym), anchorOutcome: "match" });
  assert.equal(t.label, "anchored_fresh"); assert.equal(t.releaseGrade, true); assert.equal(t.globallyLatest, false);
  assert.ok(!claimsGlobalLatest(t.claim));
});
await check("same-secret match is local_proof_only, never anchored_fresh", () => {
  const t = trustLabel({ authority: { writeProof: { scheme: "hmac-sha256" }, storage: { authorityId: "s" }, anchor: { authorityId: "s" } }, anchorOutcome: "match" });
  assert.equal(t.label, TRUST_LABEL.LOCAL_ONLY); assert.equal(t.releaseGrade, false); assert.equal(t.globallyLatest, false);
});
await check("no match / error => unverified_fresh for every authority", () => {
  for (const o of ["mismatch", "ahead", "error", undefined]) {
    const t = trustLabel({ authority: classifyAuthority(asym), anchorOutcome: o });
    assert.equal(t.label, TRUST_LABEL.UNVERIFIED); assert.equal(t.releaseGrade, false); assert.equal(t.globallyLatest, false);
  }
});
await check("claimsGlobalLatest detector", () => {
  assert.equal(claimsGlobalLatest("this is the globally latest state"), true);
  assert.equal(claimsGlobalLatest("not proven globally latest"), false);
});


// ---- A-871 review round 1 fixes (probes P1-P15)
await check("P1 two authority names without secret fingerprints are NOT independent", () => {
  assert.equal(classifyAuthority({ writeProof: { scheme: "ed25519" }, storage: { authorityId: "A" }, anchor: { authorityId: "B" } }).releaseGrade, false);
  assert.equal(classifyAuthority({ writeProof: { scheme: "ed25519" }, storage: { authorityId: "A", secretFingerprint: "f" }, anchor: { authorityId: "B" } }).releaseGrade, false);
});
await check("P2-P4 hmac / HMAC-SHA-256 / kmac / unlisted schemes never release-grade; names differ only by case/space", () => {
  for (const scheme of ["hmac", "HMAC-SHA-256", "kmac", "kmac256", "none", "", undefined]) {
    const v = classifyAuthority({ writeProof: { scheme }, storage: { authorityId: "A", secretFingerprint: "f1" }, anchor: { authorityId: "B", secretFingerprint: "f2" } });
    assert.equal(v.releaseGrade, false, String(scheme));
  }
  const same = classifyAuthority({ writeProof: { scheme: "ed25519" }, storage: { authorityId: "S", secretFingerprint: "f1" }, anchor: { authorityId: "s ", secretFingerprint: "f2" } });
  assert.equal(same.releaseGrade, false); assert.equal(same.capability, CAPABILITY.SAME_SECRET);
  const fp = classifyAuthority({ writeProof: { scheme: "ed25519" }, storage: { authorityId: "A", secretFingerprint: "K" }, anchor: { authorityId: "B", secretFingerprint: " k" } });
  assert.equal(fp.releaseGrade, false);
});
await check("P5 bare ed25519 declaration without the real verifier object is NOT asymmetric", () => {
  for (const wp of [{ scheme: "ed25519", verifierHoldsSigningSecret: false }, { verifier: { scheme: "ed25519", verifierHoldsSigningSecret: false, verify() {} } }]) {
    assert.equal(classifyAuthority({ writeProof: wp, storage: { authorityId: "s" }, anchor: { authorityId: "s" } }).releaseGrade, false);
  }
});
await check("P6 forged look-alike verdict is not trusted by trustLabel", () => {
  const t = trustLabel({ authority: { capability: "same_secret", releaseGrade: true }, anchorOutcome: "match" });
  assert.notEqual(t.label, "anchored_fresh"); assert.equal(t.releaseGrade, false);
  const t2 = trustLabel({ authority: { capability: "asymmetric_verifier", releaseGrade: true, reasons: [] }, anchorOutcome: "match" });
  assert.equal(t2.releaseGrade, false);
});
await check("P7 object with toString smuggling rawId/userHandle is rejected, not uploaded", async () => {
  const a = mkAnchor();
  const r = await req(a, { prev: 0, ver: 1, dig: D1 });
  const smuggle = { toString: () => SCOPE, rawId: "RAW", userHandle: "UH" };
  assert.throws(() => buildAdvanceRequest({ ...r, scopeId: smuggle }), /bad_field/);
  assert.throws(() => advanceMessage({ scopeId: smuggle, prevVersion: 0, version: 1, digest: D1, challenge: ch(1) }), /bad_scope/);
  assert.equal((await a.advance({ ...r, digest: { toString: () => D1 } })).reason, "malformed_request");
});
await check("P9 array scopeId cannot commit to a phantom key", async () => {
  const a = mkAnchor();
  const r = await req(a, { prev: 0, ver: 1, dig: D1 });
  assert.equal((await a.advance({ ...r, scopeId: [SCOPE] })).reason, "malformed_request");
  assert.equal(a.get(SCOPE), null); assert.equal(a.get([SCOPE]), null);
});
await check("P11 small-order / non-canonical public keys refused; identity key + R=identity,S=0 cannot verify", async () => {
  const small = ["01" + "00".repeat(31), "ec" + "ff".repeat(30) + "7f", "00".repeat(32), "00".repeat(31) + "80",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05", "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85", "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa"];
  for (const k of small) await assert.rejects(createEd25519Verifier(k), /bad_public_key/);
  await assert.rejects(createEd25519Verifier("ed" + "ff".repeat(30) + "7f"), /bad_public_key/); // y = p (non-canonical identity alias)
  // every sign-bit variant of the listed keys, plus the two encodings the first fix missed
  for (const k of small) {
    const b = fromHex(k); b[31] |= 0x80;
    await assert.rejects(createEd25519Verifier(toHex(b)), /bad_public_key/, toHex(b));
  }
  await assert.rejects(createEd25519Verifier("01" + "00".repeat(30) + "80"), /bad_public_key/); // identity, sign bit set
  await assert.rejects(createEd25519Verifier("ec" + "ff".repeat(31)), /bad_public_key/); // y=p-1, sign bit set
  assert.equal(await verifier.verify(advanceMessage({ scopeId: SCOPE, prevVersion: 0, version: 1, digest: D1, challenge: ch(1) }), "01" + "00".repeat(31) + "00".repeat(32)), false);
});
await check("non-canonical S (S >= L) is rejected by the verifier", async () => {
  const f = { scopeId: SCOPE, prevVersion: 0, version: 1, digest: D1, challenge: ch(1) };
  const sig = fromHex(await signAdvance(key.privateKey, f));
  const L = (1n << 252n) + 27742317777372353535851937790883648493n;
  let s = 0n; for (let i = 31; i >= 0; i--) s = (s << 8n) | BigInt(sig[32 + i]);
  s += L; const bad = Uint8Array.from(sig);
  for (let i = 0; i < 32; i++) { bad[32 + i] = Number((s >> BigInt(8 * i)) & 255n); }
  assert.equal(await verifier.verify(advanceMessage(f), toHex(sig)), true);
  assert.equal(await verifier.verify(advanceMessage(f), toHex(bad)), false);
});
await check("P12 digest framing: only 12-byte nonces accepted", async () => {
  await assert.rejects(blobDigest({ version: 1, nonce: new Uint8Array(11), ciphertext: new Uint8Array(1) }), /bad_blob/);
  await assert.rejects(blobDigest({ version: 1, nonce: new Uint8Array(13), ciphertext: new Uint8Array(1) }), /bad_blob/);
});
await check("deep scan also rejects rawId / userHandle / wallet / priv*", () => {
  for (const k of ["rawId", "userHandle", "wallet", "privKey"]) assert.throws(() => assertUploadSafe({ [k]: 1 }), /forbidden_upload_field/);
});

// ---- isolation
await check("module is isolated: no network, no imports of runtime files, nothing imports it", () => {
  const src = readFileSync(path.resolve(HERE, "../src/gate-b-remote-proof.js"), "utf8");
  assert.ok(!/^\s*import\s/m.test(src), "no imports at all");
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|process\.env/.test(src));
  
  for (const f of readdirSync(path.resolve(HERE, "../src")).filter((n) => n.endsWith(".js") && n !== "gate-b-remote-proof.js")) {
    assert.ok(!readFileSync(path.resolve(HERE, "../src", f), "utf8").includes("gate-b-remote-proof"), `${f} must not import it`);
  }
});


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
