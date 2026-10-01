// [receipt codec] 옛(legacy shMON) 영수증과 새 add_money 영수증이 **같은 저장소**를
// 안전하게 나눠 쓰게 한다.
//
// 규칙: `kind` 필드가 discriminator 다. 없으면 legacy(지금까지의 shMON 모양) — legacy 줄은
// **절대 `kind` 를 쓰지 않는다**(왕복 뒤에도 바이트/의미가 그대로다). `kind: "add_money"` 면
// 새 typed 줄이다.
//
// 이 파일이 하지 않는 일: BigInt 자리표시(placeholder) 채우기, 화면 문구 만들기. 값을 모르면
// throw 한다 — 호출부(main.js readReceipts)가 그 한 줄만 건너뛰고 나머지 이력은 지킨다
// (감사 버그 2: 예전엔 한 줄이 깨지면 BigInt("undefined") 가 던진 예외가
// readReceipts 전체를 [] 로 만들었다 — add_money 한 줄이 legacy 이력 전체를 지우면 안 된다).

export const RECEIPT_KIND = Object.freeze({ ADD_MONEY: "add_money" });

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT_RE = /^\d+(\.\d+)?$/;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// ── legacy(shMON) — 지금까지 main.js readReceipts()/serializeReceiptRow() 에 있던 로직 그대로 ──
function decodeLegacyRow(row) {
  return {
    before: BigInt(row.before),
    after: BigInt(row.after),
    gas: BigInt(row.gas),
    sent: BigInt(row.sent),
    txHash: row.txHash || "",
    depositTxHash: row.depositTxHash || "",
    redeemTxHash: row.redeemTxHash || "",
    grantTxHash: row.grantTxHash || "",
    depositBlockNumber: row.depositBlockNumber ? BigInt(row.depositBlockNumber) : 0n,
    redeemBlockNumber: row.redeemBlockNumber ? BigInt(row.redeemBlockNumber) : 0n,
    depositGasUsed: row.depositGasUsed ? BigInt(row.depositGasUsed) : 0n,
    redeemGasUsed: row.redeemGasUsed ? BigInt(row.redeemGasUsed) : 0n,
    shmonReceived: row.shmonReceived ? BigInt(row.shmonReceived) : 0n,
    shmonAfterRedeem: row.shmonAfterRedeem ? BigInt(row.shmonAfterRedeem) : 0n,
    // 옛 영수증에는 status 가 없다. 없으면 빈 값으로 두고 성공이라 넘겨짚지 않는다.
    status: row.status || "",
    at: row.at || 0,
    // 저장된 값이 비어 있지 않은 문자열일 때만 읽는다 — 없거나 빈칸/문자열이 아니면 owner
    // 필드 자체를 만들지 않는다(참고: history-filter.js receiptOwnerId()).
    ...(typeof row.piggyId === "string" && row.piggyId.trim() !== ""
      ? { piggyId: row.piggyId.trim() }
      : {}),
  };
}

function encodeLegacyRow(row) {
  return {
    before: String(row.before),
    after: String(row.after),
    gas: String(row.gas),
    sent: String(row.sent),
    txHash: row.txHash,
    depositTxHash: row.depositTxHash || "",
    redeemTxHash: row.redeemTxHash || "",
    grantTxHash: row.grantTxHash || "",
    depositBlockNumber: String(row.depositBlockNumber || 0n),
    redeemBlockNumber: String(row.redeemBlockNumber || 0n),
    depositGasUsed: String(row.depositGasUsed || 0n),
    redeemGasUsed: String(row.redeemGasUsed || 0n),
    shmonReceived: String(row.shmonReceived || 0n),
    shmonAfterRedeem: String(row.shmonAfterRedeem || 0n),
    status: row.status || "",
    at: row.at,
    ...(typeof row.piggyId === "string" && row.piggyId.trim() !== ""
      ? { piggyId: row.piggyId.trim() }
      : {}),
  };
}

// ── add_money — 원시 문자열 금액, 체인-scoped 신원. BigInt 자리표시 0. ──────────────────────
function decodeAddMoneyRow(row) {
  if (!nonEmptyString(row.chainId)) throw new Error("add_money: invalid chainId");
  if (!nonEmptyString(row.token) || !ADDR_RE.test(row.token.trim())) throw new Error("add_money: invalid token");
  if (typeof row.amount !== "string" || !AMOUNT_RE.test(row.amount)) throw new Error("add_money: invalid amount");
  if (!nonEmptyString(row.txHash)) throw new Error("add_money: invalid txHash");
  const at = typeof row.at === "string" || typeof row.at === "number" ? row.at : null;
  if (at === null) throw new Error("add_money: invalid at");

  let logIndex = null;
  if (row.logIndex !== undefined && row.logIndex !== null) {
    const n = Number(row.logIndex);
    if (!Number.isInteger(n) || n < 0) throw new Error("add_money: invalid logIndex");
    logIndex = n;
  }
  const blockNumber = nonEmptyString(row.blockNumber) ? row.blockNumber.trim() : null;

  return {
    kind: RECEIPT_KIND.ADD_MONEY,
    chainId: row.chainId.trim(),
    token: row.token.trim(),
    amount: row.amount,
    txHash: row.txHash.trim(),
    at,
    ...(logIndex !== null ? { logIndex } : {}),
    ...(blockNumber !== null ? { blockNumber } : {}),
    ...(typeof row.piggyId === "string" && row.piggyId.trim() !== "" ? { piggyId: row.piggyId.trim() } : {}),
  };
}

function encodeAddMoneyRow(receipt) {
  if (!nonEmptyString(receipt.chainId)) throw new Error("add_money: invalid chainId");
  if (!nonEmptyString(receipt.token)) throw new Error("add_money: invalid token");
  if (typeof receipt.amount !== "string" || !AMOUNT_RE.test(receipt.amount)) throw new Error("add_money: invalid amount");
  if (!nonEmptyString(receipt.txHash)) throw new Error("add_money: invalid txHash");
  return {
    kind: RECEIPT_KIND.ADD_MONEY,
    chainId: receipt.chainId,
    token: receipt.token,
    amount: receipt.amount,
    txHash: receipt.txHash,
    at: receipt.at,
    ...(receipt.logIndex !== undefined && receipt.logIndex !== null ? { logIndex: receipt.logIndex } : {}),
    ...(receipt.blockNumber !== undefined && receipt.blockNumber !== null ? { blockNumber: String(receipt.blockNumber) } : {}),
    ...(typeof receipt.piggyId === "string" && receipt.piggyId.trim() !== "" ? { piggyId: receipt.piggyId.trim() } : {}),
  };
}

/** 저장된 원시 줄(JSON) → 메모리 영수증. `kind` 로 갈라 탄다. */
export function decodeReceiptRow(row) {
  if (!row || typeof row !== "object") throw new Error("invalid_receipt_row");
  if (row.kind === RECEIPT_KIND.ADD_MONEY) return decodeAddMoneyRow(row);
  return decodeLegacyRow(row);
}

/** 메모리 영수증 → 저장할 원시 줄(JSON 이 담을 수 있는 모양). */
export function encodeReceiptRow(receipt) {
  if (!receipt || typeof receipt !== "object") throw new Error("invalid_receipt");
  if (receipt.kind === RECEIPT_KIND.ADD_MONEY) return encodeAddMoneyRow(receipt);
  return encodeLegacyRow(receipt);
}

/**
 * 중복-방지 신원 키. legacy 는 지금까지와 완전히 같다(redeemTxHash 우선, 없으면 txHash).
 * add_money 는 **체인까지 포함**한다 — 다른 체인에서 우연히 같은 tx 문자열이 나와도 합치지 않는다.
 */
export function receiptIdentityKey(receipt) {
  if (receipt && receipt.kind === RECEIPT_KIND.ADD_MONEY) {
    return ["add_money", receipt.chainId || "", receipt.txHash || "", receipt.logIndex ?? ""].join("|");
  }
  return (receipt && (receipt.redeemTxHash || receipt.txHash)) || "";
}
