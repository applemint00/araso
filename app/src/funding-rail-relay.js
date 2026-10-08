// [A-872] Add Money funding rail adapter: Relay (api.relay.link). ISOLATED PROTOTYPE.
//
// Quote / validate / build-plan ONLY. This module never sends, signs, broadcasts, or touches the
// network: `fetchImpl` is injected by the caller (tests use fake fetch fixtures). It is not wired
// into funding-entry.js / add-money.js / main.js / UI.
//
// Contract source: A-861 TERMINAL (OUTBOX). Everything here fails closed: any token / recipient /
// chain / amount mismatch, or any missing safety field, yields ok:false with reason codes and NO
// build plan.
//
// Gas top-up boundary: `topupGas` is OFF by default. If a caller opts in explicitly, the USDC
// deducted for the gas top-up comes out of the user's USDC, so gross and net USDC are returned
// separately and the net (what the user actually receives as USDC) is what must be shown.
// No universal price-impact threshold is hard-coded (BUILD_PLAN.md:1835); the caller supplies one
// via `maxImpactPercent`, and without it the impact is reported but never judged.

// [A-901] Same-origin proxy path (api/relay-quote.js adds the server-side x-api-key and forwards ONLY to https://api.relay.link/quote/v2).
// Pre-A-901 baseline was "https://api.relay.link".
export const RELAY_API_BASE = "/api/relay-quote";
export const MONAD_CHAIN_ID = 143;
// [A-901 C1] /chains snapshot name label for Monad (143), seen in the live quote/v2 capture; used only to classify refund legs.
export const RELAY_DEST_LABEL = "monad";
// Circle native USDC on Monad (A-861 VERIFIED-CURRENT).
export const MONAD_USDC_ADDRESS = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
export const MONAD_USDC_DECIMALS = 6;

// [A-895 P-A] quote/v2 (the legacy /quote is deprecated). Data only: this module never fetches by itself.
export const RELAY_QUOTE_V2_PATH = "/quote/v2";

// [A-895 P-A] Pinned origin-chain targets, keyed by ORIGIN chain id (A-885 G1: target checks are keyed to the
// origin chain; docs "always use the transaction targets returned by your quote" is NOT sufficient, the
// input-validation procedure takes the depository from GET /chains and never from the quote).
// Source: api.relay.link/chains, fetched 2026-10-07, A-886 raw/relay-chains.json sha256 6c1bc34a...f4329.
// Only chains whose depository was checked in the A-886 SIM (Base block 52288754) are pinned; any other origin
// fails closed (origin_chain_not_pinned). Adding a chain = a reviewed edit of this table, never a runtime input.
export const RELAY_PINNED_CHAINS = Object.freeze({
  8453: Object.freeze({
    name: "base",
    v2Depository: "0x4cd00e387622c35bddb9b4c962c136462338bc31",
    snapshot: "api.relay.link/chains 2026-10-07 sha256 6c1bc34ad2df545a8936383f2cc7f6b17eb88db4c0cdd1a830352f0eca3f4329",
  }),
});
// RelayDepository (protocol v2) selectors; both seen in the deployed Base bytecode (A-886 RECEIPT §1).
export const RELAY_DEPOSIT_ERC20_SELECTOR = "0xe8017952"; // depositErc20(address depositor,address token,uint256 amount,bytes32 id)
export const RELAY_DEPOSIT_NATIVE_SELECTOR = "0x49290c1c"; // depositNative(address depositor,bytes32 id) payable
const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
// Upper bound for an orderData.deadline in unix SECONDS (2100-01-01). A larger number is most likely
// milliseconds (or garbage): the unit is unproven, so it fails closed instead of reading as "far future".
const MAX_DEADLINE_SEC = 4102444800;
const MAX_QUOTE_STEPS = 16;
const MAX_STEP_ITEMS = 16;

export const RELAY_REASON = Object.freeze({
  BAD_INPUT: "bad_input",
  BAD_QUOTE_SHAPE: "bad_quote_shape",
  DEST_CHAIN_MISMATCH: "dest_chain_mismatch",
  DEST_TOKEN_MISMATCH: "dest_token_mismatch",
  RECIPIENT_MISMATCH: "recipient_mismatch",
  ORIGIN_MISMATCH: "origin_mismatch",
  MISSING_MIN_OUT: "missing_min_out",
  MIN_OUT_ABOVE_OUT: "min_out_above_out",
  MIN_OUT_TOO_LOW: "min_out_too_low",
  MISSING_ETA: "missing_eta",
  ETA_TOO_LONG: "eta_too_long",
  MISSING_IMPACT: "missing_impact",
  IMPACT_TOO_HIGH: "impact_too_high",
  MISSING_REQUEST_ID: "missing_request_id",
  NO_STEPS: "no_steps",
  STEP_CHAIN_MISMATCH: "step_chain_mismatch",
  TOPUP_NOT_REQUESTED: "topup_not_requested",
  TOPUP_AMOUNT_INVALID: "topup_amount_invalid",
  TOPUP_NET_INVALID: "topup_net_invalid",
  TOPUP_MISSING: "topup_missing",
  TOPUP_MISMATCH: "topup_mismatch",
  STEP_NO_DATA: "step_no_data",
  STEP_VALUE_NONZERO: "step_value_nonzero",
  STEP_TO_MISMATCH: "step_to_mismatch",
  REQUEST_ID_MISMATCH: "request_id_mismatch",
  APPROVE_MALFORMED: "approve_malformed",
  APPROVE_EXCEEDS_INPUT: "approve_exceeds_input",
  HTTP_ERROR: "http_error",
  FETCH_FAILED: "fetch_failed",
  // [A-895 P-A] calldata binding
  PAYER_INVALID: "payer_invalid",
  ORIGIN_CHAIN_NOT_PINNED: "origin_chain_not_pinned",
  PROTOCOL_V2_MISSING: "protocol_v2_missing",
  PAYMENT_DETAILS_MISMATCH: "payment_details_mismatch",
  STEPS_TOO_MANY: "steps_too_many",
  STEP_UNEXPECTED_CALL: "step_unexpected_call",
  DEPOSIT_STEP_COUNT: "deposit_step_count",
  DEPOSIT_WRONG_CHAIN: "deposit_wrong_chain",
  DEPOSIT_TARGET_NOT_DEPOSITORY: "deposit_target_not_depository",
  DEPOSIT_UNDECODABLE: "deposit_undecodable",
  DEPOSIT_ID_NOT_ORDER_ID: "deposit_id_not_order_id",
  DEPOSIT_DEPOSITOR_NOT_PAYER: "deposit_depositor_not_payer",
  DEPOSIT_AMOUNT_NOT_INPUT: "deposit_amount_not_input",
  DEPOSIT_TOKEN_NOT_SOURCE: "deposit_token_not_source",
  DEPOSIT_FUNCTION_MISMATCH: "deposit_function_mismatch",
  DEPOSIT_VALUE_INVALID: "deposit_value_invalid",
  APPROVE_COUNT: "approve_count",
  APPROVE_SPENDER_NOT_DEPOSITORY: "approve_spender_not_depository",
  APPROVE_AMOUNT_NOT_INPUT: "approve_amount_not_input",
  APPROVE_AFTER_DEPOSIT: "approve_after_deposit",
  SENDER_NOT_PAYER: "sender_not_payer",
  ORDER_DEADLINE_UNKNOWN: "order_deadline_unknown",
  ORDER_EXPIRED: "order_expired",
  // [A-901 D2] live quote/v2 shape: chain label mapping + refund recipients
  PAYMENT_CHAIN_UNMAPPED: "payment_chain_unmapped",
  REFUND_RECIPIENT_NOT_REFUNDTO: "refund_recipient_not_refundto",
  REFUND_CHAIN_UNMAPPED: "refund_chain_unmapped",
  // [A-909 R1] orderData.output / inputs[].payment binding to OUR request
  ORDER_OUTPUT_MISSING: "order_output_missing",
  ORDER_OUTPUT_CHAIN_MISMATCH: "order_output_chain_mismatch",
  ORDER_OUTPUT_RECIPIENT_MISMATCH: "order_output_recipient_mismatch",
  ORDER_OUTPUT_CURRENCY_MISMATCH: "order_output_currency_mismatch",
  ORDER_INPUT_CHAIN_MISMATCH: "order_input_chain_mismatch",
});

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
// [A-895] ADDR_RE.test() coerces its argument to a string: ["0x…"] would pass. Addresses must BE strings.
const isAddr = (x) => typeof x === "string" && ADDR_RE.test(x);
const sameAddr = (a, b) => typeof a === "string" && typeof b === "string" && ADDR_RE.test(a) && ADDR_RE.test(b) && a.toLowerCase() === b.toLowerCase();
/** own-property read (a polluted Object.prototype cannot fill a missing field). Not Object.hasOwn. */
const gOwn = (o, k) => (o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/**
 * [A-895 C1/I1] Snapshot untrusted JSON data ONCE into null-prototype objects: no inherited field can exist on the
 * copy, and getters/Proxies are read exactly once. Returns undefined when unreadable or larger than maxChars.
 */
export function snapshotRelayJson(value, maxChars = 262144) {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== "string" || text.length > maxChars) return undefined;
    return JSON.parse(text, (k, v) => {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        const o = Object.create(null);
        for (const key of Object.keys(v)) o[key] = v[key];
        return o;
      }
      return v;
    });
  } catch { return undefined; }
}

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isUintStr = (s) => typeof s === "string" && /^\d+$/.test(s);

function toBig(v) {
  if (typeof v === "bigint") return v >= 0n ? v : null;
  if (isUintStr(v)) return BigInt(v);
  return null;
}

/** 6-decimal base units (bigint) -> decimal string. */
export function formatUnits(units, decimals = MONAD_USDC_DECIMALS) {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const s = abs.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
}

/** Decimal string -> base units bigint, or null if not an exact non-negative decimal within `decimals`. */
export function parseUnits(str, decimals = MONAD_USDC_DECIMALS) {
  if (typeof str !== "string") return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(str);
  if (!m) return null;
  const frac = m[2] || "";
  if (frac.length > decimals) return null;
  return BigInt(m[1] + frac.padEnd(decimals, "0"));
}

/**
 * Build the Relay quote/v2 request body (data only; nothing is sent).
 * Destination is hard-pinned to Monad native USDC. topupGas is false unless explicitly true.
 * [A-895 P-A F4] `refundTo` is REQUIRED and explicit (A-885: the OpenAPI default and the Refunds doc contradict
 * each other, so nothing is left to a default), and `includeProtocolData:true` is always set so the response
 * carries protocol.v2 (orderId / orderData) for the on-chain input-validation.
 */
export function buildRelayQuoteRequest({
  user, recipient, refundTo, originChainId, originCurrency, amount,
  topupGas = false, topupGasAmount,
} = {}) {
  const errors = [];
  if (!isAddr(user)) errors.push("user");
  if (!isAddr(recipient)) errors.push("recipient");
  if (!isAddr(refundTo)) errors.push("refundTo");
  if (!Number.isInteger(originChainId) || originChainId <= 0) errors.push("originChainId");
  if (!isAddr(originCurrency)) errors.push("originCurrency");
  const amt = toBig(amount);
  if (amt === null || amt === 0n) errors.push("amount");
  if (topupGas !== false && topupGas !== true) errors.push("topupGas");
  const body = {
    user,
    recipient,
    refundTo,
    originChainId,
    originCurrency,
    destinationChainId: MONAD_CHAIN_ID,
    destinationCurrency: MONAD_USDC_ADDRESS,
    tradeType: "EXACT_INPUT",
    amount: amt === null ? undefined : amt.toString(),
    topupGas: false,
    includeProtocolData: true,
  };
  if (topupGas === true) {
    // Explicit opt-in only. Amount is USD in 6 decimals (1000000 = $1) per A-861.
    const t = toBig(topupGasAmount);
    if (t === null || t === 0n) errors.push("topupGasAmount");
    else {
      body.topupGas = true;
      body.topupGasAmount = t.toString();
    }
  }
  if (errors.length) return { ok: false, reasons: [RELAY_REASON.BAD_INPUT], errors, request: null };
  return { ok: true, reasons: [], errors: [], request: body };
}

function pickDecimal(...cands) {
  for (const c of cands) {
    const b = toBig(c);
    if (b !== null) return b;
  }
  return null;
}

/**
 * Normalize + validate a Relay quote response against the request the caller intended.
 * Returns { ok, reasons[], quote|null, plan|null }. ok only when EVERY check passes.
 *
 * expected: { recipient, originChainId?, originCurrency?, amount?, topupGas?(default false),
 *             maxImpactPercent?, maxEtaSeconds?, minOutFloor? (base units, optional) }
 */
export function validateRelayQuote(raw, expected = {}) {
  const reasons = [];
  const fail = (r) => { if (!reasons.includes(r)) reasons.push(r); };

  if (!isObj(raw) || !isObj(raw.details)) {
    return { ok: false, reasons: [RELAY_REASON.BAD_QUOTE_SHAPE], quote: null, plan: null };
  }
  if (!isAddr(expected.recipient) || !Number.isInteger(expected.originChainId) || expected.originChainId <= 0) {
    return { ok: false, reasons: [RELAY_REASON.BAD_INPUT], quote: null, plan: null };
  }
  const topupRequested = expected.topupGas === true;
  const d = raw.details;
  const cin = isObj(d.currencyIn) ? d.currencyIn : {};
  const cout = isObj(d.currencyOut) ? d.currencyOut : {};
  const curOut = isObj(cout.currency) ? cout.currency : {};
  const curIn = isObj(cin.currency) ? cin.currency : {};

  // --- destination chain + token (native USDC on Monad) ---
  if (curOut.chainId !== MONAD_CHAIN_ID) fail(RELAY_REASON.DEST_CHAIN_MISMATCH);
  if (!sameAddr(curOut.address, MONAD_USDC_ADDRESS)) fail(RELAY_REASON.DEST_TOKEN_MISMATCH);
  if (curOut.decimals !== MONAD_USDC_DECIMALS) fail(RELAY_REASON.DEST_TOKEN_MISMATCH);

  // --- recipient ---
  if (!sameAddr(d.recipient, expected.recipient)) fail(RELAY_REASON.RECIPIENT_MISMATCH);

  // --- origin (when the caller pinned it) ---
  if (curIn.chainId !== expected.originChainId) fail(RELAY_REASON.ORIGIN_MISMATCH);
  if (expected.originCurrency !== undefined && !sameAddr(curIn.address, expected.originCurrency)) fail(RELAY_REASON.ORIGIN_MISMATCH);
  const inAmt = toBig(cin.amount);
  if (inAmt === null || inAmt === 0n) fail(RELAY_REASON.ORIGIN_MISMATCH);
  if (expected.amount !== undefined) {
    const want = toBig(expected.amount);
    if (inAmt === null || want === null || inAmt !== want) fail(RELAY_REASON.ORIGIN_MISMATCH);
  }

  // --- amounts: out (gross USDC delivered by the route) and minimumAmount (minOut) ---
  const outAmt = toBig(cout.amount);
  const minAmt = toBig(isObj(d.currencyOut) ? cout.minimumAmount : undefined) ?? toBig(d.minimumAmount);
  if (outAmt === null) fail(RELAY_REASON.BAD_QUOTE_SHAPE);
  if (minAmt === null || minAmt === 0n) fail(RELAY_REASON.MISSING_MIN_OUT);
  if (outAmt !== null && minAmt !== null && minAmt > outAmt) fail(RELAY_REASON.MIN_OUT_ABOVE_OUT);
  if (expected.minOutFloor !== undefined) {
    const floor = toBig(expected.minOutFloor);
    if (floor === null || minAmt === null || minAmt < floor) fail(RELAY_REASON.MIN_OUT_TOO_LOW);
  }

  // --- ETA ---
  const eta = d.timeEstimate;
  if (typeof eta !== "number" || !Number.isFinite(eta) || eta < 0) fail(RELAY_REASON.MISSING_ETA);
  else if (expected.maxEtaSeconds !== undefined && eta > expected.maxEtaSeconds) fail(RELAY_REASON.ETA_TOO_LONG);

  // --- total impact (reported; judged only against a caller-supplied threshold) ---
  const ti = isObj(d.totalImpact) ? d.totalImpact : null;
  const pc = ti ? ti.percent : undefined;
  const pcOk = (typeof pc === "number") || (typeof pc === "string" && pc.trim() !== "");
  const impactPercent = pcOk ? Number(pc) : NaN;
  if (!ti || !Number.isFinite(impactPercent)) fail(RELAY_REASON.MISSING_IMPACT);
  else if (expected.maxImpactPercent !== undefined && impactPercent < -Math.abs(expected.maxImpactPercent)) {
    fail(RELAY_REASON.IMPACT_TOO_HIGH);
  }

  // --- steps / requestId (needed to build a plan) ---
  const steps = Array.isArray(gOwn(raw, "steps")) ? gOwn(raw, "steps") : [];
  if (steps.length === 0) fail(RELAY_REASON.NO_STEPS);
  const ids = steps.map((x) => (isObj(x) ? x.requestId : undefined));
  if (ids.some((x) => typeof x !== "string" || !x)) fail(RELAY_REASON.MISSING_REQUEST_ID);
  else if (new Set(ids).size > 1) fail(RELAY_REASON.REQUEST_ID_MISMATCH);
  const requestId = typeof ids[0] === "string" && ids[0] ? ids[0] : null;
  const originIsNative = /^0x0{40}$/i.test(curIn.address || "");
  const planSteps = [];
  for (const s of steps) {
    const items = Array.isArray(s && s.items) ? s.items : [];
    // [A-895 R1] id/kind, when present, must be strings (an object would otherwise reach String() and throw).
    if (isObj(s) && ((s.id !== undefined && typeof s.id !== "string") || (s.kind !== undefined && typeof s.kind !== "string"))) fail(RELAY_REASON.BAD_QUOTE_SHAPE);
    if (items.length === 0) fail(RELAY_REASON.STEP_NO_DATA);
    for (const it of items) {
      const data = isObj(it && it.data) ? it.data : null;
      if (!data) { fail(RELAY_REASON.STEP_NO_DATA); continue; }
      if (typeof data.chainId !== "number" || data.chainId !== expected.originChainId) fail(RELAY_REASON.STEP_CHAIN_MISMATCH);
      if (typeof data.to !== "string" || !ADDR_RE.test(data.to)) fail(RELAY_REASON.STEP_NO_DATA);
      const hex = typeof data.data === "string" ? data.data : null;
      if (hex === null || !/^0x([0-9a-fA-F]{2})*$/.test(hex) || hex.length < 10) fail(RELAY_REASON.STEP_NO_DATA);
      const val = data.value === undefined ? 0n : toBig(typeof data.value === "number" ? String(data.value) : data.value);
      if (val === null) fail(RELAY_REASON.STEP_VALUE_NONZERO);
      else if (val !== 0n && !originIsNative) fail(RELAY_REASON.STEP_VALUE_NONZERO);
      if (hex && hex.slice(0, 10).toLowerCase() === "0x095ea7b3") {
        // approve(spender, amount): must target the origin token, exact 2-word calldata, amount <= input.
        if (hex.length !== 10 + 128) fail(RELAY_REASON.APPROVE_MALFORMED);
        else {
          const amt = BigInt("0x" + hex.slice(10 + 64));
          if (inAmt === null || amt > inAmt) fail(RELAY_REASON.APPROVE_EXCEEDS_INPUT);
        }
        if (!sameAddr(data.to, curIn.address)) fail(RELAY_REASON.STEP_TO_MISMATCH);
      }
      planSteps.push({
        id: typeof s.id === "string" ? s.id : "",
        kind: typeof s.kind === "string" ? s.kind : "",
        chainId: data.chainId ?? null,
        to: data.to ?? null,
        value: val === null ? "0" : val.toString(),
        data: hex,
      });
    }
  }

  // --- gas top-up boundary ---
  // The quote response must agree with what the caller asked for. An unrequested top-up
  // (gasTopup present / nonzero) is a mismatch: it would silently shrink the user's USDC.
  // Documented field: details.currencyGasTopup { currency{chainId,address,decimals}, amount, amountUsd }.
  const gtc = isObj(d.currencyGasTopup) ? d.currencyGasTopup : null;
  const gtcAmt = gtc ? toBig(gtc.amount) : null;
  const legacy = raw.gasTopup ?? raw.fees?.gasTopup ?? d.gasTopup ?? null;
  const legacyPresent = legacy !== null && legacy !== undefined && !(isObj(legacy) && toBig(legacy.amount) === 0n);
  if (!topupRequested) {
    if (legacyPresent) fail(RELAY_REASON.TOPUP_NOT_REQUESTED);
    if (gtc && (gtcAmt === null || gtcAmt !== 0n)) fail(RELAY_REASON.TOPUP_NOT_REQUESTED);
  }

  // netUsdc = currencyOut.amount (the USDC the user actually receives; this is what the UI shows).
  // grossUsdcApprox = net + top-up USD value (approximate: USD != USDC exactly). Whether Relay's
  // currencyOut.amount is net of the top-up is UNKNOWN (G3) and must be confirmed before reliance.
  let topup = { requested: topupRequested, usdcDeducted: "0" };
  let grossUnits = outAmt;
  let netUnits = outAmt;
  if (topupRequested) {
    const t = toBig(expected.topupGasAmount);
    if (t === null || t === 0n) fail(RELAY_REASON.TOPUP_AMOUNT_INVALID);
    if (!gtc) fail(RELAY_REASON.TOPUP_MISSING);
    else {
      const gcur = isObj(gtc.currency) ? gtc.currency : {};
      if (gcur.chainId !== MONAD_CHAIN_ID || !/^0x0{40}$/i.test(gcur.address || "") || gtcAmt === null || gtcAmt === 0n) {
        fail(RELAY_REASON.TOPUP_MISMATCH);
      }
    }
    if (t !== null && t !== 0n) {
      const usd = typeof gtc?.amountUsd === "string" ? parseUnits(gtc.amountUsd) : null;
      const carve = usd !== null && usd > 0n ? usd : t;
      topup = { requested: true, usdcDeducted: formatUnits(carve) };
      if (outAmt !== null) grossUnits = outAmt + carve;
    }
  }

  const ok = reasons.length === 0;
  const quote = {
    requestId,
    destination: { chainId: curOut.chainId ?? null, token: MONAD_USDC_ADDRESS, recipient: d.recipient ?? null },
    origin: { chainId: curIn.chainId ?? null, token: curIn.address ?? null, amountUnits: inAmt === null ? null : inAmt.toString() },
    grossUsdcApprox: grossUnits === null ? null : formatUnits(grossUnits),
    netUsdc: netUnits === null ? null : formatUnits(netUnits),
    minOutUsdc: minAmt === null ? null : formatUnits(minAmt),
    timeEstimateSeconds: typeof eta === "number" ? eta : null,
    totalImpact: ti ? { usd: ti.usd ?? null, percent: Number.isFinite(impactPercent) ? impactPercent : null } : null,
    topupGas: { requested: topup.requested, usdcDeducted: topup.usdcDeducted },
  };
  // Net must be displayed; gross is returned only so a reviewer can see the carve-out.
  const plan = ok ? Object.freeze({
    kind: "relay_build_plan",
    execute: false, // build plan only: no send / sign / broadcast here
    requestId,
    steps: Object.freeze(planSteps.map((s) => Object.freeze(s))),
    display: Object.freeze({ netUsdc: quote.netUsdc, minOutUsdc: quote.minOutUsdc, timeEstimateSeconds: quote.timeEstimateSeconds, totalImpact: quote.totalImpact }),
  }) : null;
  return { ok, reasons, quote: ok ? quote : null, plan };
}

// ─────────────────────────────────────────────────────────────────────────────
// [A-895 P-A] Calldata binding (A-885 G1 input-validation, A-886 F1 / F3).
//
// A Relay quote step is untrusted bytes. Before any step can reach a plan we DECODE the deposit call and bind it:
//   id        = quote protocol.v2.orderId
//   depositor = the payer (the account that signs and spends)
//   amount    = the bound input amount (ERC20: calldata amount; native: tx value)
//   token     = the bound source token
//   target    = the PINNED /chains depository for the origin chain (never protocol.v2.paymentDetails / the quote)
//   approve   = exactly one, spender = that depository, amount == input (not "<= input")
//   deadline  = orderData.deadline must be a numeric unix-seconds integer and not expired, else fail closed
// Pure: no network, no clock of its own (nowMs is passed in), no imports.
// NOT done here (A-886 bounded, outside the proof): recomputing orderId from orderData (settlement-sdk absent,
// orderData untyped) and orderSignature ecrecover (it only attests the order id).

const WORD = "[0-9a-fA-F]{64}";
const ADDR_WORD = /^0{24}([0-9a-fA-F]{40})$/;
const ERC20_DEPOSIT_RE = new RegExp(`^0x${RELAY_DEPOSIT_ERC20_SELECTOR.slice(2)}(${WORD})(${WORD})(${WORD})(${WORD})$`, "i");
const NATIVE_DEPOSIT_RE = new RegExp(`^0x${RELAY_DEPOSIT_NATIVE_SELECTOR.slice(2)}(${WORD})(${WORD})$`, "i");
const APPROVE_RE = new RegExp(`^0x${ERC20_APPROVE_SELECTOR.slice(2)}(${WORD})(${WORD})$`, "i");
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

function wordAddress(word) {
  const m = ADDR_WORD.exec(word);
  return m ? "0x" + m[1].toLowerCase() : null;
}

/**
 * Strict ABI decode of a RelayDepository deposit call. Exact length, canonical (zero-padded) address words.
 * @returns {{fn:"depositErc20",depositor:string,token:string,amount:bigint,id:string}|{fn:"depositNative",depositor:string,id:string}|null}
 */
export function decodeRelayDepositCalldata(hex) {
  if (typeof hex !== "string") return null;
  let m = ERC20_DEPOSIT_RE.exec(hex);
  if (m) {
    const depositor = wordAddress(m[1]);
    const token = wordAddress(m[2]);
    if (!depositor || !token) return null;
    return { fn: "depositErc20", depositor, token, amount: BigInt("0x" + m[3]), id: "0x" + m[4].toLowerCase() };
  }
  m = NATIVE_DEPOSIT_RE.exec(hex);
  if (m) {
    const depositor = wordAddress(m[1]);
    if (!depositor) return null;
    return { fn: "depositNative", depositor, id: "0x" + m[2].toLowerCase() };
  }
  return null;
}

/** approve(spender, amount) exact decode, or null. */
export function decodeRelayApproveCalldata(hex) {
  if (typeof hex !== "string") return null;
  const m = APPROVE_RE.exec(hex);
  if (!m) return null;
  const spender = wordAddress(m[1]);
  return spender ? { spender, amount: BigInt("0x" + m[2]) } : null;
}

function stepValue(v) {
  if (v === undefined) return 0n;
  return toBig(typeof v === "number" ? (Number.isSafeInteger(v) && v >= 0 ? String(v) : null) : v);
}

/**
 * Bind the deposit calldata of a protocol.v2 quote to the expected payer / input / source token / pinned depository.
 * Fails closed on anything it cannot prove. `ok` only when every check passes.
 *
 * @param {object} raw  Relay quote/v2 response (plain JSON data)
 * @param {object} ctx  { originChainId, payer, sourceToken, inputAmountUnits (string|bigint), nowMs }
 * @returns {{ok:boolean, reasons:string[], binding:object|null}}
 */
export function verifyRelayDepositBinding(raw, ctx = {}) {
  const reasons = [];
  const fail = (r) => { if (!reasons.includes(r)) reasons.push(r); };
  const out = () => ({ ok: false, reasons, binding: null });
  const { originChainId, payer, sourceToken, nowMs } = isObj(ctx) ? ctx : {};
  const input = toBig(isObj(ctx) ? ctx.inputAmountUnits : undefined);
  if (!isAddr(payer)) { fail(RELAY_REASON.PAYER_INVALID); return out(); }
  if (!isAddr(sourceToken) || input === null || input === 0n) { fail(RELAY_REASON.BAD_INPUT); return out(); }
  const pinned = Number.isInteger(originChainId) && Object.prototype.hasOwnProperty.call(RELAY_PINNED_CHAINS, originChainId) ? RELAY_PINNED_CHAINS[originChainId] : null;
  if (!pinned) { fail(RELAY_REASON.ORIGIN_CHAIN_NOT_PINNED); return out(); }
  const depository = pinned.v2Depository;
  if (!isObj(raw)) { fail(RELAY_REASON.BAD_QUOTE_SHAPE); return out(); }
  const proto = gOwn(raw, "protocol");
  const v2 = isObj(proto) && isObj(gOwn(proto, "v2")) ? gOwn(proto, "v2") : null;
  if (!v2 || typeof gOwn(v2, "orderId") !== "string" || !BYTES32_RE.test(gOwn(v2, "orderId"))) { fail(RELAY_REASON.PROTOCOL_V2_MISSING); return out(); }
  const orderId = gOwn(v2, "orderId").toLowerCase();
  const native = /^0x0{40}$/i.test(sourceToken);

  // paymentDetails is only COMPARED (never the reference): the depository comes from the pinned table.
  const pd = isObj(gOwn(v2, "paymentDetails")) ? gOwn(v2, "paymentDetails") : {};
  if (!sameAddr(gOwn(pd, "depository"), depository)) fail(RELAY_REASON.PAYMENT_DETAILS_MISMATCH);
  if (!sameAddr(gOwn(pd, "currency"), sourceToken) || typeof gOwn(pd, "amount") !== "string" || gOwn(pd, "amount") !== input.toString()) fail(RELAY_REASON.PAYMENT_DETAILS_MISMATCH);
  // The quote's own sender, when it says one, must be the payer.
  const det = gOwn(raw, "details");
  if (isObj(det) && gOwn(det, "sender") !== undefined && !sameAddr(gOwn(det, "sender"), payer)) fail(RELAY_REASON.SENDER_NOT_PAYER);

  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  if (steps.length > MAX_QUOTE_STEPS) { fail(RELAY_REASON.STEPS_TOO_MANY); return out(); }
  const seq = [];
  for (const st of steps) {
    const items = isObj(st) && Array.isArray(gOwn(st, "items")) ? gOwn(st, "items") : [];
    if (items.length > MAX_STEP_ITEMS) { fail(RELAY_REASON.STEPS_TOO_MANY); return out(); }
    for (const it of items) seq.push(isObj(it) && isObj(gOwn(it, "data")) ? gOwn(it, "data") : null);
  }
  const approves = [];
  const deposits = [];
  seq.forEach((d, idx) => {
    const sel = d && typeof gOwn(d, "data") === "string" ? gOwn(d, "data").slice(0, 10).toLowerCase() : "";
    if (!d) fail(RELAY_REASON.STEP_UNEXPECTED_CALL);
    else if (sel === ERC20_APPROVE_SELECTOR) approves.push({ d, idx });
    else if (sel === RELAY_DEPOSIT_ERC20_SELECTOR || sel === RELAY_DEPOSIT_NATIVE_SELECTOR) deposits.push({ d, idx });
    else fail(RELAY_REASON.STEP_UNEXPECTED_CALL);
    if (d && gOwn(d, "from") !== undefined && !sameAddr(gOwn(d, "from"), payer)) fail(RELAY_REASON.SENDER_NOT_PAYER);
  });

  // ── deposit ──
  let dep = null;
  if (deposits.length !== 1) fail(RELAY_REASON.DEPOSIT_STEP_COUNT);
  else {
    const { d } = deposits[0];
    dep = decodeRelayDepositCalldata(gOwn(d, "data"));
    const value = stepValue(gOwn(d, "value"));
    if (gOwn(d, "chainId") !== originChainId) fail(RELAY_REASON.DEPOSIT_WRONG_CHAIN);
    if (!sameAddr(gOwn(d, "to"), depository)) fail(RELAY_REASON.DEPOSIT_TARGET_NOT_DEPOSITORY);
    if (!dep) fail(RELAY_REASON.DEPOSIT_UNDECODABLE);
    else {
      if (dep.id !== orderId) fail(RELAY_REASON.DEPOSIT_ID_NOT_ORDER_ID);
      if (!sameAddr(dep.depositor, payer)) fail(RELAY_REASON.DEPOSIT_DEPOSITOR_NOT_PAYER);
      if (native) {
        if (dep.fn !== "depositNative") fail(RELAY_REASON.DEPOSIT_FUNCTION_MISMATCH);
        if (value === null || value !== input) fail(RELAY_REASON.DEPOSIT_AMOUNT_NOT_INPUT);
      } else {
        if (dep.fn !== "depositErc20") fail(RELAY_REASON.DEPOSIT_FUNCTION_MISMATCH);
        else {
          if (!sameAddr(dep.token, sourceToken)) fail(RELAY_REASON.DEPOSIT_TOKEN_NOT_SOURCE);
          if (dep.amount !== input) fail(RELAY_REASON.DEPOSIT_AMOUNT_NOT_INPUT);
        }
        if (value === null || value !== 0n) fail(RELAY_REASON.DEPOSIT_VALUE_INVALID);
      }
    }
  }

  // ── approve (deposit path): exactly one for an ERC20 source, none for native; amount == input; spender == depository ──
  if (native) {
    if (approves.length !== 0) fail(RELAY_REASON.APPROVE_COUNT);
  } else if (approves.length !== 1) fail(RELAY_REASON.APPROVE_COUNT);
  else {
    const { d, idx } = approves[0];
    const ap = decodeRelayApproveCalldata(gOwn(d, "data"));
    const value = stepValue(gOwn(d, "value"));
    if (gOwn(d, "chainId") !== originChainId || !sameAddr(gOwn(d, "to"), sourceToken) || value === null || value !== 0n) fail(RELAY_REASON.APPROVE_MALFORMED);
    if (!ap) fail(RELAY_REASON.APPROVE_MALFORMED);
    else {
      if (!sameAddr(ap.spender, depository)) fail(RELAY_REASON.APPROVE_SPENDER_NOT_DEPOSITORY);
      if (ap.amount !== input) fail(RELAY_REASON.APPROVE_AMOUNT_NOT_INPUT);
    }
    if (deposits.length === 1 && idx > deposits[0].idx) fail(RELAY_REASON.APPROVE_AFTER_DEPOSIT);
  }

  // ── order deadline (unix seconds): missing / non-numeric / implausible unit / expired → fail closed ──
  // [A-901 D2] Live quote/v2 (A-901 live capture): the deadline is orderData.output.deadline, and every
  // orderData.inputs[].refunds[].deadline is checked by the SAME rule. The flat orderData.deadline is the legacy
  // synthetic-fixture shape and is read only when orderData.output is absent. No minimum-margin number is added.
  const od = isObj(gOwn(v2, "orderData")) ? gOwn(v2, "orderData") : null;
  const nowSec = typeof nowMs === "number" && Number.isFinite(nowMs) && nowMs > 0 ? Math.floor(nowMs / 1000) : null;
  const deadlineOk = (x) => typeof x === "number" && Number.isSafeInteger(x) && x > 0 && x <= MAX_DEADLINE_SEC;
  const outObj = od ? gOwn(od, "output") : undefined;
  const dl = od ? (outObj !== undefined ? (isObj(outObj) ? gOwn(outObj, "deadline") : undefined) : gOwn(od, "deadline")) : undefined;
  const dls = [dl];
  const allRefunds = [];
  if (od && gOwn(od, "inputs") !== undefined) {
    const inputs = gOwn(od, "inputs");
    if (!Array.isArray(inputs)) dls.push(undefined);
    else for (const inp of inputs) {
      const refunds = isObj(inp) ? gOwn(inp, "refunds") : undefined;
      if (!Array.isArray(refunds)) { dls.push(undefined); continue; }
      for (const rf of refunds) {
        if (!isObj(rf)) { dls.push(undefined); continue; }
        dls.push(gOwn(rf, "deadline"));
        allRefunds.push({ label: gOwn(rf, "chainId"), recipient: gOwn(rf, "recipient") });
      }
    }
  }
  if (nowSec === null || dls.some((x) => !deadlineOk(x))) fail(RELAY_REASON.ORDER_DEADLINE_UNKNOWN);
  else if (dls.some((x) => x <= nowSec)) fail(RELAY_REASON.ORDER_EXPIRED);

  // ── [A-901 D2] chain label: paymentDetails.chainId must be the pinned /chains snapshot name for this origin ──
  // A label that is PRESENT must equal the pinned snapshot name (no hard-coded table; any other value / type is unmapped).
  // An ABSENT label claims nothing and is left to the pinned depository + the per-step chainId checks (legacy synthetic
  // fixtures carry no label; real quotes always do).
  if (gOwn(pd, "chainId") !== undefined && gOwn(pd, "chainId") !== pinned.name) fail(RELAY_REASON.PAYMENT_CHAIN_UNMAPPED);
  // ── [A-901 D2 / C1] every refund is classified by its EXACT label (strings only, case-sensitive):
  //   pinned origin name ("base")  → recipient must equal the refundTo we sent;
  //   RELAY_DEST_LABEL ("monad")   → recipient must equal the request recipient (ctx.recipient, else the quote's details.recipient,
  //                                   which validateRelayQuote binds to the expected recipient);
  //   anything else (other chain, number, case variant, missing) → rejected. No record-only class.
  if (allRefunds.length) {
    const rt = isObj(ctx) ? ctx.refundTo : undefined;
    const cr = isObj(ctx) && ctx.recipient !== undefined ? ctx.recipient : (isObj(det) ? gOwn(det, "recipient") : undefined);
    for (const r of allRefunds) {
      if (r.label === pinned.name) { if (!isAddr(rt) || !sameAddr(r.recipient, rt)) fail(RELAY_REASON.REFUND_RECIPIENT_NOT_REFUNDTO); }
      else if (r.label === RELAY_DEST_LABEL) { if (!isAddr(cr) || !sameAddr(r.recipient, cr)) fail(RELAY_REASON.REFUND_RECIPIENT_NOT_REFUNDTO); }
      else fail(RELAY_REASON.REFUND_CHAIN_UNMAPPED);
    }
  }

  // ── [A-909 R1] orderData.output + inputs[].payment bound to OUR request (fail closed; missing == mismatch) ──
  //   output.chainId             === RELAY_DEST_LABEL (the /chains snapshot label for destination 143; no table)
  //   output.payments[]          non-empty; EVERY payment: recipient === request recipient, currency === Monad USDC
  //   inputs[].payment.chainId   === pinned.name (origin label); inputs must be a non-empty array, every payment object present
  // Consistency check on Relay's response only: orderId <-> orderData derivation stays UNKNOWN (no hash scheme invented).
  {
    const want = isObj(ctx) && ctx.recipient !== undefined ? ctx.recipient : (isObj(det) ? gOwn(det, "recipient") : undefined);
    // [A-909 R1, Cowork (a)] absent output is REFUSED (no legacy-shape allowance).
    if (!isObj(outObj)) fail(RELAY_REASON.ORDER_OUTPUT_MISSING);
    else {
      if (gOwn(outObj, "chainId") !== RELAY_DEST_LABEL) fail(RELAY_REASON.ORDER_OUTPUT_CHAIN_MISMATCH);
      const pays = gOwn(outObj, "payments");
      if (!Array.isArray(pays) || pays.length === 0) fail(RELAY_REASON.ORDER_OUTPUT_MISSING);
      else for (const pm of pays) {
        if (!isObj(pm)) { fail(RELAY_REASON.ORDER_OUTPUT_MISSING); continue; }
        if (!isAddr(want) || !sameAddr(gOwn(pm, "recipient"), want)) fail(RELAY_REASON.ORDER_OUTPUT_RECIPIENT_MISMATCH);
        if (!sameAddr(gOwn(pm, "currency"), MONAD_USDC_ADDRESS)) fail(RELAY_REASON.ORDER_OUTPUT_CURRENCY_MISMATCH);
      }
    }
    const ins = od ? gOwn(od, "inputs") : undefined;
    if (!Array.isArray(ins) || ins.length === 0) fail(RELAY_REASON.ORDER_INPUT_CHAIN_MISMATCH);
    else for (const inp of ins) {
      const pay = isObj(inp) ? gOwn(inp, "payment") : undefined;
      if (!isObj(pay) || gOwn(pay, "chainId") !== pinned.name) fail(RELAY_REASON.ORDER_INPUT_CHAIN_MISMATCH);
    }
  }

  if (reasons.length) return out();
  return {
    ok: true,
    reasons: [],
    binding: Object.freeze({
      originChainId, depository, orderId, deadlineSec: dl, payer: payer.toLowerCase(),
      depositFunction: dep.fn, inputAmountUnits: input.toString(), sourceToken: sourceToken.toLowerCase(),
    }),
  };
}

/**
 * Fetch + validate in one call. `fetchImpl` is REQUIRED (no global fetch fallback, so this module
 * can never hit the network by accident). Body is posted as JSON; response is validated.
 */
export async function requestRelayQuote(input, { fetchImpl, validate = {} } = {}) {
  if (typeof fetchImpl !== "function") return { ok: false, reasons: [RELAY_REASON.BAD_INPUT], quote: null, plan: null };
  const built = buildRelayQuoteRequest(input);
  if (!built.ok) return { ok: false, reasons: built.reasons, quote: null, plan: null };
  let res;
  try {
    // [A-895 P-A F4] quote/v2 only; the deprecated /quote is never posted to. (The x-api-key is added by the
    // same-origin proxy api/relay-quote.js [A-901]; this module holds no key and posts to the proxy path only.)
    res = await fetchImpl(RELAY_API_BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(built.request),
    });
  } catch {
    return { ok: false, reasons: [RELAY_REASON.FETCH_FAILED], quote: null, plan: null };
  }
  if (!res || !res.ok) return { ok: false, reasons: [RELAY_REASON.HTTP_ERROR], quote: null, plan: null };
  let json;
  try { json = snapshotRelayJson(await res.json()); if (json === undefined) throw new Error("unreadable"); } catch { return { ok: false, reasons: [RELAY_REASON.BAD_QUOTE_SHAPE], quote: null, plan: null }; }
  const checked = validateRelayQuote(json, {
    recipient: input.recipient,
    originChainId: input.originChainId,
    originCurrency: input.originCurrency,
    amount: input.amount,
    topupGas: input.topupGas === true,
    topupGasAmount: input.topupGasAmount,
    ...validate,
  });
  if (!checked.ok) return checked;
  // [A-895 P-A] the payer is the request `user`; the calldata must bind to it (no override from `validate`).
  const bound = verifyRelayDepositBinding(json, {
    originChainId: input.originChainId,
    payer: input.user,
    refundTo: input.refundTo,
    recipient: input.recipient,
    sourceToken: input.originCurrency,
    inputAmountUnits: input.amount,
    nowMs: validate && typeof validate.nowMs === "number" ? validate.nowMs : Date.now(),
  });
  if (!bound.ok) return { ok: false, reasons: bound.reasons, quote: null, plan: null };
  return checked;
}
