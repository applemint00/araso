// [A-871] Gate B release-grade write-proof boundary. ISOLATED: nothing imports this file yet.
//
// Owner decision (TECHNICAL OWNER ANSWERS II, 3): a remote Gate B freshness anchor whose blob storage
// holds the same secret that verifies the write proof (A-857 HMAC) can forge its own freshness, so it is
// LOCAL proof only. Release needs ONE of:
//   (a) ASYMMETRIC_VERIFIER  - the verifier holds only a public key; the signing secret stays owner-side.
//   (b) INDEPENDENT_ANCHOR   - the freshness anchor is a different trust authority than blob storage.
// This module encodes that distinction as pure, provider-neutral, network-free functions + an in-memory
// reference verifier for conformance tests. It selects no provider and has no production adapter.
//
// What is uploaded (and only this): scopeId, prevVersion, version, digest, challenge, signature, publicKey.
// Never a credentialId, address, PRF output, seed or private key. buildAdvanceRequest builds from an allowlist.

export const CAPABILITY = Object.freeze({
  ASYMMETRIC_VERIFIER: "asymmetric_verifier",
  INDEPENDENT_ANCHOR: "independent_anchor",
  SAME_SECRET: "same_secret",
  UNKNOWN: "unknown"
});

const RELEASE_CAPABILITIES = new Set([CAPABILITY.ASYMMETRIC_VERIFIER, CAPABILITY.INDEPENDENT_ANCHOR]);
// ALLOWLIST of non-symmetric write-proof schemes. Anything not listed (hmac, kmac, "HMAC-SHA-256", typos) is
// not release-grade. Add a scheme only together with a vetted vector set.
const NON_SYMMETRIC_SCHEMES = new Set(["ed25519"]);
// Verdicts and verifiers this module created itself; objects merely shaped like them are never trusted.
const OWN_VERDICTS = new WeakSet();
const OWN_VERIFIERS = new WeakSet();
const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

export const MAX_VERSION = 2 ** 31;
export const DOMAIN = "araso.gateb.remote-proof.v1";

const enc = new TextEncoder();
const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error("webcrypto_unavailable");
  return s;
};

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function fromHex(hex) {
  if (typeof hex !== "string" || hex.length % 2 || !/^[0-9a-f]*$/.test(hex)) throw new Error("bad_hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---------------------------------------------------------------- capability classification
// descriptor = {
//   writeProof: { scheme, verifierHoldsSigningSecret?: boolean },
//   storage:    { authorityId, secretFingerprint? },
//   anchor:     { authorityId, secretFingerprint? }
// }
// Fail closed: anything not positively proven is not release-grade.
export function classifyAuthority(descriptor) {
  const reasons = [];
  const d = descriptor && typeof descriptor === "object" ? descriptor : {};
  const wp = d.writeProof && typeof d.writeProof === "object" ? d.writeProof : {};
  const st = d.storage && typeof d.storage === "object" ? d.storage : {};
  const an = d.anchor && typeof d.anchor === "object" ? d.anchor : {};
  const scheme = norm(wp.scheme);
  const schemeOk = NON_SYMMETRIC_SCHEMES.has(scheme);

  const stId = norm(st.authorityId), anId = norm(an.authorityId);
  const stFp = norm(st.secretFingerprint), anFp = norm(an.secretFingerprint);
  const sameId = Boolean(stId) && stId === anId;
  const sameFp = Boolean(stFp) && stFp === anFp;
  const holdsSecret = wp.verifierHoldsSigningSecret === true;

  if (!schemeOk) reasons.push("write_scheme_not_in_non_symmetric_allowlist");
  if (holdsSecret) reasons.push("write_proof_verifier_can_forge");
  if (sameFp) reasons.push("storage_and_anchor_share_secret");
  if (sameId) reasons.push("storage_and_anchor_same_authority");

  // (a) asymmetric: the ACTUAL public-key verifier object this module built, scheme allowlisted.
  // A bare declaration {scheme, verifierHoldsSigningSecret:false} is never enough.
  const v = wp.verifier;
  if (v && OWN_VERIFIERS.has(v) && NON_SYMMETRIC_SCHEMES.has(norm(v.scheme)) && v.verifierHoldsSigningSecret === false && !holdsSecret) {
    return verdict(CAPABILITY.ASYMMETRIC_VERIFIER, []);
  }
  // (b) independent anchor needs ALL of: allowlisted non-symmetric scheme, both fingerprints present and
  // distinct, authority ids present and distinct after trim+lowercase. Names alone prove nothing.
  if (schemeOk && !holdsSecret && stId && anId && !sameId && stFp && anFp && !sameFp) {
    return verdict(CAPABILITY.INDEPENDENT_ANCHOR, []);
  }

  if (holdsSecret || sameFp || sameId || (scheme && !schemeOk)) return verdict(CAPABILITY.SAME_SECRET, reasons);
  if (!scheme && !stId && !anId) reasons.push("no_authority_declared");
  else reasons.push("capability_not_proven");
  return verdict(CAPABILITY.UNKNOWN, reasons);
}

function verdict(capability, reasons) {
  const out = Object.freeze({ capability, releaseGrade: RELEASE_CAPABILITIES.has(capability), reasons: Object.freeze([...reasons]) });
  OWN_VERDICTS.add(out);
  return out;
}

export function assertReleaseGrade(descriptor) {
  const v = classifyAuthority(descriptor);
  if (!v.releaseGrade) {
    const e = new Error(`not_release_grade:${v.capability}`);
    e.verdict = v;
    throw e;
  }
  return v;
}

// ---------------------------------------------------------------- digest / canonical message / challenge
export async function blobDigest({ version, nonce, ciphertext }) {
  assertVersion(version);
  if (!(nonce instanceof Uint8Array) || nonce.length !== 12 || !(ciphertext instanceof Uint8Array)) throw new Error("bad_blob"); // fixed 12-byte nonce keeps the "|" framing unambiguous
  const head = enc.encode(`${version}|`);
  const sep = enc.encode("|");
  const buf = new Uint8Array(head.length + nonce.length + sep.length + ciphertext.length);
  buf.set(head, 0);
  buf.set(nonce, head.length);
  buf.set(sep, head.length + nonce.length);
  buf.set(ciphertext, head.length + nonce.length + sep.length);
  return toHex(new Uint8Array(await subtle().digest("SHA-256", buf)));
}

function assertVersion(v) {
  if (!Number.isInteger(v) || v < 0 || v > MAX_VERSION) throw new Error("bad_version");
}
const HEX64 = /^[0-9a-f]{64}$/;
const SCOPE = /^[0-9a-f]{64}$/; // scopeId must be an opaque hash, never an address or credential id

// Domain-separated, length-unambiguous message the owner signs and the verifier checks.
export function advanceMessage({ scopeId, prevVersion, version, digest, challenge }) {
  // typeof BEFORE regex: RegExp.test coerces objects/arrays through toString, which can smuggle data.
  if (typeof scopeId !== "string" || !SCOPE.test(scopeId)) throw new Error("bad_scope");
  assertVersion(prevVersion);
  assertVersion(version);
  if (typeof digest !== "string" || !HEX64.test(digest)) throw new Error("bad_digest");
  if (typeof challenge !== "string" || !HEX64.test(challenge)) throw new Error("bad_challenge");
  return enc.encode([DOMAIN, "advance", scopeId, prevVersion, version, digest, challenge].join("|"));
}

// ---------------------------------------------------------------- signing (owner side) / verifying
// Seed derivation (e.g. from the index PRF) is the CALLER's job; this module never sees PRF output
// in production paths and never returns the seed. Tests use fixed seeds.
const PKCS8_ED25519_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

export async function ed25519KeyFromSeed(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new Error("bad_seed");
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
  pkcs8.set(PKCS8_ED25519_PREFIX, 0);
  pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);
  const privateKey = await subtle().importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await subtle().exportKey("jwk", privateKey);
  const publicKeyB64u = jwk.x;
  const publicKey = await subtle().importKey("jwk", { kty: "OKP", crv: "Ed25519", x: publicKeyB64u }, { name: "Ed25519" }, true, ["verify"]);
  const raw = new Uint8Array(await subtle().exportKey("raw", publicKey));
  return { privateKey, publicKeyHex: toHex(raw) };
}

export async function signAdvance(privateKey, fields) {
  return toHex(new Uint8Array(await subtle().sign({ name: "Ed25519" }, privateKey, advanceMessage(fields))));
}

// Public-key-only verifier: holds NO signing capability by construction.
export async function createEd25519Verifier(publicKeyHex) {
  const raw = fromHex(publicKeyHex);
  if (raw.length !== 32 || !isAcceptablePublicKey(raw)) throw new Error("bad_public_key");
  const key = await subtle().importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
  const verifierObj = Object.freeze({
    scheme: "ed25519",
    verifierHoldsSigningSecret: false,
    publicKeyHex: toHex(raw),
    async verify(message, signatureHex) {
      try {
        const sig = fromHex(signatureHex);
        if (sig.length !== 64 || !isCanonicalS(sig.subarray(32))) return false;
        return await subtle().verify({ name: "Ed25519" }, key, sig, message);
      } catch {
        return false;
      }
    }
  });
  OWN_VERIFIERS.add(verifierObj);
  return verifierObj;
}

// F4: reject the 8 small-order encodings and any non-canonical y (y >= p). With a small-order public key an
// attacker can build signatures valid for many messages; WebCrypto does not reject these for us.
// Compared on y with bit 255 (the sign bit) MASKED OFF, so every sign-bit variant is refused too, including
// x=0 with the sign bit set (non-canonical identity / -identity).
const SMALL_ORDER_Y = new Set([
  "01" + "00".repeat(31), // y = 1   (identity)
  "ec" + "ff".repeat(30) + "7f", // y = p-1
  "00".repeat(32), // y = 0
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a"
]);
const P25519 = 2n ** 255n - 19n;
const L25519 = 2n ** 252n + 27742317777372353535851937790883648493n;
const leInt = (b) => b.reduceRight((a, x) => (a << 8n) | BigInt(x), 0n);
function isAcceptablePublicKey(raw) {
  const masked = Uint8Array.from(raw);
  masked[31] &= 0x7f; // mask bit 255 BEFORE any lookup
  if (SMALL_ORDER_Y.has(toHex(masked))) return false;
  return leInt(masked) < P25519; // non-canonical y encodings (y >= p) are refused
}
function isCanonicalS(sBytes) {
  return leInt(sBytes) < L25519;
}

// ---------------------------------------------------------------- upload allowlist
const ADVANCE_FIELDS = ["scopeId", "prevVersion", "version", "digest", "challenge", "signature", "publicKey"];
const FORBIDDEN_KEY = /credential|address|prf|seed|priv|secret|mnemonic|salt|passkey|rawid|userhandle|wallet|\bsk\b/i;

// Deep-scan any object destined for upload: no key may look like identity or secret material.
export function assertUploadSafe(obj, path = "$") {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (FORBIDDEN_KEY.test(k)) throw new Error(`forbidden_upload_field:${path}.${k}`);
      assertUploadSafe(v, `${path}.${k}`);
    }
  }
  return true;
}

export function buildAdvanceRequest(input) {
  if (!input || typeof input !== "object") throw new Error("bad_request");
  const out = {};
  for (const k of ADVANCE_FIELDS) {
    const v = input[k];
    // primitives only: strings are copied by value, so a later toString/getter cannot change what is uploaded
    if (typeof v !== "string" && typeof v !== "number") throw new Error(`bad_field:${k}`);
    out[k] = v;
  }
  advanceMessage(out); // validates shapes (typeof-checked)
  if (typeof out.signature !== "string" || !/^[0-9a-f]{128}$/.test(out.signature)) throw new Error("bad_signature_shape");
  if (typeof out.publicKey !== "string" || !HEX64.test(out.publicKey)) throw new Error("bad_public_key");
  assertUploadSafe(out);
  return Object.freeze(out);
}

// ---------------------------------------------------------------- reference anchor (conformance / tests only)
// Provider-neutral state machine every real adapter must match: single-use challenge, CAS on prevVersion,
// idempotent repeat of the same (version,digest), asymmetric signature check. The anchor is configured with ONE
// writer public key (the verifier); there is no enrolment, rotation or per-scope key pinning here.
// NOT a production adapter: in-memory, no persistence, no network.
export function createReferenceAnchor({ verifier, challengeSource }) {
  if (!verifier || typeof verifier.verify !== "function") throw new Error("verifier_required");
  const releaseVerdict = classifyAuthority({
    writeProof: { verifier },
    storage: { authorityId: "storage" },
    anchor: { authorityId: "storage" }
  });
  // asymmetric verifier is release-grade by itself, even when storage/anchor are co-located.
  if (releaseVerdict.capability !== CAPABILITY.ASYMMETRIC_VERIFIER) throw new Error(`not_release_grade:${releaseVerdict.capability}`);
  if (typeof challengeSource !== "function") throw new Error("challenge_source_required");

  const issued = new Set();
  const scopes = new Map(); // scopeId -> { version, digest, publicKey }

  return {
    issueChallenge() {
      const c = challengeSource();
      if (typeof c !== "string" || !HEX64.test(c) || issued.has(c)) throw new Error("bad_challenge_source");
      issued.add(c);
      return c;
    },
    get(scopeId) {
      const s = scopes.get(scopeId);
      return s ? { version: s.version, digest: s.digest } : null;
    },
    async advance(req) {
      let r;
      try {
        r = buildAdvanceRequest(req);
      } catch (e) {
        return { ok: false, reason: "malformed_request" };
      }
      if (r.publicKey !== verifier.publicKeyHex) return { ok: false, reason: "unknown_writer_key" };
      const cur = scopes.get(r.scopeId) || null;
      if (!issued.has(r.challenge)) return { ok: false, reason: "challenge_unknown_or_used" };
      // Cheap shape/key/challenge gates run first; the signature is checked BEFORE any state-revealing verdict
      // (version/digest/CAS), so an unauthenticated caller learns nothing about stored state.
      const sigOk = await verifier.verify(advanceMessage(r), r.signature);
      if (!sigOk) return { ok: false, reason: "bad_signature" };
      issued.delete(r.challenge); // single-use once authenticated
      const curVersion = cur ? cur.version : 0;
      if (cur && r.version === cur.version) {
        return r.digest === cur.digest ? { ok: true, idempotent: true, version: cur.version } : { ok: false, reason: "digest_mismatch" };
      }
      if (r.version < curVersion) return { ok: false, reason: "rollback" };
      if (r.prevVersion !== curVersion) return { ok: false, reason: "cas_conflict", current: curVersion };
      if (r.version <= r.prevVersion) return { ok: false, reason: "version_not_increasing" };
      scopes.set(r.scopeId, { version: r.version, digest: r.digest, publicKey: r.publicKey });
      return { ok: true, idempotent: false, version: r.version };
    }
  };
}

// ---------------------------------------------------------------- trust labels
// anchored_fresh = "the sealed blob equals the anchor's LAST COMMIT". It is never "globally latest":
// an anchor can be withheld, or the owner can have published elsewhere. Same-secret anchors cannot even
// claim that for release, only for local contract tests.
export const TRUST_LABEL = Object.freeze({
  RELEASE_ANCHORED: "anchored_fresh",
  LOCAL_ONLY: "local_proof_only",
  UNVERIFIED: "unverified_fresh"
});

export function trustLabel({ authority, anchorOutcome }) {
  // only verdicts this module created are trusted; any look-alike object is re-classified as a descriptor (and fails closed)
  const v = authority && typeof authority === "object" && OWN_VERDICTS.has(authority) ? authority : classifyAuthority(authority);
  const matched = anchorOutcome === "match";
  let label;
  if (!matched) label = TRUST_LABEL.UNVERIFIED;
  else if (v.releaseGrade) label = TRUST_LABEL.RELEASE_ANCHORED;
  else label = TRUST_LABEL.LOCAL_ONLY;
  return Object.freeze({
    label,
    capability: v.capability,
    releaseGrade: v.releaseGrade && matched,
    globallyLatest: false, // invariant: never claimed
    claim:
      label === TRUST_LABEL.RELEASE_ANCHORED
        ? "matches the anchor's last commit; not proven globally latest"
        : label === TRUST_LABEL.LOCAL_ONLY
          ? "matches a same-secret anchor; the storage holder could forge this; not release-grade"
          : "no matching anchor commit; freshness unverified"
  });
}

const GLOBAL_LATEST_CLAIM = /globally[\s_-]*latest|guaranteed[\s_-]*latest|definitely[\s_-]*latest|always[\s_-]*latest/i;
export function claimsGlobalLatest(text) {
  return GLOBAL_LATEST_CLAIM.test(String(text)) && !/\bnot\b[^.]*globally[\s_-]*latest/i.test(String(text));
}
