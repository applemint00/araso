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

// [A-768 M-T-2 / M-F-3] 모양 검사 — 아니면 throw(호출부가 그 한 줄만 건너뛴다).
// 숫자 칸은 0 이상 정수 모양만. hash 칸은 **문자열**만(객체·숫자 등은 화면 코드가 .slice 에서 깨지는 줄이다);
// 0x+64 hex 모양 확인은 표시 직전(main.js receiptRows)에서 한다 — 모양이 아니면 원문 대신 "Unknown".
const UINT_RE = /^\d+$/;

/** 비어 있음(""/undefined/null) → "", 문자열 → 그대로, 그 밖(객체·숫자·배열…) → throw. */
function optionalHashString(value, field) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  throw new Error(`receipt: invalid ${field}`);
}

/** 0 이상 정수로 읽히는 값(bigint · 안전 정수 number · 숫자만 있는 문자열) → BigInt. 그 밖(undefined 포함)은 throw. */
function requiredUint(value, field) {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && UINT_RE.test(value)) return BigInt(value);
  throw new Error(`receipt: invalid ${field}`);
}

/** 선택 필드: 없음(undefined/null/""/0/0n) → 0n, 있으면 requiredUint 와 같은 검사. */
function optionalUint(value, field) {
  if (value === undefined || value === null || value === "" || value === 0 || value === 0n) return 0n;
  return requiredUint(value, field);
}

// ── legacy(shMON) — 지금까지 main.js readReceipts()/serializeReceiptRow() 에 있던 로직 그대로 ──
// [A-768 M-T-2] 숫자 칸은 0 이상 정수 모양만(BigInt("0x..")/" 12 " 같은 느슨한 변환 0), hash 칸은 문자열만.
// 어긋나면 throw — readReceipts/rememberReceipt 가 그 한 줄만 건너뛰고 나머지 이력은 지킨다.
function decodeLegacyRow(row) {
  return {
    before: requiredUint(row.before, "before"),
    after: requiredUint(row.after, "after"),
    gas: requiredUint(row.gas, "gas"),
    sent: requiredUint(row.sent, "sent"),
    txHash: optionalHashString(row.txHash, "txHash"),
    depositTxHash: optionalHashString(row.depositTxHash, "depositTxHash"),
    redeemTxHash: optionalHashString(row.redeemTxHash, "redeemTxHash"),
    grantTxHash: optionalHashString(row.grantTxHash, "grantTxHash"),
    depositBlockNumber: optionalUint(row.depositBlockNumber, "depositBlockNumber"),
    redeemBlockNumber: optionalUint(row.redeemBlockNumber, "redeemBlockNumber"),
    depositGasUsed: optionalUint(row.depositGasUsed, "depositGasUsed"),
    redeemGasUsed: optionalUint(row.redeemGasUsed, "redeemGasUsed"),
    shmonReceived: optionalUint(row.shmonReceived, "shmonReceived"),
    shmonAfterRedeem: optionalUint(row.shmonAfterRedeem, "shmonAfterRedeem"),
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

// [A-768 M-F-3] 저장 **전에** 검사한다: 필수 숫자(before/after/gas/sent)가 없거나 정수 모양이 아니면 throw — 예전처럼
// 문자열 "undefined" 를 써서 저장소 전체를 오염시키지 않는다(throw 는 rememberReceipt → receipt_store_unsound, 기록 유지).
// 쓰는 값은 예전과 같은 String(...) 모양이다.
function encodeLegacyRow(row) {
  return {
    before: String(requiredUint(row.before, "before")),
    after: String(requiredUint(row.after, "after")),
    gas: String(requiredUint(row.gas, "gas")),
    sent: String(requiredUint(row.sent, "sent")),
    txHash: optionalHashString(row.txHash, "txHash") || row.txHash,
    depositTxHash: optionalHashString(row.depositTxHash, "depositTxHash"),
    redeemTxHash: optionalHashString(row.redeemTxHash, "redeemTxHash"),
    grantTxHash: optionalHashString(row.grantTxHash, "grantTxHash"),
    depositBlockNumber: String(optionalUint(row.depositBlockNumber, "depositBlockNumber")),
    redeemBlockNumber: String(optionalUint(row.redeemBlockNumber, "redeemBlockNumber")),
    depositGasUsed: String(optionalUint(row.depositGasUsed, "depositGasUsed")),
    redeemGasUsed: String(optionalUint(row.redeemGasUsed, "redeemGasUsed")),
    shmonReceived: String(optionalUint(row.shmonReceived, "shmonReceived")),
    shmonAfterRedeem: String(optionalUint(row.shmonAfterRedeem, "shmonAfterRedeem")),
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
    // [A-931 G5] the grade travels with the receipt; an old row (no status) reads as UNKNOWN, never as confirmed. No migration, no UI.
    // pre-A-931 baseline: status dropped on decode
    status: nonEmptyString(row.status) ? row.status.trim() : "unknown", // = funding-entry.js FUNDING_STATE.UNKNOWN (same word; no import into this leaf codec)
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
    ...(nonEmptyString(receipt.status) ? { status: receipt.status.trim() } : {}), // [A-931 G5] pre-A-931 baseline: no status written
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
