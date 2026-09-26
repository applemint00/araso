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

  const { payload, error: openError } = await openBackup(raw, indexPrf.prfOutput, { subtle });
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
    const completeness = restoredThrough < payload.issuedThrough || skipped.length > 0
      ? "incomplete"
      : (baseline ? "not_older_than_local_baseline" : "unverified_fresh");
    return {
      restored,
      source: "remote",
      skipped,
      completeness,
      recordVersion: sealedVersion,
      claimedThrough: payload.issuedThrough,
      restoredThrough,
      freshnessAnchor: null,
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
  const recordVersion = prior + 1;
  const payload = buildBackupPayload(index, { recordVersion });

  const envelope = await sealBackup(payload, result.prfOutput, { subtle });
  try {
    await adapter.put(key, envelope);
  } catch {
    return { published: false, reason: "adapter_put_failed" };
  }
  raiseBackupBaseline(storage, chainId, { recordVersion, issuedThrough: payload.issuedThrough });
  return { published: true, reason: null, key, recordVersion };
}
