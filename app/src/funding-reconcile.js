// [A-553 Lane C] 확인된 충전을 **측정된 절대 잔액**으로만 반영한다 — 요청/도착 금액을 더하지
// 않는다(재생(replay) 이 이중 적립이 되지 않는 이유는 "더하지 않고 다시 재는" 것뿐이다).
//
// 읽기는 **주입된 client** 로만 한다(퍼블릭 client 싱글톤을 여기서 직접 만들지 않는다) — 체인이
// 안 맞으면 호출부가 애초에 이 파일을 부르지 않는다(main.js settleFunding 의 책임).
// 이 파일은 **storage 에 쓰지 않는다** — 다음 피기 배열만 순수하게 돌려준다.
//
// 절대 하지 않는 일: permission-envelope.js import(권한과 이 파일은 다른 layer 다) ·
// 스테이블 = $1 가정(오직 valuation-source.js 의 fresh quote 로만 평가한다) · throw(읽기 실패는
// 값으로 돌아온다, 증거를 지우지 않는다).

import { valueAsset } from "./valuation-source.js";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

const BALANCE_OF_ABI = Object.freeze([
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
]);

/** 이 재조정을 다시 실행해도 되는지 판정할 중복-방지 키. */
export function reconcileEvidenceKey(evidence) {
  return [
    evidence?.chainId || "",
    evidence?.tokenAddress || "",
    evidence?.targetAddress || "",
    evidence?.txHash || "",
  ].join("|");
}

/**
 * 읽기 전용 ERC-20 balanceOf. **절대 throw 하지 않는다** — 실패는 `{ raw: null, error }` 로 온다.
 * `client` 는 viem 스타일 `readContract({address, abi, functionName, args})` 를 가진 객체다.
 */
export async function readErc20Balance({ client, tokenAddress, holderAddress } = {}) {
  if (!ADDR_RE.test(String(tokenAddress || ""))) return { raw: null, blockNumber: null, error: "invalid_token_address" };
  if (!ADDR_RE.test(String(holderAddress || ""))) return { raw: null, blockNumber: null, error: "invalid_holder_address" };
  if (!client || typeof client.readContract !== "function") return { raw: null, blockNumber: null, error: "no_client" };

  let raw;
  try {
    raw = await client.readContract({
      address: tokenAddress,
      abi: BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [holderAddress],
    });
  } catch {
    return { raw: null, blockNumber: null, error: "read_failed" };
  }
  if (typeof raw !== "bigint" || raw < 0n) return { raw: null, blockNumber: null, error: "unreadable_result" };

  let blockNumber = null;
  if (typeof client.getBlockNumber === "function") {
    try {
      const bn = await client.getBlockNumber();
      blockNumber = bn === null || bn === undefined ? null : String(bn);
    } catch {
      blockNumber = null; // 블록 번호는 부가정보다 — 못 읽어도 잔액 읽기 자체를 실패로 만들지 않는다
    }
  }
  return { raw, blockNumber, error: null };
}

function unitsToDecimalString(units, decimals) {
  const s = units.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = decimals === 0 ? "" : s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** 측정된 잔액 한 줄 — piggy-registry.js normalizeAsset 이 받는 모양 그대로(+source/blockNumber). */
export function measuredHoldingRow({ raw, decimals, tokenSymbol, assetId, measuredAt, blockNumber } = {}) {
  if (typeof raw !== "bigint" || raw < 0n) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (typeof tokenSymbol !== "string" || tokenSymbol.trim() === "") return null;
  if (typeof assetId !== "string" || assetId.trim() === "") return null;
  if (typeof measuredAt !== "string" || measuredAt.trim() === "") return null;
  return {
    assetId: assetId.trim(),
    symbol: tokenSymbol.trim(),
    quantity: unitsToDecimalString(raw, decimals),
    decimals,
    sourceTimestamp: measuredAt.trim(),
    source: "measured",
    ...(blockNumber !== null && blockNumber !== undefined ? { blockNumber: String(blockNumber) } : {}),
  };
}

/** 이 재조정이 **정확히 그 Piggy·그 주소·그 체인·그 자산**에 묶이는지 — id 만 믿지 않는다. */
export function assertReconcileBinding({ evidence, piggy, runtimeChainId } = {}) {
  if (!evidence) return { ok: false, error: "missing_evidence" };
  if (!piggy) return { ok: false, error: "missing_piggy" };
  if (typeof evidence.chainId !== "string" || evidence.chainId.trim() === "") return { ok: false, error: "missing_evidence_field:chainId" };
  if (!ADDR_RE.test(String(evidence.tokenAddress || ""))) return { ok: false, error: "missing_evidence_field:tokenAddress" };
  if (!ADDR_RE.test(String(evidence.targetAddress || ""))) return { ok: false, error: "missing_evidence_field:targetAddress" };
  if (typeof evidence.txHash !== "string" || evidence.txHash.trim() === "") return { ok: false, error: "missing_evidence_field:txHash" };

  const runtime = typeof runtimeChainId === "string" ? runtimeChainId.trim() : "";
  if (!runtime || evidence.chainId !== runtime) return { ok: false, error: "chain_mismatch" };
  if (typeof piggy.address !== "string" || piggy.address.toLowerCase() !== evidence.targetAddress.toLowerCase()) {
    return { ok: false, error: "piggy_address_mismatch" };
  }
  return { ok: true, error: null };
}

/**
 * 확인된 충전 하나를 레지스트리 투영에 반영한다. **storage 에 쓰지 않는다** — 다음 `piggies`
 * 배열만 돌려준다(저장은 호출부 몫). 읽기 실패는 `piggies` 를 그대로 두고(변경 0) 이유만 돌려준다.
 *
 * @returns {{ ok, reason, piggies, valuationKnown, dedupeKey }}
 *   valuationKnown: true(평가됨) | false(평가 못 함 — birth_unfunded $0 는 지운다) | null(재조정 자체가 안 됨)
 */
export async function reconcileConfirmedFunding({
  evidence, piggies = [], client, runtimeChainId, priceQuote = null, now, seenEvidenceKeys = new Set(),
} = {}) {
  const rows = Array.isArray(piggies) ? piggies.map((p) => ({ ...p, assets: [...(p.assets || [])] })) : [];
  const key = reconcileEvidenceKey(evidence);

  if (seenEvidenceKeys.has(key)) {
    return { ok: true, reason: "already_reconciled", piggies: rows, valuationKnown: null, dedupeKey: key };
  }

  const piggy = rows.find((p) => p.id === evidence?.targetPiggyId) || null;
  const binding = assertReconcileBinding({ evidence, piggy, runtimeChainId });
  if (!binding.ok) {
    return { ok: false, reason: binding.error, piggies: rows, valuationKnown: null, dedupeKey: key };
  }

  const read = await readErc20Balance({ client, tokenAddress: evidence.tokenAddress, holderAddress: piggy.address });
  if (read.error || read.raw === null) {
    // 읽기 실패 — 증거(영수증)는 이미 다른 layer 가 지킨다. 여기서는 잔액/평가를 그대로 둔다.
    return { ok: false, reason: "balance_read_failed", piggies: rows, valuationKnown: null, dedupeKey: key };
  }

  const measuredAt = typeof now === "string" && now.trim() !== "" ? now : new Date().toISOString();
  const holding = measuredHoldingRow({
    raw: read.raw,
    decimals: evidence.decimals,
    tokenSymbol: evidence.assetSymbol,
    assetId: evidence.tokenAddress,
    measuredAt,
    blockNumber: read.blockNumber,
  });
  if (!holding) return { ok: false, reason: "measured_row_invalid", piggies: rows, valuationKnown: null, dedupeKey: key };

  const idx = rows.findIndex((p) => p.id === piggy.id);
  const otherAssets = (rows[idx].assets || []).filter((a) => a.assetId !== holding.assetId);
  rows[idx] = { ...rows[idx], assets: [...otherAssets, holding] };

  // 평가: **fresh quote 가 있을 때만** 값을 매긴다. 없으면 옛 birth_unfunded $0 을 거짓 $0 으로
  // 남기지 않고 모름(null)으로 되돌린다 — 스테이블 = $1 가정은 어디에도 없다.
  let valuationKnown = null;
  const nowMs = typeof now === "number" ? now : Date.now();
  if (priceQuote) {
    const valued = valueAsset({ quantity: holding.quantity, decimals: holding.decimals, quote: priceQuote, nowMs });
    if (valued.usd !== null) {
      rows[idx] = { ...rows[idx], valuation: { usd: valued.usd, source: valued.source, at: measuredAt } };
      valuationKnown = true;
    } else {
      valuationKnown = false;
      if (rows[idx].valuation && rows[idx].valuation.source === "birth_unfunded") {
        rows[idx] = { ...rows[idx], valuation: null };
      }
    }
  } else if (rows[idx].valuation && rows[idx].valuation.source === "birth_unfunded") {
    valuationKnown = false;
    rows[idx] = { ...rows[idx], valuation: null };
  }

  seenEvidenceKeys.add(key);
  return { ok: true, reason: null, piggies: rows, valuationKnown, dedupeKey: key };
}
