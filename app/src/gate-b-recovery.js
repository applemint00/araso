// [A-554] Gate B — 제품 복구 오케스트레이터. R1(첫 Piggy 되찾기, main.js checkPiggy/recoverPiggy)
// 은 여기서 다시 만들지 않는다 — 그건 이미 성공했다고 **전제**한다. 이 파일이 하는 일은 딱
// 하나, R1 성공 뒤 "원격 어댑터가 있으면" 추가 Piggy 순번 목록을 index-backup.js 의
// restoreFromBackup 으로 복원해 하나의 **경계 있는 결과**로 접어 돌려주는 것뿐이다.
//
// 하지 않는 것:
//  · 어댑터가 없으면 완전 no-op(인증 호출 0) — local_only 로 조용히 성공한 척하지 않는다.
//  · 이름 복원 — blob 은 이름을 준 적이 없다. 복원된 줄의 이름은 항상 null(NOT_RECOVERED).
//  · $0 탄생 투영(projectBirthUnfunded)/createPiggy 호출 — 복원 = 색인(통제 증명)까지다.
//    평가는 여전히 "모름"이다(가짜 $0 을 만들지 않는다). 그 투영은 호출자(main.js 밖, 이후
//    단계)가 원한다면 몫이다 — 이 orchestrator 는 그 결정을 내리지 않는다.
//  · 원격 저장소 선택/네트워크 — adapter 는 순수 주입값이다.

import { hasGateBAnchor, restoreFromBackup } from "./index-backup.js";

export { hasGateBAnchor };
import { loadMyPiggiesIndex, myPiggiesIndexKey } from "./piggy-index.js";

function lower(a) {
  return typeof a === "string" ? a.toLowerCase() : "";
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// [A-579 Lane B] Gate B v1 — 로컬 코어 ↔ 원격 adapter 경계 (A-572 RECOMMENDATION 구현, 원격 공급자 0)
//
// 서버 권한 = **discovery(멤버십)만.** 서버는 "이 locator 로 등록된 루트가 있다 + recordVersion" 만 말한다.
// 서버는 소유·서명·권한을 주지 않는다 — 그 답은 힌트이고, 실제 통제 증명은 고정된 루트의 PRF 의식이다.
// 서버가 보는 것: 64-hex locator 두 개(discoveryKey · backupScope) · 봉인된 봉투 {version, nonce, ciphertext}
// · 체인 범위 백업 키. 서버가 절대 보지 않는 것: credentialId · hash(credentialId) · 주소 · PRF · 이름 · 잔액.
// 제품 기본 adapter 는 여전히 null(main.js INDEX_BACKUP_ADAPTER) — 여기 있는 것은 인터페이스 + 메모리 adapter 뿐.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** **유일한** Gate B locator 네임스페이스 리터럴. PRF salt 와 HKDF info 둘 다 이 한 문자열에서 나온다. */
export const GATE_B_LOCATOR_NAMESPACE = "araso.gateb.v1.locator";
const LOCATOR_INFO = new TextEncoder().encode(GATE_B_LOCATOR_NAMESPACE);
// 같은 리터럴의 하위 라벨 — 별도 리터럴이 아니다. 루트 레코드와 목록 레코드를 서로 계산 불가능하게 가른다(A-572 C8c).
const BACKUP_SCOPE_INFO = new TextEncoder().encode(`${GATE_B_LOCATOR_NAMESPACE}/piggylist`);
const HEX64 = /^[0-9a-f]{64}$/;
const REF = /^[A-Za-z0-9_-]{8,128}$/;
const ADDR_LIKE = /0x[0-9a-fA-F]{40}/;

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** locator 조회용 고정 PRF salt = SHA-256(UTF-8(GATE_B_LOCATOR_NAMESPACE)). modelASalt·indexBackupSalt 와 다른 도메인. */
export async function gateBLocatorPrfSalt({ subtle = globalThis.crypto?.subtle } = {}) {
  if (!subtle || typeof subtle.digest !== "function") throw new Error("crypto_unavailable");
  return new Uint8Array(await subtle.digest("SHA-256", LOCATOR_INFO));
}

/**
 * PRF 출력 → 서버에 보낼 두 locator. HKDF-SHA256(ikm = prfOutput, salt = 빈 값, L = 32).
 *  · discoveryKey = HKDF(info = "araso.gateb.v1.locator")            — 루트 멤버십 레코드 조회 키
 *  · backupScope  = HKDF(info = "araso.gateb.v1.locator/piggylist")  — 봉인 목록 저장 범위(레코드에 **저장되지 않는다**)
 * 둘 다 PRF 없이는 계산 불가 · 서로에게서 계산 불가 · credentialId 와 무관. PRF 출력 자체는 반환하지 않는다.
 */
export async function deriveGateBLocator(prfOutput, { subtle = globalThis.crypto?.subtle } = {}) {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length !== 32) throw new Error("invalid_prf_output");
  if (!subtle || typeof subtle.importKey !== "function") throw new Error("crypto_unavailable");
  const ikm = await subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveBits"]);
  const bits = (info) => subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info }, ikm, 256);
  const [d, b] = await Promise.all([bits(LOCATOR_INFO), bits(BACKUP_SCOPE_INFO)]);
  return { discoveryKey: hex(new Uint8Array(d)), backupScope: hex(new Uint8Array(b)) };
}

// ---- discovery 레코드 — v1 최소 모양, 이 필드 말고는 없다 ----------------------------------------------
export const DISCOVERY_SCHEMA_VERSION = 1;
export const DISCOVERY_RECORD_FIELDS = Object.freeze(["schemaVersion", "opaqueRecoveryId", "rootLocatorRef", "recordVersion"]);

/**
 * 신뢰하지 않는 discovery 응답 검사. 필드 초과/누락 · 스키마 불일치 · **요청한 키와 다른 레코드**(교체 응답) ·
 * 주소처럼 보이는 값 → 전부 거부. 통과해도 그것은 **후보**일 뿐이다.
 */
export function normalizeDiscoveryRecord(record, { expectedKey } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return { record: null, error: "discovery_corrupt" };
  const keys = Object.keys(record);
  if (keys.length !== DISCOVERY_RECORD_FIELDS.length || keys.some((k) => !DISCOVERY_RECORD_FIELDS.includes(k))) return { record: null, error: "discovery_shape" };
  if (record.schemaVersion !== DISCOVERY_SCHEMA_VERSION) return { record: null, error: "discovery_version" };
  if (typeof record.opaqueRecoveryId !== "string" || !HEX64.test(record.opaqueRecoveryId)) return { record: null, error: "discovery_shape" };
  if (typeof expectedKey === "string" && record.opaqueRecoveryId !== expectedKey) return { record: null, error: "discovery_key_mismatch" };
  if (typeof record.rootLocatorRef !== "string" || !REF.test(record.rootLocatorRef) || ADDR_LIKE.test(record.rootLocatorRef)) return { record: null, error: "discovery_shape" };
  if (!Number.isSafeInteger(record.recordVersion) || record.recordVersion < 0) return { record: null, error: "discovery_shape" };
  return {
    record: Object.freeze({
      schemaVersion: DISCOVERY_SCHEMA_VERSION,
      opaqueRecoveryId: record.opaqueRecoveryId,
      rootLocatorRef: record.rootLocatorRef,
      recordVersion: record.recordVersion,
    }),
    error: null,
  };
}

/**
 * Gate B 원격 adapter **인터페이스**(원격 공급자는 이 카드에서 고르지 않는다 — 제품 값 null):
 *
 *   lookup(discoveryKey: hex64) -> Promise<DiscoveryRecord | null>   멤버십만. 없으면 null. 못 닿으면 throw.
 *   backupStore(backupScope: hex64) -> { get(key) -> Promise<envelope|null>, put(key, envelope) -> Promise<void> }
 *        봉인 봉투 {version, nonce, ciphertext} 만 오간다. key = myPiggiesIndexKey(chainId)(범위 안의 고정 키, A-572 C15).
 *   announce(discoveryKey, { recordVersion }) -> Promise<DiscoveryRecord>   (발행 뒤 멤버십/버전 갱신 — 발행 cadence 는 OWNER_GATE)
 *
 * 서버 권한 = discovery 만: 어느 메서드도 서명·권한·소유 판정을 돌려주지 않는다.
 */
export function isGateBRemoteAdapter(adapter) {
  return !!adapter && typeof adapter.lookup === "function" && typeof adapter.backupStore === "function";
}

const ENVELOPE_FIELDS = Object.freeze(["version", "nonce", "ciphertext"]);
const RELEASE_PROOF_FIELDS = Object.freeze(["challenge", "signature", "publicKey"]);
function isReleaseProofShape(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const keys = Object.keys(p);
  if (keys.length !== RELEASE_PROOF_FIELDS.length || keys.some((k) => !RELEASE_PROOF_FIELDS.includes(k))) return false;
  return typeof p.challenge === "string" && HEX64.test(p.challenge)
    && typeof p.signature === "string" && /^[0-9a-f]{128}$/.test(p.signature)
    && typeof p.publicKey === "string" && HEX64.test(p.publicKey);
}

/**
 * **테스트/로컬 전용** 메모리 adapter. 쓰기 시점에 서버가 볼 수 있는 모양을 강제한다 — 64-hex 가 아닌 조회 키
 * (예: 원시 credentialId · 주소) 나 봉투 밖 필드(주소 목록 등)는 **받지 않는다**. `_dump`/`_admin*` 은 공격
 * 시뮬레이션용이며 복구 경로 코드는 부르지 않는다.
 */
export function createMemoryGateBAdapter({ refFactory = null, verifyAnchorProof = null } = {}) {
  const anchors = new Map();
  let anchorUp = true;
  const discovery = new Map();
  const scopes = new Map();
  let up = true;
  let refSeq = 0;
  const nextRef = () => (typeof refFactory === "function" ? refFactory() : `ref_${String(++refSeq).padStart(8, "0")}`);
  const guard = () => { if (!up) throw new Error("server_unavailable"); };
  return {
    async lookup(discoveryKey) {
      guard();
      if (typeof discoveryKey !== "string" || !HEX64.test(discoveryKey)) return null;
      return discovery.has(discoveryKey) ? { ...discovery.get(discoveryKey) } : null;
    },
    async announce(discoveryKey, { recordVersion } = {}) {
      guard();
      if (typeof discoveryKey !== "string" || !HEX64.test(discoveryKey)) throw new Error("bad_lookup_key");
      if (!Number.isSafeInteger(recordVersion) || recordVersion < 0) throw new Error("bad_record_version");
      const prev = discovery.get(discoveryKey);
      if (prev && recordVersion < prev.recordVersion) throw new Error("record_version_regress");   // 정직한 서버는 내려가지 않는다
      const rec = { schemaVersion: DISCOVERY_SCHEMA_VERSION, opaqueRecoveryId: discoveryKey, rootLocatorRef: prev?.rootLocatorRef ?? nextRef(), recordVersion };
      discovery.set(discoveryKey, rec);
      return { ...rec };
    },
    backupStore(backupScope) {
      if (typeof backupScope !== "string" || !HEX64.test(backupScope)) throw new Error("bad_scope");
      return {
        async get(key) {
          guard();
          const m = scopes.get(backupScope);
          return m && m.has(key) ? { ...m.get(key) } : null;
        },
        async put(key, envelope) {
          guard();
          if (typeof key !== "string" || !key) throw new Error("bad_key");
          if (!envelope || typeof envelope !== "object" || Object.keys(envelope).some((k) => !ENVELOPE_FIELDS.includes(k))) throw new Error("bad_envelope");
          if (!scopes.has(backupScope)) scopes.set(backupScope, new Map());
          scopes.get(backupScope).set(key, { version: envelope.version, nonce: envelope.nonce, ciphertext: envelope.ciphertext });
        },
      };
    },
    // [A-857] 신선도 앵커(테스트/로컬 전용). 실제 공급자 아님. 쓰기 증명 검사는 `verifyAnchorProof(tuple, proof)` 주입(기본 = 64-hex 형태만).
    anchor: {
      async get(scope) {
        guard();
        if (!anchorUp) throw new Error("anchor_unavailable");
        if (typeof scope !== "string" || !HEX64.test(scope)) throw new Error("bad_scope");
        return anchors.has(scope) ? { ...anchors.get(scope) } : null;
      },
      async advance(scope, prevVersion, nextVersion, envelopeDigest, proof) {
        guard();
        if (!anchorUp) throw new Error("anchor_unavailable");
        if (typeof scope !== "string" || !HEX64.test(scope)) throw new Error("bad_scope");
        if (!Number.isSafeInteger(prevVersion) || prevVersion < 0 || !Number.isSafeInteger(nextVersion) || nextVersion < 1) throw new Error("bad_record_version");
        if (typeof envelopeDigest !== "string" || !HEX64.test(envelopeDigest)) throw new Error("bad_digest");
        const tuple = { scope, prevVersion, nextVersion, envelopeDigest };
        // [A-876] 증명 모양 = A-857 HMAC(64-hex 문자열) 또는 A-871 출시 등급 {challenge, signature, publicKey}(검증자 주입 시에만).
        //  검증자(verifyAnchorProof, 동기/비동기)가 없으면 예전 그대로 64-hex 문자열만 받는다.
        const shapeOk = (typeof proof === "string" && HEX64.test(proof)) || (typeof verifyAnchorProof === "function" && isReleaseProofShape(proof));
        let okProof = false;
        if (shapeOk) {
          try { okProof = typeof verifyAnchorProof !== "function" || (await verifyAnchorProof(tuple, proof)) === true; } catch { okProof = false; }
        }
        if (!okProof) throw new Error("anchor_write_unauthorized");
        const cur = anchors.get(scope);
        if (cur && cur.recordVersion === nextVersion && cur.envelopeDigest === envelopeDigest) return { ...cur };   // 멱등
        if ((cur?.recordVersion ?? 0) !== prevVersion) throw new Error("anchor_cas_conflict");
        if (nextVersion <= prevVersion) throw new Error("anchor_downgrade");
        const rec = { recordVersion: nextVersion, envelopeDigest };
        anchors.set(scope, rec);
        return { ...rec };
      },
    },
    setAnchorOutage(down) { anchorUp = !down; },
    _adminSetAnchor(scope, record) { if (record === null) anchors.delete(scope); else anchors.set(scope, record); },
    // ---- 공격 시뮬레이션/검사 전용 ----
    setOutage(down) { up = !down; },
    _dump() {
      return {
        discovery: [...discovery.values()].map((r) => ({ ...r })),
        anchors: [...anchors.entries()].map(([scope, r]) => ({ scope, ...r })),
        backups: [...scopes.entries()].flatMap(([scope, m]) => [...m.entries()].map(([key, env]) => ({ scope, key, ...env }))),
      };
    },
    _adminSetDiscovery(discoveryKey, record) { discovery.set(discoveryKey, { ...record }); },
    _adminSetBackup(backupScope, key, envelope) {
      if (!scopes.has(backupScope)) scopes.set(backupScope, new Map());
      if (envelope === null) scopes.get(backupScope).delete(key);   // 봉투 보류/삭제 시뮬레이션
      else scopes.get(backupScope).set(key, { ...envelope });
    },
    _adminGetBackup(backupScope, key) { return scopes.get(backupScope)?.get(key) ?? null; },
  };
}

/**
 * Gate B 1단계 — **고정되지 않은** assertion 1회(locator salt) → locator 계산 → 멤버십 조회.
 * 결과는 **후보**다: 이 뒤에 반드시 고정된 루트 통제 증명(main.js recoverPiggy)이 먼저 끝나야 목록을 읽는다.
 * 어떤 실패도 새 패스키/루트를 만들지 않는다(이 함수에는 생성 경로가 없다).
 *
 * @returns {{status:'no_adapter'|'unavailable'|'auth_failed'|'not_found'|'refused'|'member', reason?, candidateCredentialId?, discoveryRecord?, backupScope?}}
 */
export async function discoverGateBRoot({ adapter, requestPrf, subtle = globalThis.crypto?.subtle } = {}) {
  if (!isGateBRemoteAdapter(adapter)) return { status: "no_adapter" };
  if (typeof requestPrf !== "function") return { status: "refused", reason: "missing_auth_provider" };
  const salt = await gateBLocatorPrfSalt({ subtle });
  let result;
  try {
    result = await requestPrf(null, salt);
  } catch {
    return { status: "auth_failed" };
  }
  if (!result || typeof result.credentialId !== "string" || !(result.prfOutput instanceof Uint8Array)) return { status: "auth_failed" };
  let keys;
  try {
    keys = await deriveGateBLocator(result.prfOutput, { subtle });
  } catch {
    return { status: "refused", reason: "derive_failed" };
  }
  let raw;
  try {
    raw = await adapter.lookup(keys.discoveryKey);
  } catch {
    return { status: "unavailable" };            // 서버 불가 = 복구 불가(fail closed). 로컬 기기는 영향 없음.
  }
  if (!raw) return { status: "not_found" };      // "Piggy 없음" 이 아니다 — 등록 안 됨/다른 credential 과 구별 불가
  const { record, error } = normalizeDiscoveryRecord(raw, { expectedKey: keys.discoveryKey });
  if (error) return { status: "refused", reason: error };
  return { status: "member", candidateCredentialId: result.credentialId, discoveryRecord: record, backupScope: keys.backupScope };
}

/**
 * @returns {{status, source: 'local_only'|'backup', restored: [{sequence,address,locator}], skipped: [{sequence,reason}], namesRecovered: false}}
 *
 * status:
 *  - "no_adapter" — adapter 자체가 없다(제품 기본값). source 는 항상 "local_only". 인증 0.
 *  - "ok" 이고 source "local_only" — adapter 는 있었지만 원격에 봉투가 없거나 못 닿았다(restoreFromBackup 자체가 local_only).
 *  - "refused" — 원격 봉투는 있었지만 열기/체인/루트 검증에서 거부됐다(reason 에 사유).
 *  - "ok" 이고 source "backup" — 실제로 원격 봉투를 열고 후보를 (0개 이상) 입장시켰다.
 */
export async function recoverProductList({
  adapter,
  storage,
  chainId,
  rootCredential,
  requestPrf,
  deriveAddress,
  locks = null,
  now = () => new Date().toISOString(),
  subtle = globalThis.crypto?.subtle,
  discovery = null,
  anchor = null,
  anchorScope = null,
  releaseProof = null,   // [A-876] A-871 출시 등급 능력 훅(선택). 없으면 앵커 일치 = local_proof_only. index-backup.js resolveReleaseTrust 참조.
} = {}) {
  // 어댑터 부재 = 정확한 no-op. restoreFromBackup 도 같은 조건에서 조기 반환하지만,
  // 여기서 한 번 더 짧게 끊어서 이 함수의 계약을 "adapter 없으면 그 아래로 내려가지 않는다"로
  // 눈에 보이게 고정한다(요청 PRF 호출 0을 이 함수 시그니처 레벨에서도 보장).
  if (!adapter || typeof adapter.get !== "function") {
    return { status: "no_adapter", source: "local_only", restored: [], skipped: [], namesRecovered: false };
  }

  // [A-554 리뷰 결함 (a) 수리] admitModelAPiggy 와 같은 규칙 — Web Locks 가 없으면 복원 입장을 하지 않는다.
  // 잠금 없이 돌면 동시 `+ Piggy` 와 순번 워터마크를 두고 경합할 수 있다. 인증 호출 0 으로 거절.
  if (!locks || typeof locks.request !== "function") {
    return { status: "refused", reason: "lock_unsupported", source: "backup", restored: [], skipped: [], namesRecovered: false };
  }

  // [A-579 Lane B] discovery 결과가 넘어오면: 멤버십 후보여야 하고, 그 후보 credential 이 **이미 고정 통제 증명을 끝낸**
  // 루트(rootCredential)와 같아야 한다. 다르면 목록을 읽지 않는다(서버/OS 가 고른 다른 credential 로 넘어가지 않는다).
  let discoveryRecord = null;
  if (discovery) {
    if (discovery.status !== "member" || !discovery.discoveryRecord) {
      return { status: "refused", reason: "discovery_not_member", source: "backup", restored: [], skipped: [], namesRecovered: false, completeness: "unverified_fresh" };
    }
    if (discovery.candidateCredentialId !== rootCredential?.credentialId) {
      return { status: "refused", reason: "root_credential_mismatch", source: "backup", restored: [], skipped: [], namesRecovered: false, completeness: "unverified_fresh" };
    }
    discoveryRecord = discovery.discoveryRecord;
  }

  const key = myPiggiesIndexKey(chainId);
  const out = await restoreFromBackup({
    adapter,
    key,
    storage,
    chainId,
    pinnedCredential: rootCredential,
    requestPrf,
    deriveAddress,
    locks,
    now,
    subtle,
    discoveryRecord,
    anchor,
    anchorScope: anchorScope ?? discovery?.backupScope ?? null,
    releaseProof,
  });

  if (out.source === "local_only") {
    // 원격에 못 닿았거나 이 chainId 아래 봉투가 아예 없다 — 거부가 아니라 "아직 없음".
    // "ok" 는 "완전 복구" 가 아니다 — 원격 봉투가 없었다는 뜻일 뿐. completeness 로 명시한다.
    return { status: "ok", source: "local_only", restored: [], skipped: out.skipped || [], namesRecovered: false, completeness: "unverified_fresh" };
  }

  // out.source === "remote" (index-backup.js 내부 이름) — 이 orchestrator 계약에서는 "backup".
  if (out.error) {
    return { status: "refused", reason: out.error, source: "backup", restored: [], skipped: out.skipped || [], namesRecovered: false, completeness: "unverified_fresh", ...(out.freshnessAnchor ? { freshnessAnchor: out.freshnessAnchor } : {}) };
  }

  // 성공 — restoreFromBackup 은 {sequence,address} 만 돌려준다(계약 유지를 위해 바꾸지 않았다).
  // locator 는 이미 registerControlledPiggy 가 색인에 쓴 값을 그대로 읽어 붙인다(새로 파생/추측 0).
  const { index } = loadMyPiggiesIndex(storage, chainId);
  const byAddress = new Map(index.piggies.map((p) => [lower(p.address), p]));
  const restored = (out.restored || []).map((r) => {
    const row = byAddress.get(lower(r.address));
    return { sequence: r.sequence, address: r.address, locator: row?.locator ?? null };
  });

  return {
    status: "ok",
    source: "backup",
    restored,
    skipped: out.skipped || [],
    namesRecovered: false,   // [A-554 Lane C] 이름은 blob 에 없다 — 절대 지어내지 않는다.
    // [A-579 Lane B] 절대 "complete" 가 아니다 — index-backup.js restoreFromBackup 의 completeness 그대로.
    // [A-876] anchored_fresh 는 A-871 출시 등급 훅 + 앵커 일치일 때만 · SAME_SECRET/UNKNOWN 일치 = local_proof_only.
    completeness: out.completeness,
    recordVersion: out.recordVersion,
    claimedThrough: out.claimedThrough,
    restoredThrough: out.restoredThrough,
    freshnessAnchor: out.freshnessAnchor ?? null,
  };
}
