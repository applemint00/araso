// [A-495 Lane G] **Gift claim-link** — 최소 역량만.
//
// 이 파일이 하는 일은 하나다: **받는 사람이 링크를 열고, 자기 Piggy 로 "내가 받았다"고 서명하는 것**.
// 그 서명이 소유 증명이다. 가장(impersonation)은 증명이 아니다 — 여기서는
// `verifiedSignerAddress` 가 `recipientAddress` 와 같음을 **호출자가 실제 서명 검증으로** 입증해
// 넘겨야만 claim 이 닫힌다.
//
// 이 파일이 **하지 않는 일**(그리고 앞으로도 조용히 하지 않을 일):
//  · 돈을 옮기지 않는다. 링크 하나로 잔액이 변하는 일은 없다.
//  · tx 를 만들지도, 만든 척하지도 않는다. 값 이동은 `transfer` 칸에 **따로** 기록되고,
//    진짜 영수증(txHash + blockNumber + success) 없이는 그 칸이 `not_attempted` 밖으로 못 나간다.
//  · 비밀(raw claim token · PRF · 개인키)을 저장하지 않는다. 저장되는 건 **토큰의 해시**뿐이다.
//
// 저장 규율은 `piggy-registry.js` 를 따른다: 비밀 냄새가 나는 필드는 조용히 지우는 게 아니라
// **저장 자체를 거부**한다.
//
// 파일명: `gift-piggy-claim-link.js` (`*piggy*` · `gift-*` 두 이름 규칙을 함께 만족한다).

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const TOKEN = /^[A-Za-z0-9_-]{22,86}$/; // base64url, 16~64 bytes
const HEX64 = /^[0-9a-f]{64}$/;
const TXHASH = /^0x[0-9a-fA-F]{64}$/;

export const GIFT_LINK_VERSION = 1;

export const CLAIM_STATUS = Object.freeze({
  UNCLAIMED: "unclaimed",
  CLAIMED: "claimed",
  REVOKED: "revoked",
});

// claim 시도의 결과. **모르는 건 모른다고 말한다** — 추측으로 통과시키지 않는다.
export const CLAIM_RESULT = Object.freeze({
  OK: "ok",
  UNKNOWN_LINK: "unknown_link",
  BAD_TOKEN: "bad_token",
  EXPIRED: "expired",
  REVOKED: "revoked",
  ALREADY_CLAIMED_BY_SAME: "already_claimed_by_same",
  ALREADY_CLAIMED_BY_OTHER: "already_claimed_by_other",
  NO_RECIPIENT_IDENTITY: "no_recipient_identity",
  NOT_PROVEN_BY_SIGNATURE: "not_proven_by_signature", // 서명자 ≠ 수령자 = 가장. 거부한다.
  SENDER_IS_RECIPIENT: "sender_is_recipient",
});

// 값 이동은 claim 과 **다른 축**이다. 이 카드에서는 시도조차 허락되지 않았다.
export const TRANSFER_STATUS = Object.freeze({
  NOT_ATTEMPTED: "not_attempted",
  SETTLED: "settled",
});

const SECRET_LIKE = Object.freeze([
  "privatekey", "private_key", "prf", "prfoutput", "secret", "seed", "mnemonic",
  "passkeysecret", "credentialsecret", "sessionkey", "sessionsecret", "authorization",
  "signingkey", "keymaterial", "token", "claimtoken", "rawtoken",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function findSecretLikeKey(value, depth = 0) {
  if (depth > 6 || !isPlainObject(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const norm = key.toLowerCase().replace(/[^a-z_]/g, "");
    if (norm !== "claimtokenhash" && SECRET_LIKE.includes(norm)) return key;
    const nested = findSecretLikeKey(child, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function webcrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle || typeof c.getRandomValues !== "function") {
    throw new Error("WebCrypto unavailable — refusing to invent a weaker token");
  }
  return c;
}

function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(text) {
  const digest = await webcrypto().subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** raw claim token 한 개. **돌려주는 즉시 잊는 값이다** — 어디에도 저장하지 않는다. */
export function mintClaimToken(byteLength = 32) {
  const n = Number.isInteger(byteLength) && byteLength >= 16 && byteLength <= 64 ? byteLength : 32;
  const bytes = new Uint8Array(n);
  webcrypto().getRandomValues(bytes);
  return base64url(bytes);
}

/** 토큰 → 해시. 저장되는 건 **이것뿐**이다. */
export async function hashClaimToken(token) {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  return sha256Hex(token);
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 보내는 쪽이 만드는 링크 레코드.
 * raw token 은 `token` 으로 **한 번만** 돌려주고(URL 에 실으라고), `record` 에는 해시만 남는다.
 */
export function createClaimLink({
  giftId,
  senderAddress,
  chainId,
  createdAt,
  expiresAt = null,
  note = "",
  token = null,
} = {}) {
  const id = typeof giftId === "string" ? giftId.trim() : "";
  const sender = typeof senderAddress === "string" ? senderAddress.trim() : "";
  const chain = typeof chainId === "string" ? chainId.trim() : "";
  if (!id) return { ok: false, reason: "missing_gift_id" };
  if (!ADDR.test(sender)) return { ok: false, reason: "bad_sender_address" };
  if (!chain) return { ok: false, reason: "missing_chain_id" };
  if (typeof createdAt !== "string" || !createdAt) return { ok: false, reason: "missing_created_at" };
  if (expiresAt !== null && (typeof expiresAt !== "string" || expiresAt <= createdAt)) {
    return { ok: false, reason: "bad_expiry" };
  }
  const raw = token === null ? mintClaimToken() : token;
  if (typeof raw !== "string" || !TOKEN.test(raw)) return { ok: false, reason: "bad_token" };
  return {
    ok: true,
    token: raw, // 호출자가 URL 에 싣고 버린다. 레코드에는 없다.
    record: {
      version: GIFT_LINK_VERSION,
      giftId: id,
      senderAddress: sender,
      chainId: chain,
      claimTokenHash: null, // sealClaimLink 가 채운다 (해싱이 async 라서)
      status: CLAIM_STATUS.UNCLAIMED,
      createdAt,
      expiresAt,
      note: typeof note === "string" ? note.slice(0, 140) : "",
      recipientAddress: null,
      claimedAt: null,
      claimProof: null,
      transfer: { status: TRANSFER_STATUS.NOT_ATTEMPTED, txHash: null, blockNumber: null },
      // [A-560 PHASE 2] 기본은 없음 — identity-only Gift(레거시)와 완전히 같은 모양.
      // 값을 실으려면 `attachGiftValue()`를 claim 전에 정확히 한 번 부른다. 여기서는 정책(자산·
      // preset)을 모른다 — 그건 `gift-value-spec.js`의 몫이다(A-553 FundingContext 와 같은 계층
      // 분리 원칙).
      value: null,
    },
  };
}

const POSITIVE_INT = (n) => Number.isInteger(n) && n > 0;

/**
 * 아직 아무도 claim 하지 않은 레코드에 **딱 한 번** 값을 바인딩한다. 이미 값이 있으면(다시 바꿔
 * 끼우려는 시도) 거부한다 — 링크 생성 후 금액이 20→50/100 으로 조용히 바뀌는 문을 원천에서 막는다.
 * 여기서 검증하는 건 **모양뿐**(주소 형식·양의 정수)이다. "USDC·6자리·20/50/100" 같은 정책은
 * 호출자가 `gift-value-spec.js`로 이미 정한 뒤 넘겨야 한다 — 이 원시 계층은 정책을 모른다.
 */
export function attachGiftValue(record, value) {
  if (!isPlainObject(record)) return { ok: false, reason: "unknown_link", record };
  if (record.status !== CLAIM_STATUS.UNCLAIMED) return { ok: false, reason: "not_unclaimed", record };
  if (record.value !== null && record.value !== undefined) {
    return { ok: false, reason: "value_already_bound", record };
  }
  if (!isPlainObject(value)) return { ok: false, reason: "bad_value", record };
  const { tokenAddress, decimals, amountAtomic } = value;
  if (!ADDR.test(String(tokenAddress || ""))) return { ok: false, reason: "bad_token_address", record };
  if (!POSITIVE_INT(decimals)) return { ok: false, reason: "bad_decimals", record };
  if (!POSITIVE_INT(amountAtomic)) return { ok: false, reason: "bad_amount", record };
  return {
    ok: true,
    record: {
      ...record,
      value: Object.freeze({ tokenAddress: tokenAddress.trim(), decimals, amountAtomic }),
    },
  };
}

/** 레코드에 토큰 해시를 박는다. 이 단계를 거치지 않은 레코드는 claim 을 받지 못한다. */
export async function sealClaimLink(record, token) {
  if (!isPlainObject(record)) return null;
  const hash = await hashClaimToken(token);
  if (!hash) return null;
  return { ...record, claimTokenHash: hash };
}

/** 저장 직전 검사. 비밀 냄새가 나면 **저장을 거부한다**. */
export function isStorableLinkRecord(record) {
  if (!isPlainObject(record)) return false;
  if (record.version !== GIFT_LINK_VERSION) return false;
  if (!HEX64.test(String(record.claimTokenHash || ""))) return false;
  return findSecretLikeKey(record) === null;
}

/**
 * 링크 URL. 토큰은 **fragment 에** 둔다 — query 였다면 서버 로그·Referer 로 새어 나간다.
 */
export function buildClaimUrl(origin, { giftId, token, note = "", amountUsd = null } = {}) {
  const base = typeof origin === "string" ? origin.replace(/\/+$/, "") : "";
  if (!base || typeof giftId !== "string" || !giftId) return null;
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  const display = typeof note === "string" && note ? `&n=${encodeURIComponent(note.slice(0, 140))}` : "";
  const amount = [20, 50, 100].includes(Number(amountUsd)) ? `&a=${Number(amountUsd)}` : "";
  return `${base}/claim#g=${encodeURIComponent(giftId)}&t=${token}&v=${GIFT_LINK_VERSION}${display}${amount}`;
}

/** 받는 쪽이 연 URL 을 읽는다. 잘못된 링크를 **조용히 고치지 않는다**. */
export function parseClaimUrl(url) {
  if (typeof url !== "string" || !url) return { ok: false, reason: "empty" };
  const hashAt = url.indexOf("#");
  if (hashAt < 0) return { ok: false, reason: "no_fragment" };
  const params = new URLSearchParams(url.slice(hashAt + 1));
  const giftId = params.get("g") || "";
  const token = params.get("t") || "";
  const version = Number(params.get("v"));
  if (!giftId) return { ok: false, reason: "no_gift_id" };
  if (!TOKEN.test(token)) return { ok: false, reason: "bad_token" };
  if (version !== GIFT_LINK_VERSION) return { ok: false, reason: "version_mismatch" };
  const note = params.get("n") || "";
  const amountUsd = Number(params.get("a"));
  return { ok: true, giftId, token, note: note.slice(0, 140), amountUsd: [20, 50, 100].includes(amountUsd) ? amountUsd : null };
}

/**
 * 받는 사람이 **서명할 문장**. 결정적이어야 한다 — 같은 입력이면 같은 문장.
 * 보내는 주소·받는 주소·체인·링크 해시가 모두 묶여 있어서 다른 선물에 재사용될 수 없다.
 */
export function claimStatement({
  giftId, chainId, senderAddress, recipientAddress, claimTokenHash, claimedAt,
  // [A-560 PHASE 2] 값 있는 Gift 만 채운다. 셋 다 null 이면(레거시/identity-only) 문장은
  // A-495/A-499 와 **바이트 단위로 동일**하다 — 회귀 0. 하나라도 있으면 셋 다 유효해야 한다
  // (부분 바인딩은 애매한 문장을 만들 뿐이라 통째로 거부한다).
  tokenAddress = null, decimals = null, amountAtomic = null,
} = {}) {
  if (!giftId || !chainId || !claimedAt) return null;
  if (!ADDR.test(String(senderAddress || "")) || !ADDR.test(String(recipientAddress || ""))) return null;
  if (!HEX64.test(String(claimTokenHash || ""))) return null;
  const hasValue = tokenAddress !== null || decimals !== null || amountAtomic !== null;
  if (hasValue) {
    if (!ADDR.test(String(tokenAddress || ""))) return null;
    if (!Number.isInteger(decimals) || decimals <= 0) return null;
    if (!Number.isInteger(amountAtomic) || amountAtomic <= 0) return null;
  }
  const lines = [
    "araso gift claim v1",
    `gift:${giftId}`,
    `chain:${chainId}`,
    `from:${String(senderAddress).toLowerCase()}`,
    `to:${String(recipientAddress).toLowerCase()}`,
    `link:${claimTokenHash}`,
  ];
  if (hasValue) {
    lines.push(`token:${String(tokenAddress).toLowerCase()}`, `decimals:${decimals}`, `amount:${amountAtomic}`);
  }
  lines.push(`at:${claimedAt}`);
  return lines.join("\n");
}

/** 지금 이 링크를 열 수 있나. 토큰·만료·상태만 본다(아직 정체성은 묻지 않는다). */
export async function openClaimLink(record, token, { now } = {}) {
  if (!isPlainObject(record) || !HEX64.test(String(record.claimTokenHash || ""))) {
    return { result: CLAIM_RESULT.UNKNOWN_LINK };
  }
  const hash = await hashClaimToken(token);
  if (!hash || !timingSafeEqualHex(hash, record.claimTokenHash)) return { result: CLAIM_RESULT.BAD_TOKEN };
  if (record.status === CLAIM_STATUS.REVOKED) return { result: CLAIM_RESULT.REVOKED };
  if (record.expiresAt && typeof now === "string" && now >= record.expiresAt) return { result: CLAIM_RESULT.EXPIRED };
  if (record.status === CLAIM_STATUS.CLAIMED) {
    return { result: CLAIM_RESULT.ALREADY_CLAIMED_BY_OTHER, recipientAddress: record.recipientAddress };
  }
  return {
    result: CLAIM_RESULT.OK,
    giftId: record.giftId,
    senderAddress: record.senderAddress,
    chainId: record.chainId,
    claimTokenHash: record.claimTokenHash,
    note: record.note,
    // [A-560 PHASE 2] 받는 쪽이 화면에 보일 수 있는 **유일한 권위 있는** 금액/자산 —
    // 레코드 자신에게서 나온 것이지, URL/호출자가 지어낸 값이 아니다. 레거시 레코드는 null.
    value: record.value ?? null,
    // 화면에 대고 말할 것: **아직 돈은 움직이지 않았다.**
    transfer: { ...record.transfer },
  };
}

/**
 * claim 을 닫는다. **서명이 곧 소유 증명이다.**
 * `verifiedSignerAddress` 는 호출자가 **실제 서명 검증**으로 얻은 주소여야 한다(harness 가 그렇게 한다).
 * 그게 수령자 주소와 다르면 가장이므로 거부한다 — 여기서 봐주지 않는다.
 */
export async function settleClaim(record, {
  token,
  recipientAddress,
  verifiedSignerAddress,
  signatureFingerprint = null,
  claimedAt,
  now,
} = {}) {
  const to = typeof recipientAddress === "string" ? recipientAddress.trim() : "";
  const opened = await openClaimLink(record, token, { now });
  if (opened.result !== CLAIM_RESULT.OK) {
    if (opened.result === CLAIM_RESULT.ALREADY_CLAIMED_BY_OTHER && ADDR.test(to)
      && String(record.recipientAddress || "").toLowerCase() === to.toLowerCase()) {
      return { result: CLAIM_RESULT.ALREADY_CLAIMED_BY_SAME, record };
    }
    return { result: opened.result, record };
  }
  if (!ADDR.test(to)) return { result: CLAIM_RESULT.NO_RECIPIENT_IDENTITY, record };
  if (!ADDR.test(String(verifiedSignerAddress || ""))
    || String(verifiedSignerAddress).toLowerCase() !== to.toLowerCase()) {
    return { result: CLAIM_RESULT.NOT_PROVEN_BY_SIGNATURE, record };
  }
  if (to.toLowerCase() === String(record.senderAddress).toLowerCase()) {
    return { result: CLAIM_RESULT.SENDER_IS_RECIPIENT, record };
  }
  if (typeof claimedAt !== "string" || !claimedAt) return { result: CLAIM_RESULT.UNKNOWN_LINK, record };

  // [A-560 PHASE 2] 값 필드는 **레코드 자신의 것만** 쓴다 — 호출자가 넘긴 어떤 금액도 여기서
  // 신뢰하지 않는다. 이게 곧 tamper 방어다: 화면/호출자가 다른 금액을 보여주고 그 문장에 서명을
  // 받았다면, 여기서 다시 만든(레코드 진짜 값) 문장과 달라서 아래 statementHash 만 안 맞는 게
  // 아니라 — 애초에 그 서명이 검증된 진짜 문장과 다른 문장에 대한 것이므로 caller 가 넘겨야 하는
  // `verifiedSignerAddress`(실제 recover 결과) 자체가 recipient 와 달라져 이미 위에서 걸린다.
  const statement = claimStatement({
    giftId: record.giftId,
    chainId: record.chainId,
    senderAddress: record.senderAddress,
    recipientAddress: to,
    claimTokenHash: record.claimTokenHash,
    claimedAt,
    tokenAddress: record.value?.tokenAddress ?? null,
    decimals: record.value?.decimals ?? null,
    amountAtomic: record.value?.amountAtomic ?? null,
  });
  if (!statement) return { result: CLAIM_RESULT.UNKNOWN_LINK, record };

  return {
    result: CLAIM_RESULT.OK,
    record: {
      ...record,
      status: CLAIM_STATUS.CLAIMED,
      recipientAddress: to,
      claimedAt,
      // 증거는 **지문만** 남긴다. 서명 원문도, 그 어떤 비밀도 저장하지 않는다.
      claimProof: {
        statementHash: await sha256Hex(statement),
        signatureFingerprint: typeof signatureFingerprint === "string" ? signatureFingerprint.slice(0, 32) : null,
      },
      transfer: { ...record.transfer }, // **값 이동은 그대로 not_attempted 다.**
    },
  };
}

/** 주인이 아직 안 받은 링크를 되돌린다. 이미 받은 건 되돌릴 수 없다. */
export function revokeClaimLink(record) {
  if (!isPlainObject(record)) return { ok: false, reason: "unknown_link", record };
  if (record.status === CLAIM_STATUS.CLAIMED) return { ok: false, reason: "already_claimed", record };
  return { ok: true, record: { ...record, status: CLAIM_STATUS.REVOKED } };
}

/**
 * 값 이동 칸. **진짜 영수증이 없으면 아무 것도 기록하지 않는다.**
 * claim 이 닫혔다고 해서 돈이 왔다고 말하지 않기 위해 존재하는 문이다.
 */
export function attachTransferReceipt(record, receipt = {}) {
  if (!isPlainObject(record) || record.status !== CLAIM_STATUS.CLAIMED) {
    return { ok: false, reason: "not_claimed", record };
  }
  const txHash = typeof receipt.txHash === "string" ? receipt.txHash.trim() : "";
  const blockNumber = receipt.blockNumber;
  if (!TXHASH.test(txHash)) return { ok: false, reason: "no_real_tx_hash", record };
  if (!(Number.isInteger(blockNumber) && blockNumber > 0)) return { ok: false, reason: "no_block_number", record };
  if (receipt.status !== "success") return { ok: false, reason: "tx_not_successful", record };
  return { ok: true, record: { ...record, transfer: { status: TRANSFER_STATUS.SETTLED, txHash, blockNumber } } };
}

/** 화면이 절대 거짓말하지 않도록, 지금 무엇이 증명됐는지 **정확히** 말해 준다. */
export const PROOF_LEVEL = Object.freeze({
  UNKNOWN: "unknown",
  LINK_ONLY: "link_only",
  IDENTITY_CLAIMED_NO_VALUE_MOVED: "identity_claimed_no_value_moved",
  VALUE_TRANSFERRED: "value_transferred",
});

export function proofLevel(record) {
  if (!isPlainObject(record)) return PROOF_LEVEL.UNKNOWN;
  if (record.transfer?.status === TRANSFER_STATUS.SETTLED) return PROOF_LEVEL.VALUE_TRANSFERRED;
  if (record.status === CLAIM_STATUS.CLAIMED) return PROOF_LEVEL.IDENTITY_CLAIMED_NO_VALUE_MOVED;
  return PROOF_LEVEL.LINK_ONLY;
}

/** 두 주소가 정말 다른가 — 조회 가능한 형태로. */
export function claimParties(record) {
  if (!isPlainObject(record)) return null;
  const from = record.senderAddress || null;
  const to = record.recipientAddress || null;
  return {
    senderAddress: from,
    recipientAddress: to,
    distinct: !!from && !!to && from.toLowerCase() !== to.toLowerCase(),
    chainId: record.chainId || null,
  };
}
