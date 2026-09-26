// [A-512] Gate C — **selected Piggy == active signer.**
//
// 이 파일은 순수 규칙만 담는다(네트워크 0 · 서명 0 · 저장 0). main.js 가 이 규칙으로
// 선택·인증·서명자·권한을 한 줄로 묶는다.
//
// 지키는 것:
//  · 한 번에 **고른 Piggy 는 하나**다(id + 주소).
//  · Piggy 를 바꾸면 **이전 권한이 먼저 죽는다** — 세션 종료, 쓰지 않은 봉투 폐기, 의도/충전 초기화.
//  · Face ID/passkey 는 **그 Piggy 의 locator** 로만 묻는다. 전역 credential 한 칸으로 떨어지지 않는다.
//  · 파생된 서명자 주소가 **고른 Piggy 주소와 다르면** 그 자리에서 멈춘다.
//
// 계정 모델 [A-528 Owner 결정 · A-531 반영]:
//  · 보통 추가 Piggy = **모델 A** — 기존 Mera 패스키 하나 + 순번 salt(`modelASalt(n)`, 아래). 첫 Piggy 는 기본 salt 그대로.
//  · locator 는 여전히 일반형이다(credentialId · transports · prfSalt) — 미래의 예외(예: 고액 Piggy 별도 패스키)도 담을 수 있다.
//  · (이력: A-512 당시 이 주석은 "자격증명/루트 모델 선택 — OPEN" 이었다.)
// 하지 않는 것:
//  · owner 인덱스 영속 구조. 공유 루트를 보안 격리·프라이버시로 부르지 않는다.
//  · locator 는 **비밀이 아니다**: credentialId · transports · prfSalt · 주소. PRF 출력·키는 여기 오지 않는다.

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const SALT_HEX = /^[0-9a-fA-F]{64}$/;
const TRANSPORTS = Object.freeze(["usb", "nfc", "ble", "hybrid", "internal", "smart-card"]);

function lower(a) {
  return typeof a === "string" ? a.toLowerCase() : "";
}

/**
 * Piggy 하나를 다시 열 때 필요한 **비밀 아닌** 위치 정보.
 * prfSalt 가 없으면 Mera 기본 salt 를 쓴다는 뜻이다(그 경우 필드 자체가 없다).
 */
export function normalizeLocator(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { locator: null, error: "missing_locator" };
  const credentialId = typeof input.credentialId === "string" ? input.credentialId.trim() : "";
  if (!credentialId || !B64URL.test(credentialId)) return { locator: null, error: "invalid_credential_id" };
  const transports = Array.isArray(input.transports)
    ? input.transports.filter((t) => TRANSPORTS.includes(t))
    : [];
  let prfSalt = null;
  if (input.prfSalt !== undefined && input.prfSalt !== null) {
    if (typeof input.prfSalt !== "string" || !SALT_HEX.test(input.prfSalt)) return { locator: null, error: "invalid_prf_salt" };
    prfSalt = input.prfSalt.toLowerCase();
  }
  return { locator: { credentialId, transports, ...(prfSalt ? { prfSalt } : {}) }, error: null };
}

export function prfSaltFromHex(hex) {
  if (typeof hex !== "string" || !SALT_HEX.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * 이 Piggy 로 Face ID 를 물을 때 쓸 요청. **locator 가 없으면 묻지 않는다** —
 * 전역 credential 이나 "아무 패스키나" 로 떨어지지 않는다.
 */
export function authRequestForPiggy(piggy) {
  if (!piggy || typeof piggy.id !== "string" || piggy.id === "") return { request: null, error: "missing_piggy" };
  if (!ADDR.test(piggy.address || "")) return { request: null, error: "missing_piggy_address" };
  const { locator, error } = normalizeLocator(piggy.locator);
  if (error) return { request: null, error };
  const salt = locator.prfSalt ? prfSaltFromHex(locator.prfSalt) : null;
  return {
    request: {
      piggyId: piggy.id,
      expectedAddress: piggy.address,
      credential: { credentialId: locator.credentialId, ...(locator.transports.length ? { transports: locator.transports } : {}) },
      ...(salt ? { prfSalt: salt } : {}),
    },
    error: null,
  };
}

export function createSelection() {
  return null;
}

/**
 * 고른 Piggy 바꾸기. 다른 Piggy 로 가면 **이전 권한을 먼저 죽이라고** 알려 준다.
 * 같은 Piggy(id + 주소 동일)를 다시 고르면 아무것도 죽이지 않는다.
 *
 * @returns { selection, invalidate, revokeNonce, error }
 */
export function switchSelection(previous, piggy, { heldEnvelope = null } = {}) {
  if (!piggy || typeof piggy.id !== "string" || piggy.id === "") {
    return { selection: previous, invalidate: false, revokeNonce: null, error: "missing_piggy" };
  }
  if (!ADDR.test(piggy.address || "")) {
    return { selection: previous, invalidate: false, revokeNonce: null, error: "missing_piggy_address" };
  }
  const next = Object.freeze({ id: piggy.id, address: piggy.address });
  const same = !!previous && previous.id === next.id && lower(previous.address) === lower(next.address);
  if (same) return { selection: previous, invalidate: false, revokeNonce: null, error: null };
  // 바뀌었다(또는 처음이다) — 이전 것이 무엇이든 **쓸 수 없게** 만든다.
  return {
    selection: next,
    invalidate: true,
    revokeNonce: typeof heldEnvelope?.nonce === "string" ? heldEnvelope.nonce : null,
    error: null,
  };
}

/** 파생된 서명자 주소가 **고른 Piggy 주소와 같은가**. 다르면 그 서명자는 쓰면 안 된다. */
export function bindSigner(selection, derivedAddress) {
  if (!selection || !ADDR.test(selection.address || "")) return { ok: false, reason: "no_selection" };
  if (!ADDR.test(derivedAddress || "")) return { ok: false, reason: "no_signer" };
  if (lower(selection.address) !== lower(derivedAddress)) return { ok: false, reason: "signer_mismatch" };
  return { ok: true, reason: null, signerAddress: derivedAddress };
}

/** 봉투 확인에 넘길 **지금의** 선택/서명자 맥락. */
export function selectionContext(selection, activeSignerAddress) {
  return {
    selectedPiggyId: selection?.id ?? null,
    selectedPiggyAddress: selection?.address ?? null,
    activeSignerAddress: typeof activeSignerAddress === "string" ? activeSignerAddress : null,
  };
}

// ---- [A-531] 모델 A 순번 salt — **계정 파생 계약 v1 (바꾸면 주소가 바뀐다)** -------------------
// source = "araso.piggy.v1." + n (n = 1 이상 정수, 선행 0 없는 10진수) → UTF-8(TextEncoder) → SHA-256 = 32바이트.
// 외부 BIP39/BIP32 의존 0. 관계(부모/Merge/Gift)는 여기 들어오지 않는다 — 파생은 평평하게.
export const MODEL_A_NAMESPACE = "araso.piggy.v1.";

export function modelASaltSource(n) {
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return `${MODEL_A_NAMESPACE}${String(n)}`;
}

export async function modelASalt(n, { subtle = globalThis.crypto?.subtle } = {}) {
  const source = modelASaltSource(n);
  if (!source) throw new Error("invalid_sequence");
  if (!subtle || typeof subtle.digest !== "function") throw new Error("crypto_unavailable");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(source));
  return new Uint8Array(digest);
}

export function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- [A-579 Lane B] 동기 SHA-256 — **순번 ↔ salt 불변식 전용** ------------------------------------
// registerControlledPiggy(동기) 가 sequence 를 받을 때 locator.prfSalt 가 정확히 modelASalt(sequence)
// 인지 **스스로** 확인해야 한다(A-572 C6b: 호출자 규율이 아니라 함수 계약). WebCrypto digest 는
// 비동기라 동기 쓰기 경로에서 쓸 수 없어 FIPS 180-4 SHA-256 을 여기 한 번만 둔다. 계약 바이트는
// modelASalt 와 같다(UTF-8 → SHA-256) — app/test/gate-b-local-core.mjs 가 subtle 결과와 n=1..256 대조.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Sync(bytes) {
  const len = bytes.length;
  const padded = new Uint8Array((((len + 9) + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const bitLen = len * 8;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) odv.setUint32(i * 4, h[i]);
  return out;
}

/** modelASalt(n) 의 소문자 hex — **동기**. n 이 계약 밖이면 null. 바이트는 modelASalt 와 동일. */
export function modelASaltHex(n) {
  const source = modelASaltSource(n);
  if (!source) return null;
  return bytesToHex(sha256Sync(new TextEncoder().encode(source)));
}

// ---- [A-555 S2] Funding-target control proof ------------------------------------------------
// A caller-supplied `signerAddress` string is not proof of anything — anyone can type the
// Piggy's own address into that field. The only thing that proves control of a Piggy's key is a
// **signature** over a fresh, scoped challenge that a live signing session for that Piggy
// produces, recovered back to that Piggy's address. This module only defines the challenge and
// the verification rule (pure — no signing, no network, no storage); main.js produces the
// signature with the real Mera session and injects the matching viem recover function.
//
// Freshness window matches the money-permission envelope (DEFAULT_PERMISSION_TTL_MS) — a proof
// left open in a background tab must not still be usable minutes later.
export const FUNDING_TARGET_PURPOSE = "araso.funding_target.v1";
export const FUNDING_TARGET_MAX_AGE_MS = 2 * 60 * 1000;

/**
 * Canonical string a live signer must sign to prove control of `address` as the funding
 * destination for `piggyId` on `chainId`. Every field is bound into the string — a signature
 * over one {chainId, piggyId, address} triple proves nothing about any other.
 */
export function fundingTargetChallenge({ chainId, piggyId, address, issuedAt, nonce } = {}) {
  if (typeof chainId !== "string" || chainId === "") return { challenge: null, error: "missing_chain" };
  if (typeof piggyId !== "string" || piggyId === "") return { challenge: null, error: "missing_piggy" };
  if (!ADDR.test(address || "")) return { challenge: null, error: "missing_address" };
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return { challenge: null, error: "missing_issued_at" };
  if (typeof nonce !== "string" || nonce === "") return { challenge: null, error: "missing_nonce" };
  return {
    challenge: `${FUNDING_TARGET_PURPOSE}:${chainId}:${piggyId}:${lower(address)}:${issuedAt}:${nonce}`,
    error: null,
  };
}

/**
 * Verifies a funding-target control proof against a specific `piggy` + `chainId`. `recover` is
 * injected (production passes viem's `recoverMessageAddress` over the exact digest the Mera
 * session signs) — this file never imports viem and never signs anything itself.
 *
 * Fails closed with one stable reason (`funding_target_unproven`) for every kind of failure —
 * a caller must not be able to distinguish "wrong signer" from "stale" from "missing" by reason
 * string alone (that would leak an oracle for forging attempts).
 *
 * `consumedNonces`, when given, is a Set the caller owns (module-level in main.js) — a nonce is
 * added to it only once the proof verifies, so the exact same proof can never be replayed.
 */
export async function verifyFundingTargetProof(proof, {
  piggy,
  chainId,
  now = Date.now,
  maxAgeMs = FUNDING_TARGET_MAX_AGE_MS,
  recover,
  consumedNonces = null,
} = {}) {
  const unproven = () => ({ ok: false, reason: "funding_target_unproven" });
  if (!proof || typeof proof !== "object") return unproven();
  if (!piggy || !ADDR.test(piggy.address || "")) return unproven();
  if (typeof chainId !== "string" || chainId === "") return unproven();
  if (typeof recover !== "function") return unproven();
  const { chainId: proofChainId, piggyId, address, issuedAt, nonce, signature } = proof;
  if (proofChainId !== chainId) return unproven();
  if (piggyId !== piggy.id) return unproven();
  if (!ADDR.test(address || "") || lower(address) !== lower(piggy.address)) return unproven();
  if (typeof signature !== "string" || signature === "") return unproven();
  if (typeof nonce !== "string" || nonce === "") return unproven();
  if (consumedNonces && consumedNonces.has(nonce)) return unproven(); // replay
  const nowMs = typeof now === "function" ? now() : now;
  if (!Number.isFinite(nowMs)) return unproven();
  if (!Number.isFinite(issuedAt) || issuedAt > nowMs) return unproven(); // clock lie / not-yet-issued
  if (nowMs - issuedAt > maxAgeMs) return unproven(); // stale

  const { challenge, error: challengeError } = fundingTargetChallenge({ chainId: proofChainId, piggyId, address, issuedAt, nonce });
  if (challengeError) return unproven();

  let recovered;
  try {
    recovered = await recover({ message: challenge, signature });
  } catch {
    return unproven();
  }
  if (typeof recovered !== "string" || lower(recovered) !== lower(piggy.address)) return unproven();

  if (consumedNonces) consumedNonces.add(nonce); // single-use — this exact proof cannot verify twice
  return { ok: true, reason: null };
}
