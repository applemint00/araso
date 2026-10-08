// [Gate B prototype — LOCAL ONLY] "내가 발급한 모델 A 순번들을 새 기기에서 되찾는다."
//
// 이 파일은 **조언용(advisory) 암호화 백업 blob** 하나만 다룬다: MY PIGGIES 색인에서
// 순번·시각만 뽑아(주소 0 · 이름 0 · locator 0 · PRF 0) 패스키 PRF 로 감싼 봉투로 만들고,
// 새 기기에서는 그 봉투를 열어 **후보 순번**만 얻는다. 후보는 그 자체로 소유를 증명하지
// 않는다 — 각 후보마다 `modelASalt(n)` 로 **실제로 다시 인증하고 주소를 파생한 뒤에야**
// `registerControlledPiggy`(=`bindSigner` 통제 증명)를 거쳐 들어간다. blob 이 주소를
// 준 적은 한 번도 없다.
//
// 순수 함수 + 주입된 deps(subtle · requestPrf · deriveAddress · adapter). 네트워크 0.
// 원격 저장소가 없으면 **조용히 복구된 척하지 않는다** — `{ restored: [], source: "local_only" }`.
//
// 하지 않는 것: 첫 Piggy(레거시, sequence 없음) 복구 — 그건 새 패스키 생성 경로이지
// 이 assertion-only 흐름이 아니다. 워터마크를 blob 의 주장으로 올리지 않는다 — 오직
// `registerControlledPiggy` 가 실제로 확인한 순번만큼만 오른다.

import { admitSequencedPiggy, loadMyPiggiesIndex, myPiggiesIndexKey, myPiggiesLockName } from "./piggy-index.js";

const B64URL = /^[A-Za-z0-9_-]+$/;
const MAX_CANDIDATES = 64;
const PAYLOAD_VERSION = 1;
// [A-579 Lane B] v2 = v1 + `recordVersion`(발행마다 +1 되는 단조 카운터, **봉투 안에 봉인**). 서버는 이 값을
// 위조할 수 없다(AES-GCM) — 다만 옛 봉투 통째 재생은 여전히 가능하다(그 한계는 restoreFromBackup 의 completeness).
const PAYLOAD_VERSION_V2 = 2;
const ENVELOPE_VERSION = 1;

// modelASalt 의 "araso.piggy.v1." 과 겹치지 않는 별도 네임스페이스 — 순번당 salt 가 아니라
// **색인 전체**를 위한 salt 하나다.
export const INDEX_BACKUP_NAMESPACE_SOURCE = "araso.index.v1";
const HKDF_INFO = new TextEncoder().encode("araso.v1.index.backup");

const PAYLOAD_FIELDS = Object.freeze(["version", "chainId", "issuedThrough", "entries"]);
const PAYLOAD_FIELDS_V2 = Object.freeze([...PAYLOAD_FIELDS, "recordVersion"]);
const ENTRY_FIELDS = Object.freeze(["sequence", "createdAt"]);

// ---- base64url (btoa/atob — Node 18+ · 브라우저 모두 전역) ------------------------------------
function base64UrlEncode(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- salt · payload · 봉투 ------------------------------------------------------------------

/** blob 하나를 감싸는 고정 PRF salt. 순번 salt 와 절대 겹치지 않는다. */
export async function indexBackupSalt({ subtle = globalThis.crypto?.subtle } = {}) {
  if (!subtle || typeof subtle.digest !== "function") throw new Error("crypto_unavailable");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(INDEX_BACKUP_NAMESPACE_SOURCE));
  return new Uint8Array(digest);
}

/**
 * 색인 → blob 페이로드. **순번·시각만** — 이름·주소·locator·PRF 는 절대 담지 않는다.
 * 순번 없는 줄(레거시 첫 Piggy)은 이 백업의 대상이 아니다.
 */
export function buildBackupPayload(index, { recordVersion = null } = {}) {
  const chainId = typeof index?.chainId === "string" ? index.chainId : null;
  const issuedThrough = Number.isSafeInteger(index?.issuedThrough) && index.issuedThrough >= 0 ? index.issuedThrough : 0;
  const entries = Array.isArray(index?.piggies)
    ? index.piggies
        .filter((p) => Number.isSafeInteger(p?.sequence) && p.sequence >= 1)
        .map((p) => ({ sequence: p.sequence, createdAt: typeof p.createdAt === "string" ? p.createdAt : null }))
    : [];
  if (Number.isSafeInteger(recordVersion) && recordVersion >= 1) {
    return { version: PAYLOAD_VERSION_V2, chainId, issuedThrough, entries, recordVersion };
  }
  return { version: PAYLOAD_VERSION, chainId, issuedThrough, entries };
}

async function deriveBackupKey(prfOutput, subtle) {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length !== 32) throw new Error("invalid_prf_output");
  const material = await subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: HKDF_INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** payload → 봉투(HKDF-SHA256 → AES-256-GCM, 무작위 12B nonce). */
export async function sealBackup(payload, prfOutput, { subtle = globalThis.crypto?.subtle } = {}) {
  if (!subtle || typeof subtle.importKey !== "function") throw new Error("crypto_unavailable");
  const rng = globalThis.crypto?.getRandomValues;
  if (typeof rng !== "function") throw new Error("crypto_unavailable");
  const key = await deriveBackupKey(prfOutput, subtle);
  const nonce = new Uint8Array(12);
  rng.call(globalThis.crypto, nonce);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext);
  return { version: ENVELOPE_VERSION, nonce: base64UrlEncode(nonce), ciphertext: base64UrlEncode(new Uint8Array(ciphertext)) };
}

/** 신뢰하지 않는 봉투(JSON 문자열이든 객체든) 모양 검사. 틀리면 열기 전에 거부. */
function parseEnvelope(value) {
  let env = value;
  if (typeof value === "string") {
    try { env = JSON.parse(value); } catch { return { envelope: null, error: "corrupt" }; }
  }
  if (!env || typeof env !== "object" || Array.isArray(env)) return { envelope: null, error: "corrupt" };
  if (env.version !== ENVELOPE_VERSION) return { envelope: null, error: "version" };
  const nonce = typeof env.nonce === "string" && B64URL.test(env.nonce) ? env.nonce : null;
  const ciphertext = typeof env.ciphertext === "string" && B64URL.test(env.ciphertext) ? env.ciphertext : null;
  if (!nonce || !ciphertext) return { envelope: null, error: "corrupt" };
  return { envelope: { version: ENVELOPE_VERSION, nonce, ciphertext }, error: null };
}

/** 복호화된 평문의 모양 검사. 허용 필드 밖은 통째로 버림(줄 하나 버리는 게 아니라 payload 전체). */
function validatePayload(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const v2 = parsed.version === PAYLOAD_VERSION_V2;
  if (!v2 && parsed.version !== PAYLOAD_VERSION) return null;
  if (Object.keys(parsed).some((k) => !(v2 ? PAYLOAD_FIELDS_V2 : PAYLOAD_FIELDS).includes(k))) return null;
  let recordVersion = null;
  if (v2) {
    if (!Number.isSafeInteger(parsed.recordVersion) || parsed.recordVersion < 1) return null;
    recordVersion = parsed.recordVersion;
  }
  if (!Array.isArray(parsed.entries)) return null;
  const issuedThrough = Number.isSafeInteger(parsed.issuedThrough) && parsed.issuedThrough >= 0 ? parsed.issuedThrough : null;
  if (issuedThrough === null) return null;
  const entries = [];
  for (const e of parsed.entries) {
    if (!e || typeof e !== "object" || Array.isArray(e)) return null;
    if (Object.keys(e).some((k) => !ENTRY_FIELDS.includes(k))) return null;
    if (!Number.isSafeInteger(e.sequence) || e.sequence < 1) return null;
    entries.push({ sequence: e.sequence, createdAt: typeof e.createdAt === "string" ? e.createdAt : null });
  }
  const chainId = typeof parsed.chainId === "string" ? parsed.chainId : null;
  if (v2) return { version: PAYLOAD_VERSION_V2, chainId, issuedThrough, entries, recordVersion };
  return { version: PAYLOAD_VERSION, chainId, issuedThrough, entries };
}

// ---- [A-579 Lane B] 로컬 기준선(baseline) — 이 기기가 **진짜로 본(AEAD 로 열린)** 가장 최신 발행 ------------
// 키에 credentialId·주소·locator 가 들어가지 않는다(체인 범위만). 값 = { version, chainId, recordVersion, issuedThrough }.
// 단조: 두 값 모두 내려가지 않는다. 이 기준선이 있는 기기에 더 옛 봉투가 오면 후보 인증 **전에** 거부한다.
// 기준선이 없는 새 기기는 신선도를 증명할 수 없다 → completeness 는 절대 "complete" 가 되지 않는다.
const BASELINE_PREFIX = "araso.gateBBackupBaseline.v1";
const BASELINE_VERSION = 1;

export function backupBaselineKey(chainId) {
  const chain = typeof chainId === "string" ? chainId.trim() : "";
  return chain ? `${BASELINE_PREFIX}.${chain}` : null;
}

export function readBackupBaseline(storage, chainId) {
  const key = backupBaselineKey(chainId);
  if (!key || !storage) return null;
  let raw = null;
  try { raw = storage.getItem(key); } catch { return null; }
  if (!raw) return null;
  let v = null;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || v.version !== BASELINE_VERSION || v.chainId !== chainId) return null;
  if (!Number.isSafeInteger(v.recordVersion) || v.recordVersion < 0) return null;
  if (!Number.isSafeInteger(v.issuedThrough) || v.issuedThrough < 0) return null;
  return { recordVersion: v.recordVersion, issuedThrough: v.issuedThrough };
}

function raiseBackupBaseline(storage, chainId, { recordVersion = 0, issuedThrough = 0 } = {}) {
  const key = backupBaselineKey(chainId);
  if (!key || !storage) return false;
  const prev = readBackupBaseline(storage, chainId) || { recordVersion: 0, issuedThrough: 0 };
  const next = {
    version: BASELINE_VERSION,
    chainId,
    recordVersion: Math.max(prev.recordVersion, Number.isSafeInteger(recordVersion) ? recordVersion : 0),
    issuedThrough: Math.max(prev.issuedThrough, Number.isSafeInteger(issuedThrough) ? issuedThrough : 0),
  };
  try { storage.setItem(key, JSON.stringify(next)); return true; } catch { return false; }
}

/**
 * 봉투 → payload. **fail-closed**: 손상/버전/복호화 실패는 각각 다른 사유로,
 * 절대 "일단 빈 걸로" 조용히 넘어가지 않는다(호출자가 판단하게 사유를 넘긴다).
 * @returns {payload}|{error: "corrupt"|"version"|"decrypt_failed"}
 */
export async function openBackup(envelope, prfOutput, { subtle = globalThis.crypto?.subtle } = {}) {
  const { envelope: env, error: parseError } = parseEnvelope(envelope);
  if (parseError) return { payload: null, error: parseError };
  if (!subtle || typeof subtle.importKey !== "function") return { payload: null, error: "decrypt_failed" };

  let key;
  try {
    key = await deriveBackupKey(prfOutput, subtle);
  } catch {
    return { payload: null, error: "decrypt_failed" };
  }

  let plaintextBytes;
  try {
    const nonce = base64UrlDecode(env.nonce);
    const ciphertext = base64UrlDecode(env.ciphertext);
    plaintextBytes = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  } catch {
    return { payload: null, error: "decrypt_failed" };            // 잘못된 PRF · 위조된 ciphertext 모두 여기로
  }

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintextBytes));
  } catch {
    return { payload: null, error: "corrupt" };
  }
  const payload = validatePayload(parsed);
  if (!payload) return { payload: null, error: "corrupt" };
  return { payload, error: null };
}

// ---- [A-857] 신선도 앵커 — 공급자 중립 경계(인터페이스만) -------------------------------------------------
// anchor = { get(scope) -> {recordVersion, envelopeDigest} | null (못 닿으면 throw),
//            advance(scope, prevVersion, nextVersion, envelopeDigest, proof) -> record (CAS on prevVersion; 같은 (next,digest) 재호출 = 멱등) }
// 앵커는 **신선도 힌트**일 뿐이다. 안전(후보 통제 증명 · AEAD · 체인/기준선 검사)은 앵커에 의존하지 않는다 —
// 앵커는 오직 (a) 더 옛 봉투를 거부하거나 (b) completeness 를 unverified_fresh → local_proof_only / anchored_fresh(A-876: 출시 등급 훅만) 로 올릴 수 있다. "complete" 는 없다.
// 앵커 응답은 **신뢰하지 않는 입력**: 엄격한 모양 검사에 실패하면 "못 닿음"으로 취급한다(증거로 쓰지 않는다).
export const ANCHOR_MAX_VERSION = 2 ** 31;   // DEFAULT TAKEN / Owner to confirm — 악의적 앵커의 터무니없는 버전 주장 상한
const HEX64_RE = /^[0-9a-f]{64}$/;
const ANCHOR_WRITE_INFO = new TextEncoder().encode("araso.gateb.v1.anchor.write");

export function hasGateBAnchor(anchor) {
  return !!anchor && typeof anchor.get === "function" && typeof anchor.advance === "function";
}

/** 앵커 레코드 검사: 정확히 {recordVersion, envelopeDigest}. 실패 시 null(= 증거 아님). */
export function normalizeAnchorRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 2 || !keys.includes("recordVersion") || !keys.includes("envelopeDigest")) return null;
  if (!Number.isSafeInteger(raw.recordVersion) || raw.recordVersion < 1 || raw.recordVersion > ANCHOR_MAX_VERSION) return null;
  if (typeof raw.envelopeDigest !== "string" || !HEX64_RE.test(raw.envelopeDigest)) return null;
  return { recordVersion: raw.recordVersion, envelopeDigest: raw.envelopeDigest };
}

/** 봉투 → SHA-256 hex over "version|nonce|ciphertext". DEFAULT TAKEN / Owner to confirm. 모양이 틀리면 null. */
export async function computeEnvelopeDigest(envelope, { subtle = globalThis.crypto?.subtle } = {}) {
  const { envelope: env, error } = parseEnvelope(envelope);
  if (error || !subtle || typeof subtle.digest !== "function") return null;
  const bytes = new TextEncoder().encode(`${env.version}|${env.nonce}|${env.ciphertext}`);
  return [...new Uint8Array(await subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 앵커 쓰기 증명(기본 구현, 인터페이스 경계): 이미 얻은 색인 PRF 출력에서 HKDF("araso.gateb.v1.anchor.write") 로 MAC 키를
 * 만들고 HMAC-SHA256("scope|prev|next|digest"). 추가 의식 0 · credentialId/주소 미전송. DEFAULT TAKEN / Owner to confirm.
 */
export async function makeAnchorWriteProof({ prfOutput, scope, prevVersion, nextVersion, envelopeDigest }, { subtle = globalThis.crypto?.subtle } = {}) {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length !== 32) throw new Error("invalid_prf_output");
  if (!subtle || typeof subtle.importKey !== "function") throw new Error("crypto_unavailable");
  const ikm = await subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: ANCHOR_WRITE_INFO }, ikm, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  const sig = await subtle.sign("HMAC", key, new TextEncoder().encode(`${scope}|${prevVersion}|${nextVersion}|${envelopeDigest}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- [A-876] 출시 등급 증명 경계 — releaseProof 어댑터 훅(공급자 중립, 선택, 기본 없음) ---------------------------
// A-857 HMAC 앵커는 대칭(SAME_SECRET): 검증자가 쓰기 증명을 위조할 수 있다 → 일치해도 **local_proof_only** 일 뿐이다.
// `anchored_fresh` 는 A-871 출시 등급 능력(ASYMMETRIC_VERIFIER / INDEPENDENT_ANCHOR)이 훅으로 주입됐을 때만 붙는다.
// 이 파일은 A-871 모듈을 import 하지 않는다(그 모듈은 격리 유지) — 호출자가 A-871 의 판정을 훅으로 넘긴다:
//   releaseProof = {
//     trust({ anchorOutcome: "match"|"no_match" }) -> { label, capability, releaseGrade, globallyLatest:false }
//                                             (= A-871 trustLabel({ authority: verdict, anchorOutcome }) 그대로)
//     makeProof?({ scope, prevVersion, nextVersion, envelopeDigest }) -> { challenge, signature, publicKey }
//                                             (출시 등급 발행 전용 · PRF 출력은 넘기지 않는다)
//     verifyProof?(tuple, proof) -> boolean    (업로드 전 로컬 자기 검사, 선택)
//   }
// 훅의 답은 **신뢰하지 않는 입력**: 모양이 틀리거나, throw 하거나, 능력·라벨·releaseGrade 가 서로 어긋나면 출시 등급이 아니다
// (fail closed → 일치해도 local_proof_only). 훅이 없으면 앵커 일치는 local_proof_only. 앵커 자체가 없으면 기존 경로 그대로.
export const RELEASE_TRUST = Object.freeze({ ANCHORED: "anchored_fresh", LOCAL_ONLY: "local_proof_only", UNVERIFIED: "unverified_fresh" });
const RELEASE_CAPABILITIES = Object.freeze(["asymmetric_verifier", "independent_anchor"]);
const KNOWN_CAPABILITIES = Object.freeze([...RELEASE_CAPABILITIES, "same_secret", "unknown"]);
const RELEASE_PROOF_FIELDS = Object.freeze(["challenge", "signature", "publicKey"]);
const HEX128_RE = /^[0-9a-f]{128}$/;

/**
 * [A-876 F2/F3] 훅을 **한 번** 읽어 스냅숏을 만든다. 모든 속성 접근(getter 포함)·호출이 try 안에 있다 — 절대 throw 하지 않는다.
 * @returns {{ wellFormed: boolean, answer: {label, capability, releaseGrade, globallyLatest}|null, makeProof: fn|null, verifyProof: fn|null }}
 * wellFormed = 답이 정확한 모양(label 3종 · capability 4종 · releaseGrade/globallyLatest boolean)일 때만. 그 밖(throw·모양 불량) = false.
 */
async function readReleaseHook(releaseProof) {
  const broken = { wellFormed: false, answer: null, makeProof: null, verifyProof: null };
  try {
    const trustFn = releaseProof.trust;
    const makeProof = releaseProof.makeProof;
    const verifyProof = releaseProof.verifyProof;
    if (typeof trustFn !== "function") return broken;
    const t = await trustFn.call(releaseProof, { anchorOutcome: "match" });
    if (!t || typeof t !== "object" || Array.isArray(t)) return broken;
    const answer = { label: t.label, capability: t.capability, releaseGrade: t.releaseGrade, globallyLatest: t.globallyLatest };   // 필드 1회 스냅숏
    const wellFormed = Object.values(RELEASE_TRUST).includes(answer.label)
      && KNOWN_CAPABILITIES.includes(answer.capability)
      && typeof answer.releaseGrade === "boolean"
      && typeof answer.globallyLatest === "boolean";
    return {
      wellFormed,
      answer: wellFormed ? answer : null,
      makeProof: typeof makeProof === "function" ? makeProof : null,
      verifyProof: typeof verifyProof === "function" ? verifyProof : null,
    };
  } catch {
    return broken;
  }
}

function isReleaseAnswer(a) {
  return !!a && a.label === RELEASE_TRUST.ANCHORED && a.releaseGrade === true && a.globallyLatest === false && RELEASE_CAPABILITIES.includes(a.capability);
}
/** 명시적 SAME_SECRET/UNKNOWN 답(= A-871 trustLabel 의 비출시 답) — 발행에서 레거시 HMAC 경로를 유지해도 되는 유일한 경우. */
function isExplicitNonReleaseAnswer(a) {
  return !!a && (a.capability === "same_secret" || a.capability === "unknown") && a.releaseGrade === false && a.globallyLatest === false && a.label !== RELEASE_TRUST.ANCHORED;
}

/** 훅 판정 → 이 경계가 인정하는 신뢰 상태. matched=false 면 항상 unverified. 출시 등급은 모든 조건이 서로 맞을 때만. 절대 throw 하지 않는다. */
export async function resolveReleaseTrust(releaseProof, { matched } = {}) {
  if (!matched) return { label: RELEASE_TRUST.UNVERIFIED, capability: "unknown", releaseGrade: false, globallyLatest: false };
  const local = (capability) => ({ label: RELEASE_TRUST.LOCAL_ONLY, capability: KNOWN_CAPABILITIES.includes(capability) ? capability : "unknown", releaseGrade: false, globallyLatest: false });
  if (!releaseProof) return local("same_secret");   // 훅 없음 = A-857 HMAC 기본 = SAME_SECRET
  const hook = await readReleaseHook(releaseProof);
  if (!hook.wellFormed) return local("unknown");
  const a = hook.answer;
  return isReleaseAnswer(a) ? { label: RELEASE_TRUST.ANCHORED, capability: a.capability, releaseGrade: true, globallyLatest: false } : local(a.capability);
}

/** 출시 등급 증명 업로드 모양: 정확히 {challenge(64hex), signature(128hex), publicKey(64hex)}. 그 밖의 키(credentialId·주소·PRF·키) 0. */
function normalizeReleaseProof(proof) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return null;
  const keys = Object.keys(proof);
  if (keys.length !== RELEASE_PROOF_FIELDS.length || keys.some((k) => !RELEASE_PROOF_FIELDS.includes(k))) return null;
  const { challenge, signature, publicKey } = proof;
  if (typeof challenge !== "string" || !HEX64_RE.test(challenge)) return null;
  if (typeof signature !== "string" || !HEX128_RE.test(signature)) return null;
  if (typeof publicKey !== "string" || !HEX64_RE.test(publicKey)) return null;
  return Object.freeze({ challenge, signature, publicKey });   // 원시값 복사본 — getter/후속 변경이 업로드에 닿지 않는다
}

// ---- 후보 순번 ------------------------------------------------------------------------------

/**
 * payload → 시도해 볼 순번 목록. **후보일 뿐 소유가 아니다** — 정렬·중복 제거·
 * `localIssuedThrough` 이하(이미 있음) 제외·blob 자신의 `issuedThrough` 초과(자기모순) 제외·
 * 최대 `MAX_CANDIDATES`개로 자른다.
 */
export function restoreCandidates(payload, { localIssuedThrough = 0 } = {}) {
  if (!payload || !Array.isArray(payload.entries)) return [];
  const issuedThrough = Number.isSafeInteger(payload.issuedThrough) && payload.issuedThrough >= 0 ? payload.issuedThrough : 0;
  const local = Number.isSafeInteger(localIssuedThrough) && localIssuedThrough >= 0 ? localIssuedThrough : 0;
  const set = new Set();
  for (const entry of payload.entries) {
    const n = entry?.sequence;
    if (!Number.isSafeInteger(n) || n < 1) continue;
    if (n > issuedThrough) continue;   // blob 이 스스로 밝힌 워터마크보다 큰 항목 = 무시
    if (n <= local) continue;          // 이미 로컬에 있음 = 복원할 필요 없음
    set.add(n);
  }
  return [...set].sort((a, b) => a - b).slice(0, MAX_CANDIDATES);
}

// ---- 원격 어댑터(로컬 전용 프로토타입 — 진짜 네트워크 어댑터는 이후) ------------------------------------

/** 테스트/로컬 전용 인메모리 어댑터. get/put 만 있으면 무엇이든 어댑터로 쓸 수 있다. */
export function createMemoryBackupAdapter(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) { return data.has(key) ? data.get(key) : null; },
    async put(key, value) { data.set(key, value); },
  };
}

function refuse(source, error) {
  return { restored: [], source, error };
}

/**
 * 새 기기에서 Gate B 복원. 순서: ① 원격에서 봉투 가져오기(없으면 local_only) ②
 * `indexBackupSalt` 로 PRF → 봉투 열기 ③ 후보 계산 ④ 후보마다 **실제로**
 * `modelASalt(n)` 로 다시 인증 → 주소 파생 → `registerControlledPiggy`(=통제 증명 후에만 입장).
 * blob 은 한 번도 주소를 주지 않는다 — 매번 라이브 파생이다.
 */
export async function restoreFromBackup({
  adapter,
  key,
  storage,
  chainId,
  pinnedCredential,
  requestPrf,
  deriveAddress,
  locks = null,
  now = () => new Date().toISOString(),
  subtle = globalThis.crypto?.subtle,
  discoveryRecord = null,
  anchor = null,
  anchorScope = null,
  releaseProof = null,
} = {}) {
  if (!adapter || typeof adapter.get !== "function") return { restored: [], source: "local_only" };
  // [A-579 Lane B] discovery 가 "이 루트는 발행 기록이 있다(recordVersion ≥ 1)" 고 말했는데 봉투가 없거나 못 닿으면
  // 그건 "아직 없음" 이 아니라 **서버 불일치/보류**다 — local_only 로 조용히 넘기지 않고 거부한다.
  const discoveryVersion = Number.isSafeInteger(discoveryRecord?.recordVersion) ? discoveryRecord.recordVersion : null;
  const expectsBlob = discoveryVersion !== null && discoveryVersion >= 1;
  let raw;
  try {
    raw = await adapter.get(key);
  } catch {
    if (expectsBlob) return refuse("remote", "backup_unavailable");
    return { restored: [], source: "local_only" };   // 원격에 못 닿음 = 없는 것과 같이 취급(조용히 성공한 척 안 함)
  }
  if (!raw) {
    if (expectsBlob) return refuse("remote", "backup_missing");
    return { restored: [], source: "local_only" };
  }

  const rootId = typeof pinnedCredential?.credentialId === "string" ? pinnedCredential.credentialId : "";
  if (!rootId) return refuse("remote", "missing_root_credential");
  if (typeof requestPrf !== "function" || typeof deriveAddress !== "function") return refuse("remote", "missing_auth_provider");
  const pinned = { credentialId: rootId, ...(Array.isArray(pinnedCredential.transports) && pinnedCredential.transports.length ? { transports: pinnedCredential.transports } : {}) };

  const indexSalt = await indexBackupSalt({ subtle });
  let indexPrf;
  try {
    indexPrf = await requestPrf(pinned, indexSalt);
  } catch {
    return refuse("remote", "auth_failed");
  }
  if (!indexPrf || indexPrf.credentialId !== rootId) return refuse("remote", "root_credential_mismatch");

  // [A-857 R1] 봉투는 한 번만 파싱한다 — 복호화와 앵커 digest 가 **같은 객체**를 쓴다.
  const parsedRaw = parseEnvelope(raw).envelope ?? raw;
  const { payload, error: openError } = await openBackup(parsedRaw, indexPrf.prfOutput, { subtle });
  if (openError) return refuse("remote", openError);

  // [A-554 Lane B 결함 1] blob 이 다른 체인 것이면 후보 계산/인증 시도 전에 즉시 거부한다 —
  // salt(모델 A 순번)는 체인 무관이라 이 검사 없이는 chain-A blob 이 chain-B 색인에 그대로
  // 들어갈 수 있었다. 엄격 비교(===): payload.chainId 가 null 이어도(구버전/손상) 통과시키지 않는다.
  if (payload.chainId !== chainId) return refuse("remote", "chain_mismatch");

  // [A-579 Lane B] 신선도/롤백 — 봉인된 recordVersion(v1 봉투 = 0, 버전 없음) 을 두 기준과 대조한다. 전부 후보 인증 **전**.
  //  ① discovery 레코드의 recordVersion 과 다르면 → 두 서버 저장소가 서로 어긋난다(부분 롤백/교체) → 거부.
  //  ② 이 기기의 로컬 기준선보다 옛 recordVersion / 작은 issuedThrough → 롤백 → 거부.
  //  둘 다 통과해도 **새 기기**에서는 "지금 최신" 을 증명하지 못한다 — completeness 가 그 사실을 그대로 말한다.
  const sealedVersion = payload.recordVersion ?? 0;
  if (discoveryVersion !== null && sealedVersion !== discoveryVersion) return refuse("remote", "record_version_mismatch");
  // [A-857] 신선도 앵커 — 후보 인증 **전**. 앵커가 없으면(제품 기본) 아무 일도 하지 않고 freshnessAnchor = null.
  //  sealed < anchor → anchor_rollback · 같은 버전 다른 digest → anchor_digest_mismatch(둘 다 거부) ·
  //  같은 버전 같은 digest → anchored_fresh(A-871 출시 등급 훅) / local_proof_only(그 밖, A-876) · sealed > anchor / 앵커 없음(null) → ahead_of_anchor · 못 닿음/모양 불량 → unreachable.
  //  어느 경우에도 안전은 앵커에 의존하지 않는다: 앵커는 거부하거나 completeness 를 올리기만 한다.
  let freshnessAnchor = null;
  if (anchor) {
    let rec = null;
    let reachable = false;
    if (hasGateBAnchor(anchor) && typeof anchorScope === "string" && HEX64_RE.test(anchorScope)) {
      try {
        const rawA = await anchor.get(anchorScope);
        if (rawA === null || rawA === undefined) reachable = true;
        else { rec = normalizeAnchorRecord(rawA); reachable = rec !== null; }
      } catch { reachable = false; }
    }
    if (!reachable) {
      freshnessAnchor = { state: "unreachable", anchorVersion: null, sealedVersion };
    } else if (!rec) {
      freshnessAnchor = { state: "ahead_of_anchor", anchorVersion: 0, sealedVersion };
    } else if (sealedVersion < rec.recordVersion) {
      return { ...refuse("remote", "anchor_rollback"), freshnessAnchor: { state: "anchor_rollback", anchorVersion: rec.recordVersion, sealedVersion } };
    } else if (sealedVersion === rec.recordVersion) {
      const digest = await computeEnvelopeDigest(parsedRaw, { subtle });
      if (digest !== rec.envelopeDigest) return { ...refuse("remote", "anchor_digest_mismatch"), freshnessAnchor: { state: "anchor_digest_mismatch", anchorVersion: rec.recordVersion, sealedVersion } };
      // [A-876] 일치 ≠ 출시 등급. anchored_fresh 는 A-871 출시 등급 훅이 있을 때만, 아니면 local_proof_only(SAME_SECRET/UNKNOWN).
      const trust = await resolveReleaseTrust(releaseProof, { matched: true });
      freshnessAnchor = { state: trust.label, anchorVersion: rec.recordVersion, sealedVersion, trust };
    } else {
      freshnessAnchor = { state: "ahead_of_anchor", anchorVersion: rec.recordVersion, sealedVersion };
    }
  }
  // 후보 계산 자체도 admitModelAPiggy 처럼 **잠금 안에서** 최신 상태로 한다(있으면) — 그래야
  // "무엇이 이미 로컬에 있는가"를 읽는 시점과 실제로 쓰는 시점 사이에 다른 탭의 +Piggy/복원이
  // 끼어들 수 없다. registerControlledPiggy 자체도 매 호출마다 색인을 다시 읽어 재검증하므로
  // (stale_sequence 등) 잠금 없이도 안전하게 실패하지만, 잠금이 있으면 후보 목록 자체가
  // 최신 상태를 반영한다.
  const admitCandidates = async () => {
    const baseline = readBackupBaseline(storage, chainId);
    if (baseline && sealedVersion < baseline.recordVersion) return refuse("remote", "stale_record_version");
    if (baseline && payload.issuedThrough < baseline.issuedThrough) return refuse("remote", "stale_issued_through");

    const localIssuedThrough = loadMyPiggiesIndex(storage, chainId).index.issuedThrough || 0;
    const candidates = restoreCandidates(payload, { localIssuedThrough });
    const restored = [];
    const skipped = [];
    for (const n of candidates) {
      // [A-579 Lane B · A-572 C6b] 순번 행의 유일한 입장 경로 — salt 는 그 안에서 modelASalt(n) 로 계산되고,
      // 그 salt 로 인증·**라이브 파생**한 주소만 통제 증명과 함께 들어간다. blob 은 주소를 준 적이 없다.
      const out = await admitSequencedPiggy({
        storage,
        chainId,
        sequence: n,
        rootCredential: pinned,
        requestPrf,
        deriveAddress,
        now,
        authErrorReason: () => "auth_failed",
      });
      if (out.ok) restored.push({ sequence: n, address: out.piggy.address });
      else skipped.push({ sequence: n, reason: out.reason });
    }
    // 봉투는 우리 루트 PRF 로 열렸다(AEAD) — 그 안의 주장은 **우리 기기가 과거에 실제로 발행한 값**이다. 기준선을 올린다.
    raiseBackupBaseline(storage, chainId, { recordVersion: sealedVersion, issuedThrough: payload.issuedThrough });
    const restoredThrough = loadMyPiggiesIndex(storage, chainId).index.issuedThrough || 0;
    // completeness — **"complete" 는 없다.** 로컬만으로는 서버가 옛(진짜) 봉투를 통째로 재생하는 것을 새 기기에서 구별할 수 없다.
    //  · incomplete        : 봉투가 주장한 범위(issuedThrough) 중 증명 못 한 순번이 있다(건너뜀/결번).
    //  · unverified_fresh  : 이 기기에 기준선이 없었다 — 신선도 앵커 없음(원격 게이트 GATE_B_FRESHNESS_ANCHOR).
    //  · not_older_than_local_baseline : 기준선보다 옛것은 아니다 — 그래도 다른 기기의 더 새 발행 여부는 모른다.
    //  · anchored_fresh    : [A-857·A-876] 봉투가 앵커의 (recordVersion, digest)와 일치 **그리고** A-871 출시 등급 능력 — 증명 못 한 순번이 없을 때만.
    //  · local_proof_only  : [A-876] 일치했지만 앵커가 SAME_SECRET/UNKNOWN(예: A-857 HMAC) — 저장소 보유자가 위조 가능, 출시 등급 아님.
    const anchorState = freshnessAnchor?.state;
    const completeness = restoredThrough < payload.issuedThrough || skipped.length > 0
      ? "incomplete"
      : (anchorState === "anchored_fresh" || anchorState === "local_proof_only" ? anchorState : (baseline ? "not_older_than_local_baseline" : "unverified_fresh"));
    return {
      restored,
      source: "remote",
      skipped,
      completeness,
      recordVersion: sealedVersion,
      claimedThrough: payload.issuedThrough,
      restoredThrough,
      freshnessAnchor,
    };
  };

  // [A-554 Lane B 부차 결함] `locks` 는 **선택**이다 — admitModelAPiggy 처럼 없으면 무조건
  // 거부(lock_unsupported)하지 않는다. 이유: 이 함수는 gate-b-recovery.js(recoverProductList)를
  // 거쳐 제품에 연결되는데, 거기서는 항상 실제 webLocks()를 넘긴다(main.js §checkPiggy). 이
  // 13개 프로토타입 테스트를 포함해 순수 함수 단위 테스트는 잠금 없이 계속 검증돼야 하므로
  // 여기서 하드 요구로 올리지 않는다 — 직렬화 보장이 필요한 호출자는 `locks`를 넘겨라(넘기면
  // myPiggiesLockName(chainId)의 **같은 잠금 이름**을 admitModelAPiggy 와 공유해 +Piggy 와도 직렬화된다).
  if (locks && typeof locks.request === "function") {
    return locks.request(myPiggiesLockName(chainId), { mode: "exclusive" }, admitCandidates);
  }
  return admitCandidates();
}

/**
 * [A-554] 색인 → 봉투 → adapter.put 까지의 **발행 코어**. 언제/얼마나 자주 부를지(cadence)는
 * 여기서 결정하지 않는다 — 그건 호출자(미정, OWNER_GATE) 몫이다. adapter 가 없으면 완전
 * no-op(요청 PRF 호출 0). 있으면: 색인 읽기 → payload 빌드 → 고정 salt → **고정 루트**로 PRF
 * 요청 1회 → seal → adapter.put. 이 함수도 순번 소유를 만들지 않는다(그건 여전히
 * restoreFromBackup/registerControlledPiggy 몫) — 이건 그저 지금 로컬 색인의 봉투화다.
 */
export async function publishIndexBackup({
  adapter,
  storage,
  chainId,
  rootCredential,
  requestPrf,
  subtle = globalThis.crypto?.subtle,
  anchor = null,
  anchorScope = null,
  makeProof = null,
  releaseProof = null,
} = {}) {
  if (!adapter || typeof adapter.put !== "function") return { published: false, reason: "no_adapter" };
  const rootId = typeof rootCredential?.credentialId === "string" ? rootCredential.credentialId : "";
  if (!rootId) return { published: false, reason: "missing_root_credential" };
  if (typeof requestPrf !== "function") return { published: false, reason: "missing_auth_provider" };
  const pinned = { credentialId: rootId, ...(Array.isArray(rootCredential.transports) && rootCredential.transports.length ? { transports: rootCredential.transports } : {}) };

  // [A-579 Lane B] 발행 키 = restoreFromBackup/recoverProductList 가 읽는 바로 그 키(myPiggiesIndexKey). 이전에는
  // `chainId` 아래에 써서 복원 쪽(myPiggiesIndexKey)과 어긋났다 — 발행한 봉투를 복원이 못 찾는 결함.
  const key = myPiggiesIndexKey(chainId);
  if (!key) return { published: false, reason: "invalid_chain" };
  const { index } = loadMyPiggiesIndex(storage, chainId);
  const salt = await indexBackupSalt({ subtle });
  let result;
  try {
    result = await requestPrf(pinned, salt);
  } catch {
    return { published: false, reason: "auth_failed" };
  }
  if (!result || result.credentialId !== rootId) return { published: false, reason: "root_credential_mismatch" };

  // [A-579 Lane B] 발행이 **스스로 롤백하지 않게**: 이미 있는 봉투를 같은 PRF 로 열어 보고, 로컬 색인이 그보다
  // 작으면(예: 복원 전 새 기기) 덮어쓰지 않는다. 열 수 없는 봉투(다른 루트/손상)도 덮어쓰지 않는다(fail closed).
  let prior = 0;
  let priorIssued = 0;
  if (typeof adapter.get === "function") {
    let existing = null;
    try {
      existing = await adapter.get(key);
    } catch {
      return { published: false, reason: "adapter_get_failed" };
    }
    if (existing) {
      const { payload: before, error } = await openBackup(existing, result.prfOutput, { subtle });
      if (error) return { published: false, reason: "existing_unverifiable" };
      if (before.chainId !== chainId) return { published: false, reason: "chain_mismatch" };
      prior = before.recordVersion ?? 0;
      priorIssued = before.issuedThrough;
    }
  }
  const baseline = readBackupBaseline(storage, chainId);
  if (baseline) {
    prior = Math.max(prior, baseline.recordVersion);
    priorIssued = Math.max(priorIssued, baseline.issuedThrough);
  }
  if ((index.issuedThrough || 0) < priorIssued) return { published: false, reason: "would_regress" };
  // [A-857] 앵커 읽기(최선 노력) — 기준선이 지워진 기기가 앵커보다 낮은 버전을 발행해 스스로 잠기는 것을 막는다.
  let anchorRec = null;
  let anchorReadable = false;
  if (anchor) {
    if (hasGateBAnchor(anchor) && typeof anchorScope === "string" && HEX64_RE.test(anchorScope)) {
      try {
        const rawA = await anchor.get(anchorScope);
        if (rawA === null || rawA === undefined) anchorReadable = true;
        else { anchorRec = normalizeAnchorRecord(rawA); anchorReadable = anchorRec !== null; }
      } catch { anchorReadable = false; }
    }
    // [A-857 F1] 앵커가 **이 기기가 본 적 없는** 버전을 알고 있으면(열린 blob · 로컬 기준선 어느 쪽보다도 높음) 발행하지 않는다 —
    // 서버가 blob 을 숨긴 사이 작은 색인으로 발행하면 앵커가 퇴행한 blob 을 보증(anchored_fresh)하게 된다. put 이전에 거부.
    if (anchorRec && anchorRec.recordVersion > prior) return { published: false, reason: "anchor_unseen_state" };
    if (anchorRec) prior = Math.max(prior, anchorRec.recordVersion);
  }
  const recordVersion = prior + 1;
  const payload = buildBackupPayload(index, { recordVersion });

  const envelope = await sealBackup(payload, result.prfOutput, { subtle });
  try {
    await adapter.put(key, envelope);
  } catch {
    return { published: false, reason: "adapter_put_failed" };
  }
  raiseBackupBaseline(storage, chainId, { recordVersion, issuedThrough: payload.issuedThrough });
  if (!anchor) return { published: true, reason: null, key, recordVersion };

  // [A-857] 순서: blob put → 로컬 기준선 → anchor.advance. blob 이 먼저라서 advance 가 실패해도 앵커가 blob 을 앞서지 않는다
  // (= publish 잠금 없음). 실패해도 published 는 true(blob 은 이미 공개) — 다음 발행이 멱등하게 다시 시도한다.
  const anchorOut = { advanced: false, reason: null };
  // [A-876] releaseProof 훅이 있을 때만 능력을 보고한다(없으면 A-857 결과 모양 그대로).
  // [A-876 F2] 훅이 있으면: 출시 등급 답 → 비대칭 증명 경로 · 명시적 SAME_SECRET/UNKNOWN 답 → 레거시 HMAC 경로 ·
  //  그 밖(throw·모양 불량·모순된 답) → release_proof_unavailable, advance 0 (HMAC 로 조용히 내려가지 않는다, prfOutput 를 넘기지 않는다).
  // [A-876 F3] readReleaseHook 은 throw 하지 않는다 — blob put·기준선 상승 뒤라도 published:true 계약이 깨지지 않는다.
  const hook = releaseProof ? await readReleaseHook(releaseProof) : null;
  const release = hook
    ? (hook.wellFormed && isReleaseAnswer(hook.answer)
      ? { mode: "release", capability: hook.answer.capability }
      : hook.wellFormed && isExplicitNonReleaseAnswer(hook.answer)
        ? { mode: "legacy", capability: hook.answer.capability }
        : { mode: "unavailable", capability: hook.wellFormed ? hook.answer.capability : "unknown" })
    : null;
  if (release) anchorOut.capability = release.capability;
  if (!anchorReadable) {
    anchorOut.reason = "anchor_unreachable";
  } else if (release?.mode === "unavailable") {
    anchorOut.reason = "release_proof_unavailable";
  } else {
    try {
      const envelopeDigest = await computeEnvelopeDigest(envelope, { subtle });
      const prevVersion = anchorRec ? anchorRec.recordVersion : 0;
      let proof;
      if (release?.mode === "release") {
        // [A-876] 출시 등급 경로: 대칭(HMAC) 기본 증명으로 **절대** 내려가지 않는다. 훅의 비대칭 증명만, 업로드 모양 검사 뒤에만.
        // 훅에는 PRF 출력을 넘기지 않는다 — 튜플(scope·버전·digest)만.
        if (!hook.makeProof) throw new Error("release_proof_unavailable");
        const tuple = Object.freeze({ scope: anchorScope, prevVersion, nextVersion: recordVersion, envelopeDigest });
        let rawProof;
        try { rawProof = await hook.makeProof.call(releaseProof, tuple); } catch { throw new Error("release_proof_unavailable"); }
        proof = normalizeReleaseProof(rawProof);
        if (!proof) throw new Error("release_proof_mismatch");
        if (hook.verifyProof) {
          let selfOk = false;
          try { selfOk = (await hook.verifyProof.call(releaseProof, tuple, proof)) === true; } catch { selfOk = false; }
          if (!selfOk) throw new Error("release_proof_mismatch");
        }
      } else {
        const proofArgs = { prfOutput: result.prfOutput, scope: anchorScope, prevVersion, nextVersion: recordVersion, envelopeDigest };
        proof = typeof makeProof === "function" ? await makeProof(proofArgs) : await makeAnchorWriteProof(proofArgs, { subtle });
      }
      await anchor.advance(anchorScope, prevVersion, recordVersion, envelopeDigest, proof);
      anchorOut.advanced = true;
    } catch (e) {
      const m = typeof e?.message === "string" ? e.message : "";
      anchorOut.reason = ["anchor_cas_conflict", "anchor_write_unauthorized", "anchor_downgrade", "release_proof_unavailable", "release_proof_mismatch"].includes(m) ? m : "anchor_unreachable";
    }
  }
  return { published: true, reason: null, key, recordVersion, anchor: anchorOut };
}
