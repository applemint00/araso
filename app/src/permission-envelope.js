// [A-492 Lane A] 돈을 움직이는 **단 한 번의 승인**을 담는 봉투.
//
// 규율:
//  · `awaiting_permission` → `permitted` 로 가는 길은 **Face ID/passkey 승인 하나뿐**이다.
//    클릭도, 저장된 선호도, draft 도, READY 판정도, fork PASS 도 **권한을 만들지 않는다.**
//  · 봉투 하나는 **행동 하나**에만 쓴다. 다른 Piggy·다른 행동·다른 금액·다른 자산·
//    다른 목적지·나중의 무관한 작업에 **재사용되지 않는다.**
//  · 승인 취소/실패는 **아무것도 바꾸지 않는다.**
//  · 결과를 모르면 **자동 재시도하지 않는다** — 먼저 대조한다.
//
// 이 파일은 **서명하지 않는다.** 인증 자체는 기존 Mera/passkey 경로가 하고,
// 여기서는 그 결과를 **범위가 좁혀진 봉투**로 바꾼다. 두 번째 인증 스택을 만들지 않는다.

export const PERMISSION_STATE = Object.freeze({
  CHOOSING: "choosing",
  AWAITING: "awaiting_permission",
  PERMITTED: "permitted",
  CONSUMED: "consumed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

// 봉투는 오래 살지 않는다. 화면을 띄워 둔 채 잊은 승인이 나중에 쓰이면 안 된다.
export const DEFAULT_PERMISSION_TTL_MS = 2 * 60 * 1000;

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^\d+(\.\d+)?$/;

function invalid(reason) {
  return { envelope: null, error: reason };
}

/**
 * 인증이 성공한 **뒤에만** 부른다. 인증 자체는 여기서 하지 않는다.
 *
 * @param {object} p
 * @param {object} p.intent  { piggyId, signerAddress, action, asset, amount, chain, destination? }
 *   [A-512] `signerAddress` = 그 Piggy 로 **실제 파생된** 서명자 주소. 없으면 봉투도 없다.
 * @param {object} p.auth    { method: "passkey", verifiedAt, credentialId? }  — **비밀값은 받지 않는다**
 * @param {string} p.nonce   중복 실행을 막는 키
 * @param {number} p.nowMs
 */
export function issuePermission({ intent = {}, auth = null, nonce = null, nowMs = Date.now(), ttlMs = DEFAULT_PERMISSION_TTL_MS } = {}) {
  // 인증이 없으면 봉투도 없다. 이게 이 파일의 전부다.
  if (!auth || auth.method !== "passkey") return invalid("no_passkey_auth");
  if (auth.verified !== true) return invalid("auth_not_verified");
  if (typeof auth.verifiedAt !== "number" || !Number.isFinite(auth.verifiedAt)) return invalid("auth_missing_time");
  if (auth.verifiedAt > nowMs) return invalid("auth_time_in_future");
  // 승인은 **지금 것**이어야 한다. 예전 인증을 끌어다 쓰지 않는다.
  if (nowMs - auth.verifiedAt > ttlMs) return invalid("auth_stale");
  // 비밀값이 섞여 들어오면 봉투를 만들지 않는다.
  for (const key of Object.keys(auth)) {
    if (/secret|privatekey|private_key|prf|seed|mnemonic|signingkey/i.test(key)) return invalid(`secret_like_field:${key}`);
  }

  const piggyId = typeof intent.piggyId === "string" ? intent.piggyId.trim() : "";
  const action = typeof intent.action === "string" ? intent.action.trim() : "";
  const asset = typeof intent.asset === "string" ? intent.asset.trim() : "";
  const amount = typeof intent.amount === "string" ? intent.amount.trim() : "";
  const chain = typeof intent.chain === "string" ? intent.chain.trim() : "";
  if (!piggyId) return invalid("missing_piggy");
  const signerAddress = typeof intent.signerAddress === "string" ? intent.signerAddress.trim() : "";
  if (!ADDR.test(signerAddress)) return invalid("missing_signer");
  if (!action) return invalid("missing_action");
  if (!asset) return invalid("missing_asset");
  // **`all` 은 봉투에 들어오기 전에 정확한 수량으로 풀려 있어야 한다.**
  if (!AMOUNT.test(amount) || Number(amount) <= 0) return invalid("amount_not_exact");
  if (!chain) return invalid("missing_chain");

  // 목적지가 있는 행동이면 **주소가 봉투에 묶인다**.
  const destination = typeof intent.destination === "string" ? intent.destination.trim() : null;
  if (intent.destinationRequired === true) {
    if (!destination || !ADDR.test(destination)) return invalid("destination_invalid");
  } else if (destination && !ADDR.test(destination)) {
    return invalid("destination_invalid");
  }

  const key = typeof nonce === "string" && nonce.trim() !== "" ? nonce.trim() : null;
  if (!key) return invalid("missing_nonce");

  return {
    envelope: Object.freeze({
      state: PERMISSION_STATE.PERMITTED,
      piggyId, signerAddress, action, asset, amount, chain,
      destination: destination || null,
      nonce: key,
      issuedAt: nowMs,
      expiresAt: nowMs + ttlMs,
      authMethod: auth.method,
      // 자격증명 **식별자**만 남긴다. 비밀은 담지 않는다.
      credentialId: typeof auth.credentialId === "string" ? auth.credentialId : null,
    }),
    error: null,
  };
}

const lc = (a) => (typeof a === "string" ? a.toLowerCase() : "");

/**
 * 실행 직전 대조. **봉투가 지금 하려는 그 일과 정확히 같은가.**
 * 하나라도 어긋나면 실행하지 않는다.
 *
 * [A-512 Gate C] `context` 는 **지금** 고른 Piggy 와 살아 있는 서명자다 — 필수.
 * 봉투의 piggyId·signerAddress 와 요청, 고른 Piggy(id·주소), 활성 서명자 주소가
 * **전부 같아야** 통과한다. 하나라도 없거나 다르면 tx 를 만들기 전에 멈춘다.
 */
export function authorize(envelope, request = {}, { nowMs = Date.now(), consumedNonces = null, context = null } = {}) {
  if (!envelope || envelope.state !== PERMISSION_STATE.PERMITTED) return { ok: false, reason: "no_permission" };
  if (nowMs > envelope.expiresAt) return { ok: false, reason: "permission_expired" };
  // 한 번 쓴 봉투는 다시 쓰지 않는다.
  if (consumedNonces && consumedNonces.has(envelope.nonce)) return { ok: false, reason: "permission_already_used" };

  if (!ADDR.test(envelope.signerAddress || "")) return { ok: false, reason: "envelope_missing_signer" };
  if (!context || !context.selectedPiggyId || !ADDR.test(context.selectedPiggyAddress || "") || !ADDR.test(context.activeSignerAddress || "")) {
    return { ok: false, reason: "no_selection_context" };
  }
  if (context.selectedPiggyId !== envelope.piggyId) return { ok: false, reason: "selected_piggy_mismatch" };
  if (lc(context.selectedPiggyAddress) !== lc(envelope.signerAddress)) return { ok: false, reason: "selected_address_mismatch" };
  if (lc(context.activeSignerAddress) !== lc(envelope.signerAddress)) return { ok: false, reason: "active_signer_mismatch" };
  if (lc(request.signerAddress) !== lc(envelope.signerAddress)) return { ok: false, reason: "signer_mismatch" };

  if (envelope.piggyId !== request.piggyId) return { ok: false, reason: "piggy_mismatch" };
  if (envelope.action !== request.action) return { ok: false, reason: "action_mismatch" };
  if (envelope.asset !== request.asset) return { ok: false, reason: "asset_mismatch" };
  if (envelope.amount !== request.amount) return { ok: false, reason: "amount_mismatch" };
  if (envelope.chain !== request.chain) return { ok: false, reason: "chain_mismatch" };
  const wanted = typeof request.destination === "string" ? request.destination.trim() : null;
  if ((envelope.destination || null) !== (wanted || null)) return { ok: false, reason: "destination_mismatch" };

  return { ok: true, reason: null, nonce: envelope.nonce };
}

/** 사용 완료 표시. 같은 봉투로 두 번 움직이지 못하게 한다. */
export function consume(envelope, consumedNonces) {
  if (!envelope || !consumedNonces) return { consumed: false };
  consumedNonces.add(envelope.nonce);
  return { consumed: true, state: PERMISSION_STATE.CONSUMED };
}

/** 취소/실패 — **아무것도 바꾸지 않는다.** 상태만 돌려준다. */
export function cancel(reason = "user_cancelled") {
  return { state: PERMISSION_STATE.CANCELLED, reason, envelope: null, mutated: false };
}

/**
 * 결과를 모를 때. **자동 재시도하지 않는다.**
 * 먼저 이미 나간 작업이 있는지 대조하라고 알려 준다.
 */
export function onUnknownOutcome(envelope) {
  return {
    retry: false,
    action: "reconcile_first",
    reason: "unknown_outcome_must_reconcile",
    nonce: envelope?.nonce ?? null,
  };
}

/** 이 행동에 쓸 nonce. 같은 의도면 같은 값이 나온다. */
export function permissionNonce({ piggyId, action, asset, amount, chain, destination, at }) {
  return [piggyId || "", action || "", asset || "", amount || "", chain || "", destination || "", at || ""].join("|");
}
