// [A-564 Lane B] **Gift create plan** — sender-side, PURE planning helper, built from a
// sender-side audit kept outside this repository.
//
// This file does NOT:
//  · send a transaction, build a permission envelope, touch any UI, or create a provider/client.
//  · persist anything (no store, no cache, no log).
//  · generate, accept, or infer a `claimSigner` value. [A-575] The adopted escrow is A
//    commit-reveal (A-570 ADOPTION = A-568 candidate_a): it has NO claimSigner at all — its
//    5-arg `create(giftId, token, amount, expiry, claimTokenHash)` is exactly `escrowCreateArgs`
//    below, and `claim()` verifies `sha256(preimage) == claimTokenHash` after a >=1-block commit by
//    the recipient's own Gift Piggy. The pre-A-570 blocker (`claim_signer_not_safely_available`,
//    A-564 SENDER_AUDIT.md: the old escrow needed a separate ecrecover key) no longer applies and
//    is removed. A `claimSigner` input is still refused outright — under A it would be a second
//    secret with no contract meaning.
//
// What this file DOES do, reusing only existing, unmodified primitives:
//  · mints a fresh `bytes32` `giftId` via WebCrypto (same technique
//    `gift-piggy-claim-link.js`'s own `mintClaimToken()` already uses for its capability token —
//    not a new randomness source), so the SAME value can key the off-chain record, the URL
//    fragment, and the escrow's `create()` call — no string→bytes32 derivation scheme invented
//    (matches A-562's own finding, `LANE_A_MAPPING.md:94`).
//  · resolves a USDC 20/50/100 preset via `gift-value-spec.js` (`buildGiftValueBinding`,
//    unmodified) — no default, no custom amount.
//  · composes `createClaimLink` / `attachGiftValue` / `sealClaimLink`
//    (`gift-piggy-claim-link.js`, unmodified) into one non-secret record + one fragment link.
//  · [A-573] optionally attaches a sender-funded gas budget via `giftGasBudget()`
//    (`gift-value-spec.js`) — injected gas units × injected fee inputs + bounded buffer, never a
//    default price. The gas budget is computed from gas inputs ONLY: it cannot set or override
//    giftId, recipient, claimTokenHash, or any signer, and the claimSigner refusal below stays.

import {
  GIFT_LINK_VERSION,
  createClaimLink,
  attachGiftValue,
  sealClaimLink,
  buildClaimUrl,
} from "./gift-piggy-claim-link.js";
import { buildGiftValueBinding, giftGasBudget, GIFT_VALUE_PRESET_ATOMIC_AMOUNTS, GIFT_GAS_POLICY, GIFT_GAS_BUDGET_STATUS, GIFT_SPONSOR_GAS_STEPS } from "./gift-value-spec.js";
import { decodeFunctionData, encodeFunctionData, getAddress } from "viem";
import { FORK_CHAIN_ID, FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "./funding-context.js";
import { GIFT_SPONSOR_MAX_EXPIRY_SECONDS } from "./gift-sponsor-7702.js";

const ADDR = /^0x[0-9a-fA-F]{40}$/;
// [gift-fork] the shared mainnet fork: its scope and the page path that boots it (= boot-profile.js FORK_BOOT_PATH; pinned by the a966 test).
export const FORK_GIFT_SCOPE = "monad-fork";
export const FORK_GIFT_LINK_PATH = "/j2";
function forkClaimUrl(url) {
  if (typeof url !== "string") return null;
  const at = url.indexOf("/claim#");
  return at > 0 && url.indexOf("/claim#", at + 1) < 0 ? `${url.slice(0, at)}${FORK_GIFT_LINK_PATH}${url.slice(at + "/claim".length)}` : null;
}

function webcrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle || typeof c.getRandomValues !== "function") {
    throw new Error("WebCrypto unavailable — refusing to invent a weaker id");
  }
  return c;
}

/** Fresh `0x` + 64-hex `bytes32`, matching the escrow's `giftId` type exactly — no derivation
 * scheme, just randomness, the same way `mintClaimToken()` mints its own capability token. */
function mintGiftId() {
  const bytes = new Uint8Array(32);
  webcrypto().getRandomValues(bytes);
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** unix seconds -> ISO 8601, same math `gift-record-source.js`'s own (unexported) `toIsoExpiry`
 * uses for the read side — kept consistent intentionally, not re-declared as policy. */
function isoFromUnixSeconds(unixSeconds) {
  const n = Number(unixSeconds);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const ms = n * 1000;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Plans a new value-bound Gift, sender side. Pure — no tx, no permission, no UI, no provider,
 * no persistence. Every returned field is either pure computation or produced by the existing,
 * unmodified `gift-piggy-claim-link.js` / `gift-value-spec.js` primitives.
 *
 * @param {object} p
 * @param {string} p.chainScope   e.g. "monad-testnet" — the same string `gift-value-spec.js`/
 *   `funding-context.js` use. Never resolved here from a numeric chain id.
 * @param {number} p.presetLabel  must be exactly one of `20`/`50`/`100` — no default, no custom.
 * @param {string} p.senderAddress
 * @param {number} p.expiry       unix seconds (matches the escrow's `uint64 expiry` param).
 * @param {string} [p.createdAt]  ISO 8601. Defaults to `new Date().toISOString()`.
 * @param {string} [p.note]
 * @param {string} [p.origin]     if given, also returns a ready-to-share `claimUrl`.
 * @param {object} [p.gas]        [A-573] `{ gasUnits, feeInputs, safety }` passed verbatim to
 *   `giftGasBudget()`. Omitted -> `gasBudget: null` (not planned yet — never a default amount).
 *   Any failure fails the whole plan with the budget's own reason.
 *
 * @param {object} [p.sponsor]  [A-913 A] `{ sponsorAddress, chainId }` — the pinned Araso sponsor (the same address the delegation names).
 *   When given, the sender's `gasBudget` (ESTIMATE only) becomes a `gasDeposit` in the SAME create step; UNKNOWN / missing fee
 *   inputs / missing `gas` => refused (`gas_budget_unknown`), never a default amount. Omitted -> no deposit (legacy plan).
 *
 * Passing `claimSigner` is refused outright (`claim_signer_not_supported`) rather than silently
 * ignored — the adopted A escrow has no such field (see file header).
 */
export async function planGiftCreate({
  chainScope,
  presetLabel,
  senderAddress,
  expiry,
  createdAt = new Date().toISOString(),
  note = "",
  origin = null,
  gas,
  sponsor,
  claimSigner,
} = {}) {
  if (claimSigner !== undefined) return { ok: false, reason: "claim_signer_not_supported" };

  let gasBudget = null;
  if (gas !== undefined) {
    const planned = giftGasBudget(gas);
    if (!planned.ok) return { ok: false, reason: planned.reason };
    gasBudget = planned.budget;
  }

  // [A-913 A] the deposit is decided BEFORE anything is minted: no budget => no plan.
  let gasDeposit = null;
  let sponsorChainId = null;
  if (sponsor !== undefined && sponsor !== null) {
    const d = planGiftGasDeposit({ gasBudget, sponsorAddress: sponsor?.sponsorAddress, chainId: sponsor?.chainId });
    if (!d.ok) return { ok: false, reason: d.reason };
    gasDeposit = d.deposit;
    sponsorChainId = d.deposit.chainId;
  }

  const sender = typeof senderAddress === "string" ? senderAddress.trim() : "";
  if (!ADDR.test(sender)) return { ok: false, reason: "bad_sender_address" };

  const expiresAt = isoFromUnixSeconds(expiry);
  if (!expiresAt) return { ok: false, reason: "bad_expiry" };

  const { value, error: valueError } = buildGiftValueBinding({ chainScope, presetLabel });
  if (!value) return { ok: false, reason: valueError };

  const giftId = mintGiftId();

  const created = createClaimLink({
    giftId,
    senderAddress: sender,
    chainId: chainScope,
    createdAt,
    expiresAt,
    note,
  });
  if (!created.ok) return { ok: false, reason: created.reason };

  const bound = attachGiftValue(created.record, value);
  if (!bound.ok) return { ok: false, reason: bound.reason };

  const sealed0 = await sealClaimLink(bound.record, created.token);
  if (!sealed0) return { ok: false, reason: "seal_failed" };
  // [A-913 A] recorded on the gift record (non-secret; txHash is filled once the deposit is broadcast).
  const sealed = gasDeposit
    ? { ...sealed0, gasDeposit: Object.freeze({ to: gasDeposit.to, valueWei: gasDeposit.value.toString(10), data: giftId, chainId: sponsorChainId, txHash: null }) }
    : sealed0;

  const claimUrl0 = typeof origin === "string" && origin
    ? buildClaimUrl(origin, { giftId, token: created.token })
    : null;
  // [gift-fork] a Gift made on the shared fork opens on the fork's boot path ("/j2" = boot-profile.js FORK_BOOT_PATH), so the link boots the
  // chain profile it was made on; "/claim" boots the build profile (testnet / 143), exactly as before for every other scope.
  const claimUrl = chainScope === FORK_GIFT_SCOPE ? forkClaimUrl(claimUrl0) : claimUrl0;

  return {
    ok: true,
    giftId,
    // Non-secret. Safe to display/store — carries only the hash, never the raw token.
    record: sealed,
    // The ONLY place the raw capability token appears. Caller puts this in the URL fragment
    // (never a query string — see `buildClaimUrl`) and does not persist it.
    fragment: Object.freeze({ giftId, token: created.token, version: GIFT_LINK_VERSION }),
    claimUrl,
    // Exactly the adopted A escrow's `create(bytes32,address,uint256,uint64,bytes32)` args
    // (A-570/A-575) — no `claimSigner` field exists in that contract.
    escrowCreateArgs: Object.freeze({
      giftId,
      token: value.tokenAddress,
      amount: value.amountAtomic,
      expiry,
      claimTokenHash: `0x${sealed.claimTokenHash}`,
    }),
    // [A-573] Sender-funded, delivery-only gas. Separate from escrowCreateArgs/record on purpose:
    // nothing here feeds giftId, recipient, claimTokenHash, or a signer.
    gasPolicy: GIFT_GAS_POLICY,
    gasBudget,
    // [A-913 A] null unless `sponsor` was given. { to: sponsor, value: bigint wei, data: giftId, chainId }.
    gasDeposit: gasDeposit ? Object.freeze({ ...gasDeposit, data: giftId }) : null,
  };
}

/**
 * [A-913 A] The sender's gas budget as a plain MON transfer to the pinned sponsor. Pure. Refuses (never defaults) when the budget is
 * missing, UNKNOWN (fee inputs missing) or zero, when the sponsor address is invalid/zero, or when the chain is not a Gift Monad chain.
 * The recipient Piggy gets nothing: the only payee is the sponsor.
 */
export function planGiftGasDeposit({ gasBudget, sponsorAddress, chainId } = {}) {
  if (!gasBudget || typeof gasBudget !== "object") return { ok: false, reason: "gas_budget_unknown" };
  if (gasBudget.status !== GIFT_GAS_BUDGET_STATUS.ESTIMATE || typeof gasBudget.costWei !== "bigint" || gasBudget.costWei <= 0n) return { ok: false, reason: "gas_budget_unknown" };
  // install + commit + revoke + claim must ALL be in the budget (the sponsor wallet pays all four): a budget missing any is UNKNOWN, never padded.
  if (!gasBudget.gasUnitsByStep || GIFT_SPONSOR_GAS_STEPS.some((st) => typeof gasBudget.gasUnitsByStep[st] !== "bigint")) return { ok: false, reason: "gas_budget_unknown" };
  const to = typeof sponsorAddress === "string" ? sponsorAddress.trim() : "";
  if (!ADDR.test(to) || /^0x0{40}$/i.test(to)) return { ok: false, reason: "sponsor_address_invalid" };
  if (chainId !== 143 && chainId !== 10143 && chainId !== FORK_CHAIN_ID) return { ok: false, reason: "sponsor_chain_invalid" }; // [A-946] + the fork's own id
  return { ok: true, deposit: Object.freeze({ to: getAddress(to), value: gasBudget.costWei, chainId }) };
}

const ERC20_APPROVE_ABI = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }];
const ESCROW_CREATE_ABI = [{ type: "function", name: "create", stateMutability: "nonpayable", inputs: [{ name: "giftId", type: "bytes32" }, { name: "token", type: "address" }, { name: "amount", type: "uint256" }, { name: "expiry", type: "uint64" }, { name: "claimTokenHash", type: "bytes32" }], outputs: [] }];

/**
 * [A-913 A] The ONE create step = ONE signer session (one Face ID, no extra prompt): approve -> create -> gas deposit, in this order,
 * all from the sender Piggy. Pure data for the executor; nothing is sent here. Requires a plan made with `sponsor`.
 * `escrowAddress` is injected (no default).
 */
export function buildGiftCreateStepCalls(plan, { escrowAddress } = {}) {
  if (!plan || plan.ok !== true || !plan.gasDeposit || !plan.escrowCreateArgs) return { ok: false, reason: "gas_budget_unknown" };
  if (!ADDR.test(String(escrowAddress || "")) || /^0x0{40}$/i.test(escrowAddress)) return { ok: false, reason: "escrow_address_invalid" };
  const a = plan.escrowCreateArgs;
  const escrow = getAddress(escrowAddress);
  const calls = [
    { label: "approve", to: getAddress(a.token), value: 0n, data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [escrow, BigInt(a.amount)] }) },
    { label: "create", to: escrow, value: 0n, data: encodeFunctionData({ abi: ESCROW_CREATE_ABI, functionName: "create", args: [a.giftId, getAddress(a.token), BigInt(a.amount), BigInt(a.expiry), a.claimTokenHash] }) },
    { label: "gas_deposit", to: plan.gasDeposit.to, value: plan.gasDeposit.value, data: plan.gasDeposit.data },
  ];
  return { ok: true, calls: Object.freeze(calls.map((c) => Object.freeze(c))) };
}

/**
 * [A-913 A] The link may be issued only when EVERY call of the step confirmed. `results` = per call, in order, `{ status:"success", hash }`.
 * Returns the record with the deposit tx hash filled in. A failed deposit => `gas_deposit_unconfirmed` (no link).
 */
export function confirmGiftCreateStep(plan, results) {
  if (!plan || plan.ok !== true || !plan.gasDeposit) return { ok: false, reason: "gas_budget_unknown" };
  if (!Array.isArray(results) || results.length !== 3) return { ok: false, reason: "create_step_incomplete" };
  const okAt = (i) => results[i] && results[i].status === "success" && /^0x[0-9a-fA-F]{64}$/.test(String(results[i].hash || ""));
  if (!okAt(0) || !okAt(1)) return { ok: false, reason: "create_unconfirmed" };
  if (!okAt(2)) return { ok: false, reason: "gas_deposit_unconfirmed" };
  return { ok: true, record: { ...plan.record, gasDeposit: Object.freeze({ ...plan.record.gasDeposit, txHash: results[2].hash }) } };
}

// ── [A-913 A / Cowork (c)] register the deposit with the relayer so the recipient's claim never needs the hash ──
const B32 = /^0x[0-9a-fA-F]{64}$/;
/** True while a record carries a mined deposit tx hash that the relayer has not acknowledged yet (the sender's app retries on the next open). */
export function needsGasRegistration(record) {
  const d = record && record.gasDeposit;
  return !!d && typeof d.txHash === "string" && B32.test(d.txHash) && d.registered !== true && d.registerRefused !== true;
}
/** The exact 3-key body for POST /api/gift-sponsor (decision (c)); null when there is nothing to register. */
export function buildGasTxRegistration(record) {
  if (!needsGasRegistration(record) || typeof record.giftId !== "string" || !B32.test(record.giftId)) return null;
  return Object.freeze({ action: "register_gas_tx", giftId: record.giftId, gasTx: record.gasDeposit.txHash });
}
/**
 * Registers the deposit right after a confirmed create step (and again on a later open if it did not go through). `client.register(body)` resolves
 * `{status, body}` exactly as the relayer answers. Never throws, no UI copy:
 *   200 registered:true   -> { ok:true, record: <registered:true> }                 (same hash again = already:true, still ok)
 *   409                   -> { ok:false, retry:false, record: <registerRefused:true> } (the relayer refused this hash; fail closed, claim will 409)
 *   anything else/offline -> { ok:false, retry:true,  record unchanged }            (kept in the sender's record, retried next open)
 */
export async function registerGasDeposit({ record, client } = {}) {
  const body = buildGasTxRegistration(record);
  if (!body) return { ok: false, retry: false, reason: "nothing_to_register", record };
  if (!client || typeof client.register !== "function") return { ok: false, retry: true, reason: "no_client", record };
  let res = null;
  try { res = await client.register(body); } catch { res = null; }
  const b = res && typeof res === "object" ? res.body : null;
  if (res && res.status === 200 && b && b.ok === true && b.registered === true && String(b.giftId || "").toLowerCase() === record.giftId.toLowerCase()) {
    return { ok: true, retry: false, record: { ...record, gasDeposit: Object.freeze({ ...record.gasDeposit, registered: true }) } };
  }
  if (res && res.status === 409) return { ok: false, retry: false, reason: "not_available", record: { ...record, gasDeposit: Object.freeze({ ...record.gasDeposit, registerRefused: true }) } };
  return { ok: false, retry: true, reason: "unavailable", record };
}

// ── [A-915] Monad 143 sender signing: EXACTLY the three create-step shapes, minted (armed) by this module and nothing else ──────────────────
// money-executor.js preparedSignProblem asks `giftCreateStepMatch(prepared)` for a chain-143 tx that is not the A-906 brand path. A tx passes only when
// it equals, byte for byte, a call that `armGiftCreateStep` armed from a verified plan (the only minter). Shapes (all from the sender Piggy, plain eip1559):
//   approve     to = the USDC of monad-mainnet (allowlist) · value 0 · approve(spender = pinned escrow, amount = this gift's exact preset; never max-uint)
//   create      to = pinned escrow · value 0 · create(giftId, token, amount, expiry, claimTokenHash) = escrowCreateArgs exactly
//   gas_deposit to = pinned sponsor · value = the computed gasBudget (> 0) · data = giftId (32 bytes)
// Anything else on 143 stays chain_id_mismatch. Addresses are injected config (escrow UNKNOWN until the Owner deploys): unset/malformed => refused, no default.
// An armed step expires after the A-556 5-minute cap (GIFT_SPONSOR_MAX_EXPIRY_SECONDS, reused) and is removed by disarm().
export const GIFT_CREATE_CHAIN_ID = 143;
export const GIFT_CREATE_CHAIN_SCOPE = "monad-mainnet";
const MAX_UINT256 = (1n << 256n) - 1n;
const ARMED_STEPS = new Map(); // "chainId|to|value|data" (lowercase) -> { label, step, expiresAtMs }
// [gift-fork] the key carries the chain the step was armed for (pre: always GIFT_CREATE_CHAIN_ID). A step armed on the fork is keyed 31337143 and
// can never match a chain-143 tx: giftCreateStepMatch asks only for 143 keys. On the fork the signing guard does not consult these steps.
const stepKey = (to, value, data, chainId = GIFT_CREATE_CHAIN_ID) => `${chainId}|${String(to).toLowerCase()}|${value.toString(10)}|${String(data).toLowerCase()}`;
// [gift-fork] the sender create step on the shared fork: same three exact shapes, the fork's own chain id + scope + its USDC row. 143 rules unchanged.
const CREATE_CHAINS = Object.freeze({ [GIFT_CREATE_CHAIN_ID]: GIFT_CREATE_CHAIN_SCOPE, [FORK_CHAIN_ID]: FORK_GIFT_SCOPE });
const sameAddr = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/** Refusal reason for a config {escrowAddress, sponsorAddress} before any Face ID, or null. Pure; never throws. */
export function giftCreateConfigProblem(cfg) {
  try {
    if (!cfg || typeof cfg !== "object") return "config_missing";
    const bad = (v) => typeof v !== "string" || !ADDR.test(v) || /^0x0{40}$/i.test(v);
    if (bad(cfg.escrowAddress)) return "escrow_address_invalid";
    if (bad(cfg.sponsorAddress)) return "sponsor_address_invalid";
    if (sameAddr(cfg.escrowAddress, cfg.sponsorAddress)) return "sponsor_address_invalid";
    return null;
  } catch {
    return "config_missing";
  }
}

/**
 * Arms the three exact calls of a plan for the signing guard. `calls` must equal buildGiftCreateStepCalls(plan, { escrowAddress }) exactly.
 * Refuses (arms nothing) unless: 143 sponsor chain · monad-mainnet USDC · one of the 20/50/100 presets (never max-uint) · deposit data = giftId · value > 0.
 * Returns { ok:true, disarm() } or { ok:false, reason }. Never throws.
 */
export function armGiftCreateStep(plan, calls, { escrowAddress, nowMs = Date.now() } = {}) {
  try {
    const cfgProblem = giftCreateConfigProblem({ escrowAddress, sponsorAddress: plan?.gasDeposit?.to });
    if (cfgProblem) return { ok: false, reason: cfgProblem };
    // [gift-fork] pre: gasDeposit.chainId === GIFT_CREATE_CHAIN_ID and record scope === GIFT_CREATE_CHAIN_SCOPE (143 only). Now: 143 exactly as before,
    // or the fork id with the fork scope (a mixed pair is refused).
    const armChainId = plan?.gasDeposit?.chainId;
    if (!plan || plan.ok !== true || !plan.gasDeposit || (armChainId !== GIFT_CREATE_CHAIN_ID && armChainId !== FORK_CHAIN_ID)) return { ok: false, reason: "sponsor_chain_invalid" };
    const armScope = CREATE_CHAINS[armChainId];
    if (plan.record?.chainId !== armScope) return { ok: false, reason: "sponsor_chain_invalid" };
    const a = plan.escrowCreateArgs;
    const usdc = FUNDING_CONTEXT_TOKEN_ALLOWLIST[armScope]?.USDC?.assetId;
    if (!a || !usdc || !sameAddr(a.token, usdc)) return { ok: false, reason: "asset_id_chain_mismatch" };
    const amount = BigInt(a.amount);
    if (amount === MAX_UINT256 || amount <= 0n || !GIFT_VALUE_PRESET_ATOMIC_AMOUNTS.includes(Number(amount))) return { ok: false, reason: "unsupported_amount" };
    if (!B32.test(String(a.giftId)) || !B32.test(String(a.claimTokenHash)) || String(plan.gasDeposit.data).toLowerCase() !== String(a.giftId).toLowerCase()) return { ok: false, reason: "create_step_incomplete" };
    if (!Number.isSafeInteger(Number(a.expiry)) || Number(a.expiry) <= 0) return { ok: false, reason: "bad_expiry" };
    if (typeof plan.gasDeposit.value !== "bigint" || plan.gasDeposit.value <= 0n) return { ok: false, reason: "gas_budget_unknown" };
    if (sameAddr(escrowAddress, usdc) || sameAddr(plan.gasDeposit.to, usdc)) return { ok: false, reason: "escrow_address_invalid" };
    const built = buildGiftCreateStepCalls(plan, { escrowAddress });
    if (!built.ok) return { ok: false, reason: built.reason };
    if (!Array.isArray(calls) || calls.length !== 3) return { ok: false, reason: "create_step_incomplete" };
    for (let i = 0; i < 3; i += 1) {
      const w = built.calls[i]; const c = calls[i];
      if (!c || c.label !== w.label || !sameAddr(c.to, w.to) || c.value !== w.value || String(c.data).toLowerCase() !== String(w.data).toLowerCase()) return { ok: false, reason: "create_step_mismatch" };
    }
    const step = Object.freeze({ escrow: getAddress(escrowAddress), token: getAddress(usdc), sponsor: getAddress(plan.gasDeposit.to), giftId: String(a.giftId).toLowerCase(), amount, expiry: BigInt(a.expiry), claimTokenHash: String(a.claimTokenHash).toLowerCase(), depositValue: plan.gasDeposit.value });
    const expiresAtMs = Number(nowMs) + GIFT_SPONSOR_MAX_EXPIRY_SECONDS * 1000;
    if (!Number.isFinite(expiresAtMs)) return { ok: false, reason: "create_step_mismatch" };
    const keys = built.calls.map((w) => stepKey(w.to, w.value, w.data, armChainId));
    built.calls.forEach((w, i) => ARMED_STEPS.set(keys[i], Object.freeze({ label: w.label, step, expiresAtMs })));
    return { ok: true, disarm: () => { for (const k of keys) ARMED_STEPS.delete(k); } };
  } catch {
    return { ok: false, reason: "create_step_mismatch" };
  }
}

/** Removes every armed step (tests / lock). */
export function disarmAllGiftCreateSteps() { ARMED_STEPS.clear(); }

/**
 * The signing-guard question: is this prepared chain-143 tx exactly one of the armed create-step calls? Returns the label
 * ("approve" | "create" | "gas_deposit") or null. Re-derives the expected calldata from the armed values, so a matching key alone is not trusted. Never throws.
 */
export function giftCreateStepMatch(prepared, { nowMs = Date.now() } = {}) {
  try {
    if (!prepared || typeof prepared !== "object" || prepared.chainId !== GIFT_CREATE_CHAIN_ID) return null;
    if (typeof prepared.to !== "string" || typeof prepared.data !== "string") return null;
    const value = prepared.value === undefined || prepared.value === null ? 0n : prepared.value;
    if (typeof value !== "bigint" || value < 0n) return null;
    const hit = ARMED_STEPS.get(stepKey(prepared.to, value, prepared.data));
    if (!hit || !(nowMs < hit.expiresAtMs)) return null;
    const { step, label } = hit;
    if (label === "approve") {
      if (value !== 0n || !sameAddr(prepared.to, step.token)) return null;
      const d = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: prepared.data });
      if (d.functionName !== "approve" || !sameAddr(d.args[0], step.escrow) || d.args[1] !== step.amount || d.args[1] === MAX_UINT256) return null;
      return encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [step.escrow, step.amount] }).toLowerCase() === prepared.data.toLowerCase() ? label : null;
    }
    if (label === "create") {
      if (value !== 0n || !sameAddr(prepared.to, step.escrow)) return null;
      const d = decodeFunctionData({ abi: ESCROW_CREATE_ABI, data: prepared.data });
      const [giftId, token, amount, expiry, hash] = d.args;
      if (d.functionName !== "create" || String(giftId).toLowerCase() !== step.giftId || !sameAddr(token, step.token) || amount !== step.amount || expiry !== step.expiry || String(hash).toLowerCase() !== step.claimTokenHash) return null;
      return encodeFunctionData({ abi: ESCROW_CREATE_ABI, functionName: "create", args: [giftId, token, amount, expiry, hash] }).toLowerCase() === prepared.data.toLowerCase() ? label : null;
    }
    if (label === "gas_deposit") {
      if (!sameAddr(prepared.to, step.sponsor) || value !== step.depositValue || value <= 0n) return null;
      return prepared.data.toLowerCase() === step.giftId ? label : null;
    }
    return null;
  } catch {
    return null;
  }
}
