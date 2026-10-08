// [A-869] Server-owned Gift gas policy. Fail closed: any missing/invalid budget field => policy = null => every
// request refused (503). Gift budgets are SEPARATE from /grant policy (policy.mjs) on purpose.
// valueWei is ALWAYS derived here; the request never carries an amount.

export const GIFT_GAS_LIMIT = 21_000n; // plain native transfer only

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const GIFT_ID = /^0x[0-9a-f]{64}$/; // lowercase bytes32 only (uppercase is refused, not normalised)
const ZERO_ADDR = `0x${"0".repeat(40)}`;

const FIELDS = ["valueWei", "minGiftWei", "perSenderMaxCount", "perSenderMaxWei", "globalMaxCount", "globalMaxWei", "relayerMinBalanceWei", "maxGasPriceWei"];

function posBig(v) {
  try {
    if (typeof v === "bigint") return v > 0n ? v : null;
    if (typeof v === "string" && /^[0-9]+$/.test(v)) { const b = BigInt(v); return b > 0n ? b : null; }
    if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return BigInt(v);
  } catch { /* fallthrough */ }
  return null;
}

/** cfg: every field in FIELDS plus chainId and relayerAddress. Unset/invalid anything => null (fail closed). */
export function createGiftGasPolicy(cfg) {
  if (typeof cfg !== "object" || cfg === null) return null;
  const out = {};
  for (const f of FIELDS) {
    const b = posBig(cfg[f]);
    if (b === null) return null;
    out[f] = b;
  }
  if (!Number.isSafeInteger(cfg.chainId) || cfg.chainId <= 0) return null;
  if (typeof cfg.relayerAddress !== "string" || !ADDR.test(cfg.relayerAddress)) return null;
  if (out.perSenderMaxWei < out.valueWei || out.globalMaxWei < out.perSenderMaxWei || out.globalMaxCount < out.perSenderMaxCount) return null;
  return Object.freeze({
    ...out,
    chainId: cfg.chainId,
    relayerAddress: cfg.relayerAddress.toLowerCase(),
    gasLimit: GIFT_GAS_LIMIT,
    limits: Object.freeze({
      perSenderMaxCount: out.perSenderMaxCount,
      perSenderMaxWei: out.perSenderMaxWei,
      globalMaxCount: out.globalMaxCount,
      globalMaxWei: out.globalMaxWei,
    }),
  });
}

/** Server-derived amount. The client never supplies (or can raise) it. */
export function deriveValueWei(policy) {
  if (!policy) throw new Error("POLICY_UNSET");
  return policy.valueWei;
}

/** Strict request shape: exactly { giftId, to }. Anything else (amount, token, allowanceRef, ...) => refused. */
export function validateGiftGasRequest(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false };
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes("giftId") || !keys.includes("to")) return { ok: false };
  if (typeof body.giftId !== "string" || !GIFT_ID.test(body.giftId)) return { ok: false };
  if (typeof body.to !== "string" || !ADDR.test(body.to)) return { ok: false };
  const to = body.to.toLowerCase();
  if (to === ZERO_ADDR) return { ok: false };
  return { ok: true, giftId: body.giftId, to };
}
