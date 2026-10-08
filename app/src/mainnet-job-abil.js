// Mainnet Job — aBIL spot (USDC swapped into the aBIL token through a public spot AMM router, swapped back to
// the same Piggy). Local, fail-closed boundary around what is already proven, nothing more.
//
// What is proven, and where it lives (this module copies none of it):
//   · Identity (router / pool / token / fee / factory / chain / USDC / evidence block): the read-only reader's
//     ABIL_RECORDED in second-current-reader.js. The reader's own read result (row "abil-spot") is the only
//     live-state evidence this module accepts; it is consumed as-is through abilReaderEvidence().
//   · One fork round trip at the reader's evidence block (PASS_FORK_SIM, no time warp, 5 USDC): exact approve,
//     buy, exact approve, sell, both allowances back to 0, a measured loss of 29955 raw USDC. That run used a
//     minimum-out of 0 as a probe setting, so it is NOT quote, minimum-out or exit evidence for any real swap.
//   · The product contract on rights (no shareholder rights, economic exposure only) and the open eligibility
//     gate: the abil-spot destination in second-job-readiness.js, read through buildExecutionPlan().
//
// What is NOT proven, and blocks (each an explicit field, value UNKNOWN):
//   eligibility · KYC · geography / jurisdiction · rights wording shown and accepted · issuer redemption ·
//   secondary liquidity · quote · minimum-out · exit evidence · dividend · freshness · price impact.
//
// "Economic exposure only, no shareholder rights" is a REQUIRED product/evidence gate. It is not implemented
// here and nothing below reports it as satisfied.
//
// No execution path: this module imports no executor and no permission issuer, builds no signer, builds no
// calldata, holds no storage key and reads no network. abilActionPlan() demands quote, minimum-out and exit
// evidence first and then refuses on the blocking fields anyway; abilExecutionGate() runs the shared
// boundaries (chain-profile.js binding, the shared local-fork executor refusal) and then refuses anyway,
// because no aBIL lane reaches the one send chokepoint (money-executor.js). The product imports nothing here.

import { ABIL_RECORDED, ABIL_UNKNOWN_CLASS, CURRENT_READER_STATUS } from "./second-current-reader.js";
import { EVIDENCE_LABEL, buildExecutionPlan } from "./second-job-readiness.js";
import { bindRecordToProfile, isProfileActive } from "./chain-profile.js";
import { permissionNonce } from "./permission-envelope.js";
import { ADDR, executorRefusal, formatUnits, isDigits, lower } from "./mainnet-job-common.js";

export const ABIL_JOB_ID = "abil-spot";
export const ABIL_ACTION = "abil_spot_buy_sell";

// The fork round trip, as recorded. Chain, block and addresses are the reader's; nothing is restated here.
export const ABIL_FORK_EVIDENCE = Object.freeze({
  label: EVIDENCE_LABEL.FORK_SIM,
  chainId: ABIL_RECORDED.chainId,
  block: ABIL_RECORDED.evidenceBlock,
  blockTimestamp: "2026-09-29T09:24:32Z",
  timeWarp: false,
  recorded: ABIL_RECORDED,
  sentRaw: "5000000",
  abilAfterBuy: "0.054407835408222484",
  usdcAfterSellRaw: "4970045",
  deltaRaw: "-29955",
  allowancesAfter: Object.freeze({ usdcToRouterRaw: "0", abilToRouterRaw: "0" }),
  gasUsed: Object.freeze({ approveUsdc: 55437, buy: 210293, approveAbil: 53895, sell: 216642 }),
  swapSignature: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
  swapSelector: "0x414bf389",
  // The fork swaps ran with minimum-out 0. That is a probe setting, never a bound a real swap may use.
  forkMinOutRaw: "0",
  minOutIsProbeOnly: true,
});

// The only size run end to end on the fork. Anything larger is unproven.
export const ABIL_FORK_SIZE_RAW = ABIL_FORK_EVIDENCE.sentRaw;

// Every field an aBIL errand would need that nobody has proven. Each one blocks on its own: there is no value,
// no default and no caller override. `kind` says which gate it belongs to.
export const ABIL_BLOCKING_FIELDS = Object.freeze({
  eligibility: Object.freeze({ kind: "eligibility", value: "UNKNOWN", blocking: true }),
  kyc: Object.freeze({ kind: "eligibility", value: "UNKNOWN", blocking: true }),
  geo: Object.freeze({ kind: "eligibility", value: "UNKNOWN", blocking: true }),
  rights: Object.freeze({ kind: "rights", value: "UNKNOWN", blocking: true }),
  redemption: Object.freeze({ kind: "exit", value: "UNKNOWN", blocking: true }),
  secondaryLiquidity: Object.freeze({ kind: "exit", value: "UNKNOWN", blocking: true }),
  quote: Object.freeze({ kind: "price", value: "UNKNOWN", blocking: true }),
  minOut: Object.freeze({ kind: "price", value: "UNKNOWN", blocking: true }),
  exitEvidence: Object.freeze({ kind: "exit", value: "UNKNOWN", blocking: true }),
  dividend: Object.freeze({ kind: "rights", value: "UNKNOWN", blocking: true }),
  freshness: Object.freeze({ kind: "price", value: "UNKNOWN", blocking: true }),
  priceImpact: Object.freeze({ kind: "price", value: "UNKNOWN", blocking: true }),
});

export const ABIL_BLOCKING_FIELD_NAMES = Object.freeze(Object.keys(ABIL_BLOCKING_FIELDS).filter((k) => ABIL_BLOCKING_FIELDS[k].blocking === true));

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The value of one field: always "UNKNOWN" (no aBIL field is proven beyond the reader's identity read). */
export function abilField(name) {
  if (typeof name !== "string" || !has(ABIL_BLOCKING_FIELDS, name)) return "UNKNOWN";
  return ABIL_BLOCKING_FIELDS[name].value;
}

/**
 * The rights gate. Required, never satisfied here, never implemented here. The wording is the abil-spot
 * destination's own (second-job-readiness.js), read through buildExecutionPlan for this Piggy; without a Piggy
 * address the wording is UNKNOWN and the gate is still required and unsatisfied.
 */
export function abilRightsGate(piggyAddress) {
  let rights = null;
  let eligibilityGate = "UNKNOWN";
  if (typeof piggyAddress === "string" && ADDR.test(piggyAddress)) {
    const out = buildExecutionPlan(ABIL_JOB_ID, { context: { address: piggyAddress, chain: "monad-mainnet" } });
    if (out?.plan?.rights) rights = out.plan.rights;
    if (typeof out?.plan?.eligibilityGate === "string") eligibilityGate = out.plan.eligibilityGate;
  }
  return Object.freeze({
    id: "economic_exposure_only_no_shareholder_rights",
    required: true,
    satisfied: false,
    implementedHere: false,
    shareholderRights: rights ? rights.shareholderRights : "UNKNOWN",
    statement: rights && typeof rights.statement === "string" ? rights.statement : "UNKNOWN",
    dividend: "UNKNOWN",
    eligibilityGate,
    reason: "product_and_evidence_gate_not_implemented",
  });
}

/**
 * The reader's aBIL row, judged. Takes the "abil-spot" row from readSecondCurrent() (or the whole result) and
 * says what it proves: at best that the pool identity matched the recorded evidence at one pinned block. It
 * never proves a quote, a minimum-out, an exit or eligibility. Anything else is UNKNOWN with no values.
 */
export function abilReaderEvidence(input) {
  const rowIn = input && typeof input === "object" && Array.isArray(input.candidates) ? input.candidates.find((c) => c && c.id === ABIL_JOB_ID) : input;
  const unknown = (reason, unknownClass = "missing") => Object.freeze({ status: "UNKNOWN", reason, unknownClass, identityProven: false, quote: "UNKNOWN", block: null, holdings: null });
  if (!rowIn || typeof rowIn !== "object" || rowIn.id !== ABIL_JOB_ID) return unknown("no_reader_row");
  if (rowIn.status === CURRENT_READER_STATUS.UNKNOWN) {
    const cls = ABIL_UNKNOWN_CLASS.includes(rowIn.unknownClass) ? rowIn.unknownClass : "missing";
    return unknown(`reader_unknown:${typeof rowIn.reason === "string" ? rowIn.reason : "UNKNOWN"}`, cls);
  }
  if (rowIn.status !== CURRENT_READER_STATUS.ABIL_QUOTE_INCOMPLETE) return unknown("reader_status_not_recognized", "unsupported");
  const r = rowIn.read;
  if (!r || typeof r !== "object" || r.identityMatchesRecorded !== true) return unknown("reader_identity_not_proven", "unsupported");
  const R = ABIL_RECORDED;
  if (r.chainId !== R.chainId || lower(r.router) !== lower(R.router) || lower(r.pool) !== lower(R.pool) || lower(r.token?.address) !== lower(R.token)) {
    return unknown("reader_identity_differs_from_recorded", "conflicting");
  }
  if (!Number.isInteger(r.block) || r.block < R.evidenceBlock) return unknown("reader_block_behind_recorded_evidence", "stale");
  return Object.freeze({
    status: "IDENTITY_READ",
    reason: "pool_identity_matches_recorded_quote_unknown",
    unknownClass: null,
    identityProven: true,
    // The reader has no quoter or price view; a full read still carries no quote.
    quote: "UNKNOWN",
    block: r.block,
    holdings: r.holdings && typeof r.holdings === "object" ? Object.freeze({ ...r.holdings }) : null,
  });
}

// ── quote / minimum-out / exit evidence: shape checks only. Passing them proves the shape, not the market. ──
const isPositive = (v) => isDigits(v) && BigInt(v) > 0n;

function quoteProblem(q) {
  if (!q || typeof q !== "object") return "missing_quote";
  if (!isPositive(q.amountOutRaw)) return "quote_amount_not_exact";
  if (!Number.isInteger(q.block) || q.block < ABIL_RECORDED.evidenceBlock) return "quote_block_unproven";
  if (typeof q.source !== "string" || !q.source.trim()) return "quote_source_missing";
  return null;
}

function minOutProblem(minOutRaw, quote) {
  if (minOutRaw === undefined || minOutRaw === null || minOutRaw === "") return "missing_min_out";
  if (!isDigits(minOutRaw)) return "min_out_not_exact";
  if (BigInt(minOutRaw) === 0n) return "min_out_zero_is_fork_probe_only";
  if (BigInt(minOutRaw) > BigInt(quote.amountOutRaw)) return "min_out_above_quote";
  return null;
}

function exitProblem(e) {
  if (!e || typeof e !== "object") return "missing_exit_evidence";
  // The recorded fork round trip is not exit evidence: its sell ran at minimum-out 0.
  if (e === ABIL_FORK_EVIDENCE || e.recorded === ABIL_RECORDED || e.minOutRaw === "0" || e.forkMinOutRaw === "0") return "exit_evidence_is_fork_probe";
  if (!isPositive(e.amountOutRaw) || !isPositive(e.minOutRaw)) return "exit_evidence_not_exact";
  if (BigInt(e.minOutRaw) > BigInt(e.amountOutRaw)) return "exit_min_out_above_quote";
  if (!Number.isInteger(e.block) || e.block < ABIL_RECORDED.evidenceBlock) return "exit_block_unproven";
  if (typeof e.source !== "string" || !e.source.trim()) return "exit_source_missing";
  return null;
}

export const ABIL_STEPS = Object.freeze(["buy", "sell"]);

/**
 * The action builder. Always action 0. Order of refusal: a known step, the reader's identity evidence, a quote,
 * a minimum-out (never 0, never above the quote), exit evidence (never the fork probe), and then every blocking
 * field — which are all still UNKNOWN, so even a complete set of caller evidence ends in a refusal. No calldata.
 */
export function abilActionPlan(input) {
  const { step, reader, quote, minOutRaw, exitEvidence } = input && typeof input === "object" ? input : {};
  const refuse = (reason) => Object.freeze({ action: "none", actionCount: 0, decision: "unknown", reason, call: null, ready: false, executable: false, liveExecution: false, executionPermission: false });
  if (typeof step !== "string" || !ABIL_STEPS.includes(step)) return refuse("unknown_step");
  const ev = abilReaderEvidence(reader);
  if (!ev.identityProven) return refuse(`reader:${ev.reason}`);
  const q = quoteProblem(quote);
  if (q) return refuse(q);
  const m = minOutProblem(minOutRaw, quote);
  if (m) return refuse(m);
  const x = exitProblem(exitEvidence);
  if (x) return refuse(x);
  if (ABIL_BLOCKING_FIELD_NAMES.length) return refuse(`blocking_field:${ABIL_BLOCKING_FIELD_NAMES[0]}`);
  return refuse("abil_lane_not_wired");
}

// One read of the Piggy's id and address; a non-string address is no address.
function snapshotPiggy(piggy) {
  if (!piggy || typeof piggy !== "object") return {};
  const id = piggy.id;
  const address = piggy.address;
  return { id: typeof id === "string" ? id : undefined, address: typeof address === "string" ? address : undefined };
}

function exactAmount(v) {
  if (!isDigits(v) || BigInt(v) === 0n) return { amount: null, error: "amount_not_exact" };
  if (BigInt(v) > BigInt(ABIL_FORK_SIZE_RAW)) return { amount: null, error: "amount_above_fork_proven_size" };
  return { amount: BigInt(v), error: null };
}

/**
 * The exact request a permission envelope for the aBIL buy would have to match, in the shape
 * permission-envelope.js authorize() compares, with its nonce from permissionNonce(). Issues nothing. The aBIL
 * amount it would buy is UNKNOWN and is not part of the request.
 * @returns {{request: object|null, error: string|null}}
 */
export function abilPermissionRequest(input) {
  const { profile, piggy, amountRaw, eventId } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  if (!isProfileActive(profile)) return { request: null, error: "profile_blocked" };
  if (profile.numericChainId !== ABIL_RECORDED.chainId) return { request: null, error: "profile_chain_not_abil_evidence" };
  const { binding, error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return { request: null, error };
  if (lower(binding.token) !== lower(ABIL_RECORDED.usdc)) return { request: null, error: "profile_asset_not_abil_evidence" };
  const exact = exactAmount(amountRaw);
  if (exact.error) return { request: null, error: exact.error };
  const fields = {
    piggyId: binding.piggyId,
    signerAddress: binding.piggyAddress,
    action: ABIL_ACTION,
    asset: binding.asset,
    amount: exact.amount.toString(),
    chain: binding.chain,
    destination: ABIL_RECORDED.router,
  };
  return {
    request: Object.freeze({
      ...fields,
      destinationRequired: true,
      amountDisplay: `${formatUnits(exact.amount, binding.decimals)} ${binding.asset}`,
      expectedAbilRaw: "UNKNOWN",
      minOutRaw: "UNKNOWN",
      nonce: permissionNonce({ ...fields, at: typeof eventId === "string" && eventId ? eventId : "UNKNOWN_EVENT" }),
      permission: null,
      createsPermission: false,
    }),
    error: null,
  };
}

/**
 * Could this step run for this Piggy? Always { allowed: false, action: "none" }. First refusal from, in order:
 * the step, the chain profile, live-off, the profile's Job, the record binding, the shared executor refusal,
 * the rights gate, every blocking field, and finally that no aBIL lane reaches the send chokepoint.
 */
export function abilExecutionGate(input) {
  const { profile, piggy, executor, step } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  const refuse = (reason) => Object.freeze({ allowed: false, action: "none", actionCount: 0, reason, liveExecution: false, executionPermission: false });
  if (typeof step !== "string" || !ABIL_STEPS.includes(step)) return refuse("unknown_step");
  if (!isProfileActive(profile)) return refuse("profile_blocked");
  if (profile.liveExecution !== false) return refuse("live_execution_disabled");
  if (profile.jobId !== ABIL_JOB_ID) return refuse("profile_not_abil_lane");
  const { error } = bindRecordToProfile(profile, { piggyId: p.id, piggyAddress: p.address, asset: "USDC" });
  if (error) return refuse(error);
  const refused = executorRefusal(profile, executor);
  if (refused) return refuse(refused);
  if (!abilRightsGate(p.address).satisfied) return refuse("rights_gate_unsatisfied");
  if (ABIL_BLOCKING_FIELD_NAMES.length) return refuse(`blocking_field:${ABIL_BLOCKING_FIELD_NAMES[0]}`);
  return refuse("abil_lane_not_wired");
}

/**
 * Readiness of an aBIL errand. Never READY, never executable, never live, never permitted — whatever the input
 * claims (a full reader row, a live profile, an executor, caller quote / minimum-out / exit numbers).
 */
export function abilReadiness(input) {
  const { profile, piggy, executor, reader, quote, minOutRaw, exitEvidence } = input && typeof input === "object" ? input : {};
  const p = snapshotPiggy(piggy);
  const ev = abilReaderEvidence(reader);
  const rightsGate = abilRightsGate(p.address);
  const blockedBy = [];
  for (const f of ABIL_BLOCKING_FIELD_NAMES) blockedBy.push(`blocking_field:${f}`);
  blockedBy.push("rights_gate_unsatisfied");
  if (!ev.identityProven) blockedBy.push(`reader:${ev.reason}`);
  blockedBy.push(abilActionPlan({ step: "buy", reader, quote, minOutRaw, exitEvidence }).reason);
  blockedBy.push(abilExecutionGate({ profile: profile ?? null, piggy, executor, step: "buy" }).reason);
  blockedBy.push("live_execution_disabled", "abil_lane_not_wired");
  return Object.freeze({
    jobId: ABIL_JOB_ID,
    decision: "unknown",
    action: "none",
    actionCount: 0,
    ready: false,
    executable: false,
    executionPermission: false,
    createsPermission: false,
    liveExecution: false,
    evidenceClass: ABIL_FORK_EVIDENCE.label,
    reader: ev,
    rightsGate,
    blockingFields: ABIL_BLOCKING_FIELD_NAMES,
    blockedBy: Object.freeze([...new Set(blockedBy)]),
  });
}
