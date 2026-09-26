// [A-520 Stream B1] MY PIGGIES — **Piggy 전환에도 남는 비금융 색인.**
//
// 이것이 기억하는 것: 내 Home 에 누가 사는지 · 내가 통제한다고 증명된 Piggy 가 누구인지
// (id · 이름 · 순서 · 주소 · 다시 열 때 필요한 비밀 아닌 locator).
//
// 이것이 **아닌 것**: 계정 · 지갑 · 서명 권한 · 잔액 원장 · 복구 수단 · 보안 격리 · 프라이버시 보장.
// 색인에 있다는 사실만으로 서명 세션·권한·잔액·충전·Job 완료가 생기지 않는다.
// 돈 동작은 여전히 고른 Piggy locator → Face ID → Gate C(piggy-session.js) 를 지난다.
//
// 키: `araso.myPiggiesIndex.v1.<chainId>` — **기기 로컬 · 앱+체인 범위**의 제품 메타데이터.
// state.address · 고른 Piggy · 활성 서명자 · Home · owner/master 지갑 **어느 것으로도 키를 만들지 않는다** —
// 그래야 Piggy 를 바꿔도 같은 색인이 읽힌다. 기기 간/제품 복구는 **증명하지 않았다**(Gate B 몫).
//
// 등록 규칙(대화 원문 2026-09-21: "주소를 적는 것만으로 내 것이 되지 않는다"):
// 실제 인증으로 **파생된 서명자 주소 == 그 Piggy 주소** 일 때만 넣는다(Gate C `bindSigner` 재사용).

import { isMeraError } from "@category-labs/mera";
import { bindSigner, bytesToHex, modelASalt, modelASaltHex, normalizeLocator } from "./piggy-session.js";

const INDEX_VERSION = 1;
const INDEX_PREFIX = "araso.myPiggiesIndex.v1";
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;

// 한 줄에 담을 수 있는 필드 — **이것 말고는 받지 않는다.** 잔액·평가·권한·영수증·draft·선호가 들어오면 그 줄은 버린다.
// [A-531] `sequence` = 모델 A 추가 Piggy 의 순번 n(1 이상 정수). **선택 필드** — 첫 Piggy(레거시) 행에는 없다.
// 순번은 파생 메타데이터이지 권한도, 사용자에게 보이는 정체성도 아니다.
const ROW_FIELDS = Object.freeze(["id", "name", "address", "locator", "createdAt", "lastControlProofAt", "sequence"]);
const SECRET_LIKE = /private|secret|seed|mnemonic|prfoutput|sessionkey|signingkey|keymaterial|authorization/i;

export function myPiggiesIndexKey(chainId) {
  const chain = typeof chainId === "string" ? chainId.trim() : "";
  return chain ? `${INDEX_PREFIX}.${chain}` : null;
}

function lower(a) {
  return typeof a === "string" ? a.toLowerCase() : "";
}

function hasSecretLike(value, depth = 0) {
  if (depth > 4 || !value || typeof value !== "object") return false;
  return Object.entries(value).some(([k, v]) => SECRET_LIKE.test(k) || hasSecretLike(v, depth + 1));
}

/** 저장된 한 줄 검사. 틀리면 **그 줄을 버린다**(주인이 생기지 않는다). */
function normalizeRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  if (Object.keys(row).some((k) => !ROW_FIELDS.includes(k))) return null;   // 금융/런타임 필드 섞임 → 버림
  if (hasSecretLike(row)) return null;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!ID.test(id)) return null;
  if (!ADDR.test(row.address || "")) return null;
  const { locator, error } = normalizeLocator(row.locator);
  if (error) return null;
  const name = typeof row.name === "string" && row.name.trim() !== "" ? row.name.trim().slice(0, 40) : null;
  const createdAt = typeof row.createdAt === "string" && row.createdAt ? row.createdAt : null;
  const lastControlProofAt = typeof row.lastControlProofAt === "string" && row.lastControlProofAt ? row.lastControlProofAt : null;
  if (!lastControlProofAt) return null;                                      // 통제 증명 시각 없는 줄 = 주인 없음
  let sequence = null;
  if (row.sequence !== undefined && row.sequence !== null) {
    if (!Number.isSafeInteger(row.sequence) || row.sequence < 1) return null; // 이상한 순번 = 줄 버림
    // [A-579 repair RV-2] 읽을 때도 순번↔salt 를 확인한다 — salt 가 modelASalt(n) 이 아니면 그 줄은 "Piggy #n" 이 아니다.
    // 조용히 믿지 않고 버린다(loadMyPiggiesIndex 의 dropped 로 센다). 주인이 생기지 않는 쪽으로 닫힌다.
    if (locator.prfSalt !== modelASaltHex(row.sequence)) return null;
    sequence = row.sequence;
  }
  return { id, name, address: row.address, locator, createdAt, lastControlProofAt, ...(sequence ? { sequence } : {}) };
}

// [A-531] `issuedThrough` = 성공적으로 입장한 순번의 최댓값(워터마크). 없으면 0 — 기존 v1 데이터와 호환.
// **내려가지 않는다**: 저장값과 남은 줄의 최대 순번 중 큰 쪽을 쓴다(줄이 지워져도 번호는 다시 안 나온다).
function emptyIndex(chainId) {
  return { version: INDEX_VERSION, chainId, issuedThrough: 0, piggies: [] };
}

/**
 * 색인 읽기. 손상/버전 불일치는 **빈 색인**으로 — 소유를 지어내지 않는다.
 * 같은 id 나 같은 주소가 두 번 나오면 **먼저 나온 줄만** 남긴다(결정적).
 */
export function loadMyPiggiesIndex(storage, chainId) {
  const key = myPiggiesIndexKey(chainId);
  if (!key) return { index: emptyIndex(""), error: "invalid_chain" };
  if (!storage) return { index: emptyIndex(chainId), error: "no_storage" };
  let raw = null;
  try { raw = storage.getItem(key); } catch { return { index: emptyIndex(chainId), error: "storage_read_failed" }; }
  if (!raw) return { index: emptyIndex(chainId), error: "absent" };
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return { index: emptyIndex(chainId), error: "corrupt" }; }
  if (!parsed || parsed.version !== INDEX_VERSION || parsed.chainId !== chainId || !Array.isArray(parsed.piggies)) {
    return { index: emptyIndex(chainId), error: "invalid_index" };
  }
  const seenId = new Set();
  const seenAddr = new Set();
  const seenSeq = new Set();
  const piggies = [];
  let dropped = 0;
  for (const row of parsed.piggies) {
    const clean = normalizeRow(row);
    if (!clean || seenId.has(clean.id) || seenAddr.has(lower(clean.address)) || (clean.sequence && seenSeq.has(clean.sequence))) { dropped += 1; continue; }
    seenId.add(clean.id);
    seenAddr.add(lower(clean.address));
    if (clean.sequence) seenSeq.add(clean.sequence);
    piggies.push(clean);
  }
  const stored = Number.isSafeInteger(parsed.issuedThrough) && parsed.issuedThrough >= 0 ? parsed.issuedThrough : 0;
  const maxSeq = piggies.reduce((m, p) => Math.max(m, p.sequence || 0), 0);
  return { index: { version: INDEX_VERSION, chainId, issuedThrough: Math.max(stored, maxSeq), piggies }, error: null, dropped };
}

function writeIndex(storage, chainId, index) {
  try {
    // 줄과 워터마크는 **한 번의 JSON 쓰기**로 같이 나간다.
    storage.setItem(myPiggiesIndexKey(chainId), JSON.stringify({ version: INDEX_VERSION, chainId, issuedThrough: index.issuedThrough || 0, piggies: index.piggies }));
    return true;
  } catch {
    return false;
  }
}

function refuse(reason) {
  return { ok: false, reason, index: null, piggy: null };
}

// [A-532] requestPrf 실패를 취소로 뭉뚱그리지 않는다 — Mera 가 구분해 주는 코드는 그대로 쓴다.
// PASSKEY_OPERATION_FAILED 는 Mera 자신이 "취소/불가/예상 밖 자격증명"을 하나로 묶은 코드라 더 쪼갤 수 없다
// (node_modules/@category-labs/mera/src/errors.ts 주석) — 그것만 auth_cancelled 로 남긴다.
// 원시 에러 문자열/스택은 새지 않는다(사유 코드만).
function classifyAuthError(err) {
  if (isMeraError(err)) {
    if (err.code === "PRF_UNAVAILABLE") return "auth_unsupported";
    if (err.code === "CRYPTO_UNAVAILABLE") return "auth_unavailable";
    if (err.code === "INPUT_INVALID") return "auth_invalid_request";
    return "auth_cancelled";
  }
  return "auth_failed";
}

/**
 * **통제가 증명된** Piggy 를 넣거나(없으면 끝에) 갱신한다(있으면 그 자리 그대로).
 *
 * @param {object} p
 * @param {string} p.address         그 Piggy 주소
 * @param {string} p.signerAddress   **이번 인증에서 실제로 파생된** 서명자 주소 — 통제 증명
 * @param {object} p.locator         { credentialId, transports?, prfSalt? } — 비밀 아님
 * @param {string} [p.id]            없으면 주소로 결정적 id
 * @param {string} [p.name]
 * @param {string} p.at              ISO 시각
 */
//
// [A-579 Lane B · A-572 C6b] **순번(sequence) 을 가진 쓰기는 여기로 들어올 수 없다.** 순번 행은
// `admitSequencedPiggy`(아래) — salt 를 **스스로** modelASalt(n) 로 계산해 그 salt 로 인증·파생한 뒤에만
// 쓰는 유일한 경로 — 를 거쳐야 한다. 호출자가 (주소, 순번) 짝을 손으로 넘기는 길 = 0.
export function registerControlledPiggy(storage, chainId, args = {}) {
  if (args && args.sequence !== null && args.sequence !== undefined) return refuse("sequence_requires_model_a_path");
  return writeControlledPiggy(storage, chainId, args);
}

function writeControlledPiggy(storage, chainId, { id = null, name = null, address, signerAddress, locator, at, sequence = null } = {}) {
  if (!myPiggiesIndexKey(chainId)) return refuse("invalid_chain");
  if (!storage) return refuse("no_storage");
  if (!ADDR.test(address || "")) return refuse("invalid_address");
  // 통제 증명: 이번에 파생된 서명자가 바로 그 주소여야 한다. 주소만 적어서는 들어올 수 없다.
  const proof = bindSigner(Object.freeze({ id: "proof", address }), signerAddress);
  if (!proof.ok) return refuse(proof.reason === "no_signer" ? "no_control_proof" : "control_proof_mismatch");
  const { locator: loc, error: locError } = normalizeLocator(locator);
  if (locError) return refuse(locError);
  if (typeof at !== "string" || at.trim() === "") return refuse("missing_time");

  const { index } = loadMyPiggiesIndex(storage, chainId);
  const wantId = typeof id === "string" && id.trim() !== "" ? id.trim() : `piggy-${lower(address)}`;
  if (!ID.test(wantId)) return refuse("invalid_id");
  const cleanName = typeof name === "string" && name.trim() !== "" ? name.trim().slice(0, 40) : null;

  const byAddr = index.piggies.findIndex((p) => lower(p.address) === lower(address));
  const byId = index.piggies.findIndex((p) => p.id === wantId);
  // 같은 id 가 **다른 주소**를 가리키면 모호하다 — 아무것도 바꾸지 않는다.
  if (byId >= 0 && lower(index.piggies[byId].address) !== lower(address)) return refuse("id_conflict");

  // [A-579 repair RV-2] 순번 없는 쓰기는 **이미 순번을 가진 행**을 갱신할 수 없다. 갱신 분기(아래)는 locator
  // (credentialId·prfSalt)를 통째로 바꾸고 sequence 는 남기므로, 여기를 열어 두면 insert 에서 닫은 순번↔salt
  // 불변식이 update 로 깨진다(리뷰 RV-2). 순번 행의 locator 는 admitSequencedPiggy 로만 바뀐다.
  if ((sequence === null || sequence === undefined) && byAddr >= 0 && index.piggies[byAddr].sequence) {
    return refuse("sequenced_row_requires_model_a_path");
  }

  // [A-531] 순번 입장 — 순번을 가진 호출만 워터마크를 움직인다(첫 Piggy open/recover 는 순번 없음 → 0 영향).
  let issuedThrough = index.issuedThrough || 0;
  if (sequence !== null && sequence !== undefined) {
    if (!Number.isSafeInteger(sequence) || sequence < 1) return refuse("invalid_sequence");
    // [A-579 Lane B] 순번 ↔ salt 불변식 — 행이 주장하는 순번 n 의 locator salt 는 **정확히** modelASalt(n) 이어야
    // 한다. 다른 도메인(index-backup salt 등)으로 파생된 salt/주소가 "Piggy #n" 으로 들어오는 것을 함수가 직접 막는다.
    if (loc.prfSalt !== modelASaltHex(sequence)) return refuse("sequence_salt_mismatch");
    if (byAddr >= 0) {
      // 같은 주소 재입장은 **같은 순번일 때만** 제자리 갱신(워터마크 불변). 다르면 모호 → 거부.
      if (index.piggies[byAddr].sequence !== sequence) return refuse("sequence_address_conflict");
    } else {
      if (index.piggies.some((p) => p.sequence === sequence)) return refuse("duplicate_sequence");
      if (sequence !== issuedThrough + 1) return refuse("stale_sequence");
      issuedThrough = sequence;
    }
  }

  const piggies = index.piggies.map((p) => ({ ...p }));
  let piggy;
  if (byAddr >= 0) {
    // 이미 있다 — **자리(순서)와 id 는 그대로**, locator·증명 시각만 새로. 이름은 새 값이 있을 때만.
    const prev = piggies[byAddr];
    piggy = { ...prev, locator: loc, lastControlProofAt: at, ...(cleanName ? { name: cleanName } : {}) };
    piggies[byAddr] = piggy;
  } else {
    piggy = { id: wantId, name: cleanName, address, locator: loc, createdAt: at, lastControlProofAt: at, ...(sequence ? { sequence } : {}) };
    piggies.push(piggy);
  }
  const next = { ...index, issuedThrough, piggies };
  if (!writeIndex(storage, chainId, next)) return refuse("storage_write_failed");
  return { ok: true, reason: null, index: next, piggy };
}

/**
 * 이미 색인에 있는 Piggy 의 **이름만** 바꾼다. 없는 id 는 거부 — 이름 바꾸기로 새 주소를 등록할 수 없다.
 * 순서는 바뀌지 않는다.
 */
export function renameIndexedPiggy(storage, chainId, { id, name } = {}) {
  if (!storage) return refuse("no_storage");
  const cleanName = typeof name === "string" && name.trim() !== "" ? name.trim().slice(0, 40) : null;
  if (!cleanName) return refuse("invalid_name");
  const { index } = loadMyPiggiesIndex(storage, chainId);
  const at = index.piggies.findIndex((p) => p.id === id);
  if (at < 0) return refuse("not_indexed");
  const piggies = index.piggies.map((p, i) => (i === at ? { ...p, name: cleanName } : { ...p }));
  const next = { ...index, piggies };
  if (!writeIndex(storage, chainId, next)) return refuse("storage_write_failed");
  return { ok: true, reason: null, index: next, piggy: piggies[at] };
}

// ---- [A-531] 모델 A 추가 Piggy 입장 — 탭 사이 직렬화 + 고정 credential + 통제 증명 ---------------------
//
// 순서(잠금 안에서): ① 최신 색인 재읽기 ② n = issuedThrough + 1 ③ salt 파생 ④ **고정된** 기존 패스키로 assertion 1회
// ⑤ 최신 상태 다시 확인 ⑥ 줄 + 워터마크를 한 번에 쓰기. 취소/실패는 n 을 쓰지 않고 줄도 남기지 않는다.
// 새 패스키를 만들지 않는다 · "아무 패스키나" 로 떨어지지 않는다 · 돈/권한/세션을 남기지 않는다(세션 정리는 호출자 몫).
export function myPiggiesLockName(chainId) {
  const key = myPiggiesIndexKey(chainId);
  return key ? `${key}.admit` : null;
}

export async function admitModelAPiggy({ storage, chainId, locks, rootCredential, requestPrf, deriveAddress, now = () => new Date().toISOString() } = {}) {
  const lockName = myPiggiesLockName(chainId);
  if (!lockName) return refuse("invalid_chain");
  if (!storage) return refuse("no_storage");
  // 탭 사이 직렬화를 증명할 수 없으면 **하지 않는다**(동시성 안전을 조용히 주장하지 않는다).
  if (!locks || typeof locks.request !== "function") return refuse("lock_unsupported");
  const rootId = typeof rootCredential?.credentialId === "string" ? rootCredential.credentialId : "";
  if (!rootId) return refuse("missing_root_credential");
  if (typeof requestPrf !== "function" || typeof deriveAddress !== "function") return refuse("missing_auth_provider");
  const pinned = { credentialId: rootId, ...(Array.isArray(rootCredential.transports) && rootCredential.transports.length ? { transports: rootCredential.transports } : {}) };

  return locks.request(lockName, { mode: "exclusive" }, async () => {
    const before = loadMyPiggiesIndex(storage, chainId).index;
    const n = (before.issuedThrough || 0) + 1;
    return admitSequencedPiggy({ storage, chainId, sequence: n, rootCredential: pinned, requestPrf, deriveAddress, now, requireNext: true });
  });
}

/**
 * [A-579 Lane B · A-572 C6b] **순번 행의 유일한 입장 경로.** 순번 n 을 받아 salt 를 **여기서** modelASalt(n) 로
 * 계산하고, 그 salt 로 고정 루트에 assertion → 주소 파생 → 통제 증명과 함께 기록한다. 호출자는 salt 도 주소도
 * 넘기지 않는다 — (주소, 순번) 짝이 어긋날 길이 호출자 규율이 아니라 이 함수의 모양으로 닫힌다.
 * admitModelAPiggy(+Piggy) 와 index-backup.js restoreFromBackup(Gate B 복원) 이 둘 다 이것을 쓴다.
 * 잠금은 호출자 몫(둘 다 myPiggiesLockName 잠금 안에서 부른다). 새 패스키 생성 0.
 *
 * @param {boolean} [p.requireNext]      true 면 인증 뒤 최신 색인에서 n === issuedThrough+1 을 다시 확인(stale_sequence)
 * @param {function} [p.authErrorReason] requestPrf 실패 → 사유 코드(기본 classifyAuthError)
 */
export async function admitSequencedPiggy({
  storage,
  chainId,
  sequence,
  rootCredential,
  requestPrf,
  deriveAddress,
  now = () => new Date().toISOString(),
  requireNext = false,
  authErrorReason = classifyAuthError,
} = {}) {
  if (!myPiggiesIndexKey(chainId)) return refuse("invalid_chain");
  if (!storage) return refuse("no_storage");
  if (!Number.isSafeInteger(sequence) || sequence < 1) return refuse("invalid_sequence");
  const rootId = typeof rootCredential?.credentialId === "string" ? rootCredential.credentialId : "";
  if (!rootId) return refuse("missing_root_credential");
  if (typeof requestPrf !== "function" || typeof deriveAddress !== "function") return refuse("missing_auth_provider");
  const pinned = { credentialId: rootId, ...(Array.isArray(rootCredential.transports) && rootCredential.transports.length ? { transports: rootCredential.transports } : {}) };

  const salt = await modelASalt(sequence);
  const saltHex = bytesToHex(salt);
  if (saltHex !== modelASaltHex(sequence)) return refuse("sequence_salt_mismatch");   // 두 구현이 갈라지면 쓰지 않는다
  let result;
  try {
    result = await requestPrf(pinned, salt);
  } catch (err) {
    return refuse(authErrorReason(err));                  // n 소모 0 · 줄 0 — 원인별로 구분된 사유
  }
  // 돌아온 credential 이 우리가 고정한 그 루트인가 — 루트가 조용히 바뀌지 않게.
  if (!result || result.credentialId !== rootId) return refuse("root_credential_mismatch");
  let address;
  try {
    address = deriveAddress(result.prfOutput);            // **라이브 파생** — 이 salt 로만
  } catch {
    return refuse("derive_failed");
  }
  if (requireNext) {
    const after = loadMyPiggiesIndex(storage, chainId).index;
    if ((after.issuedThrough || 0) + 1 !== sequence) return refuse("stale_sequence");
  }
  return writeControlledPiggy(storage, chainId, {
    id: `piggy-${lower(address)}`,
    name: null,
    address,
    signerAddress: address,
    locator: { ...pinned, prfSalt: saltHex },
    at: now(),
    sequence,
  });
}
