// [A-952] Fork evidence + reward ledger CONTRACT (2차 공유 포크). Pure functions only: no I/O, no clock, no randomness,
// no network, no signing, no payout execution, no imports. Only module state = a WeakSet of verdict objects it issued. The server (card E) calls these; storage = fork-ledger-store-contract.js.
//
// Rules fixed here (FORK_TESTER_STRATEGY_20261010.md 보충 2 · 보충 3 §2 §3 · 보충 6; A-946 ENTRY_CONTRACT.md):
//   - Evidence key = forkInstanceId + chainId + piggyAddress + txHash + blockNumber. A tx hash alone is never a key
//     (A-808: a snapshot replay can repeat a hash). All five fields required; ids/hex lower-cased, numbers as decimal strings.
//     forkInstanceId (evidence/ledger key) and chainId (numeric namespace) are both in the key and never stand in for each other.
//   - journeyVerdict judges ONLY the chosen journey (journeyId + journeyVersion), against the CURRENT fork context.
//     No "all 10 Jobs" forcing. Developer coverage (10 Jobs + Gift) is a separate count and never feeds the user verdict.
//   - One reward per tester per campaign version: rewardKey = testerId + rewardCampaignVersion (no Piggy / Job / Gift in it).
//   - Payout = record shape only (`executes: false`), its own kind + key namespace, refused if it carries fork-evidence fields.
//   - Stamp key = its own namespace "fork-stamp|…"; it is NOT the A-897 `alpha!` promotion stamp.
//
// Key alphabet: every id is [a-z0-9._:-]; "|" can never appear inside a field, so composed keys cannot collide by concatenation.
// Every public function returns a plain result object and never throws on bad input.

export const FORK_LEDGER_SCHEMA = "araso.fork-ledger/v1";
export const KIND = Object.freeze({ EVIDENCE: "fork_step_evidence", REWARD: "reward_entry", PAYOUT: "payout_record", STAMP: "fork_stamp", ENTRY: "fork_entry", TOPUP: "fork_topup", ENTRY_PIGGY: "fork_entry_piggy", JOURNEY1_USE: "fork_journey1_use", ORPHAN: "fork_evidence_orphan", REGRANT: "fork_regrant_candidate" }); // [A-956] + ENTRY · TOPUP · ENTRY_PIGGY · JOURNEY1_USE · [A-993] + ORPHAN · REGRANT
export const KEY_PREFIX = Object.freeze({ EVIDENCE: "fork-evidence|", REWARD: "reward|", PAYOUT: "payout|", STAMP: "fork-stamp|", ENTRY: "fork-entry|", TOPUP: "fork-topup|", ENTRY_PIGGY: "fork-entry-piggy|", JOURNEY1_USE: "fork-j1|", ORPHAN: "fork-orphan|", REGRANT: "fork-regrant|" }); // [A-956] + ENTRY · TOPUP · ENTRY_PIGGY · JOURNEY1_USE · [A-993] + ORPHAN · REGRANT
export const VERDICT = Object.freeze({ COMPLETE: "COMPLETE", INCOMPLETE: "INCOMPLETE", INVALID: "INVALID" });
export const PAYOUT_CHAIN_ID = "143"; // Monad mainnet — the Owner's manual USDC payout chain (never the fork)
export const PAYOUT_ASSET = "USDC";
export const PAYOUT_DECIMALS = 6;

// Developer completion (보충 2 · 보충 3 §3): 10 Jobs + Gift, each verified once in the app. NOT a user completion.
export const DEVELOPER_COVERAGE_JOURNEY = "developer-coverage";
export const DEVELOPER_COVERAGE_STEPS = Object.freeze([
  "job.aave-usdc",
  "job.neverland-usdc",
  "job.curvance-usdc",
  "job.fastlane-shmon",
  "job.euler-k3-weth",
  "job.kuru-swap",
  "job.kuru-limit-create-cancel",
  "job.usdc-approval-cancel",
  "job.curve-lp",
  "job.upshift-earnausd",
  "gift.send-claim",
]);

// Fields that belong to fork evidence and must never ride inside a payout record.
const FORK_EVIDENCE_FIELDS = Object.freeze(["forkInstanceId", "chainId", "piggyAddress", "txHash", "blockNumber", "journeyId", "journeyVersion", "stepId", "evidenceKey"]);

const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const ADDR_RE = /^0x[0-9a-f]{40}$/;
const HASH_RE = /^0x[0-9a-f]{64}$/;
const DEC_RE = /^(0|[1-9][0-9]{0,19})$/;
const HEXQ_RE = /^0x(0|[1-9a-f][0-9a-f]{0,15})$/;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const bad = (reason, field) => ({ ok: false, reason, field: field || null });
const low = (v) => (typeof v === "string" ? v.trim().toLowerCase() : null);

const normId = (v) => { const s = low(v); return s !== null && ID_RE.test(s) ? s : null; };
const normAddr = (v) => { const s = low(v); return s !== null && ADDR_RE.test(s) ? s : null; };
const normHash = (v) => { const s = low(v); return s !== null && HASH_RE.test(s) ? s : null; };
// Non-negative integer (number, decimal string or 0x quantity) -> canonical decimal string; "0x10" and 16 and "16" are one value.
function normUint(v, { min = 0n } = {}) {
  let n = null;
  if (typeof v === "number") n = Number.isSafeInteger(v) ? BigInt(v) : null;
  else if (typeof v === "string") { const s = v.trim().toLowerCase(); n = DEC_RE.test(s) || HEXQ_RE.test(s) ? BigInt(s) : null; }
  if (n === null || n < min || n > MAX_SAFE) return null;
  return n.toString();
}
const normChain = (v) => normUint(v, { min: 1n });
const normBlock = (v) => normUint(v);
const normVersion = (v) => normUint(v, { min: 1n });

function contextFields(i) {
  const forkInstanceId = normId(i.forkInstanceId); if (!forkInstanceId) return bad("missing_or_invalid", "forkInstanceId");
  const chainId = normChain(i.chainId); if (!chainId) return bad("missing_or_invalid", "chainId");
  const piggyAddress = normAddr(i.piggyAddress); if (!piggyAddress) return bad("missing_or_invalid", "piggyAddress");
  return { ok: true, fields: { forkInstanceId, chainId, piggyAddress } };
}

/**
 * forkContext({ forkInstanceId, chainId, piggyAddress, forkStartBlock, testerId? }) — the CURRENT instance / chain / Piggy the
 * server judges against. forkStartBlock = the fork instance's snapshot block (instance metadata): every block ≤ it is the parent
 * chain's history, so a row at or below it is replayed / pre-fork and never counts. testerId (server auth) is carried into the
 * verdict so a reward can be bound to it.
 */
export function forkContext(input) {
  const i = isObj(input) ? input : {};
  const c = contextFields(i); if (!c.ok) return c;
  const forkStartBlock = normBlock(i.forkStartBlock); if (forkStartBlock === null) return bad("missing_or_invalid", "forkStartBlock");
  let testerId = null;
  if (i.testerId !== undefined && i.testerId !== null) { testerId = normId(i.testerId); if (!testerId) return bad("missing_or_invalid", "testerId"); }
  return { ok: true, fields: { ...c.fields, forkStartBlock, testerId } };
}

const preFork = (f, ctx) => BigInt(f.blockNumber) <= BigInt(ctx.forkStartBlock);

// Verdict objects issued by journeyVerdict in this process. rewardLedgerApply accepts only these (a hand-written or
// JSON-round-tripped object is refused). Module memory only — no I/O.
const ISSUED_VERDICTS = new WeakSet();
const issue = (v) => { const o = Object.freeze({ ...v, missing: Object.freeze([...v.missing]), covered: Object.freeze([...v.covered]) }); ISSUED_VERDICTS.add(o); return o; };

/**
 * evidenceKey({ forkInstanceId, chainId, piggyAddress, txHash, blockNumber }) -> { ok, key, fields } | { ok:false, reason, field }
 * Every field required. A tx hash without the other four is refused.
 */
export function evidenceKey(input) {
  const i = isObj(input) ? input : {};
  const c = contextFields(i); if (!c.ok) return c;
  const txHash = normHash(i.txHash); if (!txHash) return bad("missing_or_invalid", "txHash");
  const blockNumber = normBlock(i.blockNumber); if (blockNumber === null) return bad("missing_or_invalid", "blockNumber");
  const f = { ...c.fields, txHash, blockNumber };
  return { ok: true, key: `${KEY_PREFIX.EVIDENCE}${f.forkInstanceId}|${f.chainId}|${f.piggyAddress}|${f.txHash}|${f.blockNumber}`, fields: f };
}

/**
 * evidenceRecord({ forkInstanceId, chainId, piggyAddress, txHash, blockNumber, status, journeyId, journeyVersion, stepId, blockHash? })
 * The one row E stores per verified step (after it read the receipt on the fork itself). status must be "success".
 * Evidence only: no reward, payout or stamp fields.
 * [A-993] blockHash (optional, the receipt's) is recorded when given — NOT part of the key (A-952 key unchanged); a restart reconcile uses
 * it to catch a different block re-mined at the same number. Absent / null = the field is absent (rows written before A-993 stay valid).
 */
export function evidenceRecord(input) {
  const i = isObj(input) ? input : {};
  const k = evidenceKey(i); if (!k.ok) return k;
  if (low(i.status) !== "success") return bad("tx_not_success", "status");
  const journeyId = normId(i.journeyId); if (!journeyId) return bad("missing_or_invalid", "journeyId");
  const journeyVersion = normVersion(i.journeyVersion); if (journeyVersion === null) return bad("missing_or_invalid", "journeyVersion");
  const stepId = normId(i.stepId); if (!stepId) return bad("missing_or_invalid", "stepId");
  let blockHash = null; // [A-993]
  if (i.blockHash !== undefined && i.blockHash !== null) { blockHash = normHash(i.blockHash); if (!blockHash) return bad("missing_or_invalid", "blockHash"); }
  return { ok: true, key: k.key, record: Object.freeze({ kind: KIND.EVIDENCE, schema: FORK_LEDGER_SCHEMA, key: k.key, ...k.fields, status: "success", journeyId, journeyVersion, stepId, ...(blockHash ? { blockHash } : {}) }) };
}

// Mismatch against the CURRENT fork context. Order fixed: instance, chain, address.
function contextMismatch(f, ctx) {
  if (f.forkInstanceId !== ctx.forkInstanceId) return "fork_instance_mismatch";
  if (f.chainId !== ctx.chainId) return "chain_mismatch";
  if (f.piggyAddress !== ctx.piggyAddress) return "address_mismatch";
  return null;
}

// [A-993] Orphaned evidence keys (marker rows from orphanRecord, their "fork-orphan|…" keys, or plain evidence keys) -> Set of evidence
// keys | null when the list is malformed. Absent (undefined/null) = empty set: the A-952 behaviour is unchanged.
function readOrphaned(list) {
  if (list === undefined || list === null) return new Set();
  if (!Array.isArray(list)) return null;
  const out = new Set();
  for (const o of list) {
    const k = typeof o === "string" ? low(o) : isObj(o) && o.kind === KIND.ORPHAN ? low(o.evidenceKey) : null;
    if (k === null) return null;
    const ek = k.startsWith(KEY_PREFIX.ORPHAN) ? `${KEY_PREFIX.EVIDENCE}${k.slice(KEY_PREFIX.ORPHAN.length)}` : k;
    if (!parseEvidenceKey(ek)) return null;
    out.add(ek);
  }
  return out;
}

// Normalise an evidence list; one evidence key may prove exactly one (journey, version, step). Reuse anywhere in the list = refused.
function readEvidence(list) {
  if (!Array.isArray(list)) return bad("bad_evidence", "evidence");
  const rows = []; const use = new Map();
  for (const raw of list) {
    const r = evidenceRecord(raw);
    if (!r.ok) return bad("malformed_evidence", r.field);
    const slot = `${r.record.journeyId}|${r.record.journeyVersion}|${r.record.stepId}`;
    const prev = use.get(r.key);
    if (prev !== undefined && prev !== slot) return bad("evidence_reused", "evidence");
    if (prev === undefined) { use.set(r.key, slot); rows.push(r.record); } // an identical repeat is the same proof, counted once
  }
  return { ok: true, rows };
}

/**
 * journeyVerdict({ journeyId, journeyVersion, steps, evidence, context })
 *   steps    : the CHOSEN journey's required step ids (its own length; no fixed count, never the 10-Job list)
 *   evidence : evidenceRecord-shaped rows. Rows of other journeys / versions are not judged.
 *   context  : the CURRENT { forkInstanceId, chainId, piggyAddress, forkStartBlock, testerId? } (see forkContext). Required:
 *              without it "a new forkInstanceId invalidates the old evidence" and the replay floor cannot be decided.
 *   orphaned : [A-993] optional: orphan marker rows (orphanRecord) / their keys / evidence keys. A row named here is SKIPPED (its tx was
 *              lost by a fork restore; the step must be redone). Absent = none (A-952 behaviour). Malformed list = INVALID "bad_orphans".
 * -> frozen { verdict, reason, field, missing[], covered[], journeyId, journeyVersion, testerId, forkInstanceId, chainId,
 *             piggyAddress, forkStartBlock, scope: "user" } — registered as issued (rewardLedgerApply accepts only these)
 *   INVALID    bad input / malformed or reused evidence / a chosen-journey row from another fork instance, chain or address
 *              (address = the tx sender = the journey's Piggy) / a chosen-journey row at or below forkStartBlock ("pre_fork_evidence")
 *   INCOMPLETE some steps have no valid evidence (missing lists them, in step order)
 *   COMPLETE   every step proven by evidence of this instance, chain and Piggy, above the fork start block
 * Fail closed: one foreign or pre-fork row in the chosen journey makes the whole verdict INVALID.
 */
export function journeyVerdict(input) {
  const i = isObj(input) ? input : {};
  const base = { journeyId: null, journeyVersion: null, testerId: null, forkInstanceId: null, chainId: null, piggyAddress: null, forkStartBlock: null, scope: "user" };
  const invalid = (reason, field) => issue({ verdict: VERDICT.INVALID, reason, field: field || null, missing: [], covered: [], ...base });
  const journeyId = normId(i.journeyId); if (!journeyId) return invalid("bad_journey", "journeyId");
  if (journeyId === DEVELOPER_COVERAGE_JOURNEY) return invalid("reserved_journey", "journeyId");
  const journeyVersion = normVersion(i.journeyVersion); if (journeyVersion === null) return invalid("bad_journey", "journeyVersion");
  base.journeyId = journeyId; base.journeyVersion = journeyVersion;
  if (!Array.isArray(i.steps) || i.steps.length === 0) return invalid("bad_journey", "steps");
  const steps = i.steps.map(normId);
  if (steps.some((s) => s === null) || new Set(steps).size !== steps.length) return invalid("bad_journey", "steps");
  const ctx = forkContext(i.context); if (!ctx.ok) return invalid("bad_context", ctx.field);
  Object.assign(base, ctx.fields);
  const ev = readEvidence(i.evidence); if (!ev.ok) return invalid(ev.reason, ev.field);
  const orphaned = readOrphaned(i.orphaned); if (!orphaned) return invalid("bad_orphans", "orphaned"); // [A-993]

  const covered = new Set();
  for (const f of ev.rows) {
    if (f.journeyId !== journeyId || f.journeyVersion !== journeyVersion) continue;
    const m = contextMismatch(f, ctx.fields);
    if (m) return invalid(m);
    if (preFork(f, ctx.fields)) return invalid("pre_fork_evidence", "blockNumber");
    if (!steps.includes(f.stepId)) return invalid("unknown_step", "evidence");
    if (orphaned.has(f.key)) continue; // [A-993] orphaned by a fork restore: not counted. [review fix 2] AFTER the INVALID checks — a marker never hides a bad row
    covered.add(f.stepId);
  }
  const done = steps.filter((s) => covered.has(s));
  const missing = steps.filter((s) => !covered.has(s));
  if (missing.length > 0) return issue({ verdict: VERDICT.INCOMPLETE, reason: "missing_steps", field: null, missing, covered: done, ...base });
  return issue({ verdict: VERDICT.COMPLETE, reason: null, field: null, missing: [], covered: done, ...base });
}

/**
 * developerCoverage({ evidence, context }) — the DEVELOPER count (10 Jobs + Gift), scope "developer".
 * Reads only rows under journeyId "developer-coverage" whose step is in DEVELOPER_COVERAGE_STEPS, of the current context.
 * journeyVerdict never reads this and refuses that journey id; this never reads user journeys.
 */
export function developerCoverage(input) {
  const i = isObj(input) ? input : {};
  const required = DEVELOPER_COVERAGE_STEPS.length;
  const none = (reason) => ({ scope: "developer", reason, required, completedCount: 0, completed: [], missing: [...DEVELOPER_COVERAGE_STEPS], complete: false });
  const ctx = forkContext(i.context); if (!ctx.ok) return none("bad_context");
  const ev = readEvidence(i.evidence); if (!ev.ok) return none(ev.reason);
  const orphaned = readOrphaned(i.orphaned); if (!orphaned) return none("bad_orphans"); // [A-993]
  const done = new Set();
  for (const f of ev.rows) {
    if (f.journeyId !== DEVELOPER_COVERAGE_JOURNEY || !DEVELOPER_COVERAGE_STEPS.includes(f.stepId)) continue;
    if (contextMismatch(f, ctx.fields) || preFork(f, ctx.fields)) continue; // other instance / chain / address, or pre-fork: not counted
    if (orphaned.has(f.key)) continue; // [A-993]
    done.add(f.stepId);
  }
  const completed = DEVELOPER_COVERAGE_STEPS.filter((s) => done.has(s));
  const missing = DEVELOPER_COVERAGE_STEPS.filter((s) => !done.has(s));
  return { scope: "developer", reason: null, required, completedCount: completed.length, completed, missing, complete: missing.length === 0 };
}

/** rewardKey({ testerId, rewardCampaignVersion }) — one reward per tester per campaign version. No Piggy, fork, Job or Gift in it. */
export function rewardKey(input) {
  const i = isObj(input) ? input : {};
  const testerId = normId(i.testerId); if (!testerId) return bad("missing_or_invalid", "testerId");
  const rewardCampaignVersion = normId(i.rewardCampaignVersion); if (!rewardCampaignVersion) return bad("missing_or_invalid", "rewardCampaignVersion");
  return { ok: true, key: `${KEY_PREFIX.REWARD}${testerId}|${rewardCampaignVersion}`, fields: { testerId, rewardCampaignVersion } };
}

/** stampKey({ testerId, forkInstanceId, journeyId }) — the 2차 fork completion stamp. Not the A-897 `alpha!` stamp. */
export function stampKey(input) {
  const i = isObj(input) ? input : {};
  const testerId = normId(i.testerId); if (!testerId) return bad("missing_or_invalid", "testerId");
  const forkInstanceId = normId(i.forkInstanceId); if (!forkInstanceId) return bad("missing_or_invalid", "forkInstanceId");
  const journeyId = normId(i.journeyId); if (!journeyId) return bad("missing_or_invalid", "journeyId");
  if (journeyId === DEVELOPER_COVERAGE_JOURNEY) return bad("reserved_journey", "journeyId");
  return { ok: true, key: `${KEY_PREFIX.STAMP}${testerId}|${forkInstanceId}|${journeyId}`, fields: { testerId, forkInstanceId, journeyId } };
}

export function rewardLedgerEmpty() {
  return Object.freeze({ schema: FORK_LEDGER_SCHEMA, entries: Object.freeze({}) });
}

/**
 * rewardLedgerApply(ledger, entry)
 *   entry = { testerId, rewardCampaignVersion, rewardKey?, verdict: <the object journeyVerdict returned> }
 *   - entry.verdict must be an object issued by journeyVerdict in this process (a "COMPLETE" string, a hand-written or
 *     JSON-copied object is refused: "verdict_not_issued"), with verdict COMPLETE ("not_complete")
 *   - the verdict must carry a testerId equal to entry.testerId ("verdict_without_tester" / "verdict_tester_mismatch");
 *     if the entry also names piggyAddress / forkInstanceId / journeyId / journeyVersion they must equal the verdict's
 *     ("verdict_mismatch"). The stored row takes those fields from the verdict, never from the entry.
 *   - entry.rewardKey, when given, must equal rewardKey(entry)
 *   - the same rewardKey already in the ledger => { ok:false, reason:"duplicate_reward" } — whatever Piggy / fork / journey
 *   - success => a NEW frozen ledger. The input ledger is never mutated (refusals return the same ledger object).
 * The store's putIfAbsent on the "rewards" collection is the cross-instance guard; this is the same rule as a pure function.
 */
export function rewardLedgerApply(ledger, entry) {
  const refuse = (reason, field, key) => ({ ok: false, reason, field: field || null, key: key || null, ledger });
  if (!isObj(ledger) || ledger.schema !== FORK_LEDGER_SCHEMA || !isObj(ledger.entries)) return refuse("invalid_ledger");
  if (!isObj(entry)) return refuse("invalid_entry");
  const rk = rewardKey(entry); if (!rk.ok) return refuse("invalid_entry", rk.field);
  if (own(entry, "rewardKey") && low(entry.rewardKey) !== rk.key) return refuse("reward_key_mismatch", "rewardKey", rk.key);
  const v = entry.verdict;
  if (!isObj(v) || !ISSUED_VERDICTS.has(v)) return refuse("verdict_not_issued", "verdict", rk.key);
  if (v.verdict !== VERDICT.COMPLETE) return refuse("not_complete", "verdict", rk.key);
  if (!v.testerId) return refuse("verdict_without_tester", "testerId", rk.key);
  if (v.testerId !== rk.fields.testerId) return refuse("verdict_tester_mismatch", "testerId", rk.key);
  const named = { piggyAddress: normAddr, forkInstanceId: normId, journeyId: normId, journeyVersion: normVersion };
  for (const [f, norm] of Object.entries(named)) {
    if (own(entry, f) && norm(entry[f]) !== v[f]) return refuse("verdict_mismatch", f, rk.key);
  }
  const { piggyAddress, forkInstanceId, journeyId, journeyVersion } = v;
  if (own(ledger.entries, rk.key)) return refuse("duplicate_reward", null, rk.key);
  const record = Object.freeze({ kind: KIND.REWARD, schema: FORK_LEDGER_SCHEMA, key: rk.key, ...rk.fields, piggyAddress, forkInstanceId, journeyId, journeyVersion });
  const next = Object.freeze({ schema: FORK_LEDGER_SCHEMA, entries: Object.freeze({ ...ledger.entries, [rk.key]: record }) });
  return { ok: true, reason: null, field: null, key: rk.key, record, ledger: next };
}

// Positive USDC amount as a decimal string, at most 6 decimals, canonical (no trailing fractional zeros). No floats.
function normAmount(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const m = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,6}))?$/.exec(s);
  if (!m || !/[1-9]/.test(s)) return null;
  const frac = (m[2] || "").replace(/0+$/, "");
  return frac ? `${m[1]}.${frac}` : m[1]; // canonical: "10.50" -> "10.5", "10.0" -> "10"
}

/**
 * payoutRecord({ rewardKey, mainnetTxHash, amount, ownerNote })
 * RECORD SHAPE ONLY — written after the Owner paid by hand on Monad mainnet. Nothing here sends, signs or moves value.
 * Kept apart from fork evidence: own kind, own key "payout|<rewardKey>" (one payout per reward), and any fork-evidence
 * field on the input (forkInstanceId, txHash, blockNumber, …) is refused.
 */
export function payoutRecord(input) {
  const i = isObj(input) ? input : {};
  const leak = FORK_EVIDENCE_FIELDS.find((f) => own(i, f)); if (leak) return bad("fork_evidence_field_in_payout", leak);
  const rk = low(i.rewardKey);
  const parts = rk === null ? [] : rk.split("|");
  if (parts.length !== 3 || `${parts[0]}|` !== KEY_PREFIX.REWARD || !ID_RE.test(parts[1]) || !ID_RE.test(parts[2])) return bad("missing_or_invalid", "rewardKey");
  const mainnetTxHash = normHash(i.mainnetTxHash); if (!mainnetTxHash) return bad("missing_or_invalid", "mainnetTxHash");
  const amount = normAmount(i.amount); if (amount === null) return bad("missing_or_invalid", "amount");
  if (i.ownerNote !== undefined && typeof i.ownerNote !== "string") return bad("missing_or_invalid", "ownerNote");
  const ownerNote = typeof i.ownerNote === "string" ? i.ownerNote.trim() : "";
  if (ownerNote.length > 500) return bad("missing_or_invalid", "ownerNote");
  const key = `${KEY_PREFIX.PAYOUT}${rk}`;
  return {
    ok: true,
    key,
    record: Object.freeze({ kind: KIND.PAYOUT, schema: FORK_LEDGER_SCHEMA, key, rewardKey: rk, mainnetChainId: PAYOUT_CHAIN_ID, asset: PAYOUT_ASSET, mainnetTxHash, amount, ownerNote, executes: false }),
  };
}

/** stampRecord({ testerId, forkInstanceId, journeyId }) — the stored stamp row, keyed by stampKey. */
export function stampRecord(input) {
  const k = stampKey(input); if (!k.ok) return k;
  return { ok: true, key: k.key, record: Object.freeze({ kind: KIND.STAMP, schema: FORK_LEDGER_SCHEMA, key: k.key, ...k.fields }) };
}

// ── [A-956] Journey 2 entry + top-up records (card E). Same rules as above: pure, no I/O, canonical keys, bad input = { ok:false }.
// Entry key = forkInstanceId + testerId: one Piggy per tester per fork instance (the testerId comes from server auth only; a second
// Piggy for the same tester on the same instance finds the existing row and is refused by the caller). A new fork instance = a new key.
// Top-up key = forkInstanceId + piggyAddress + asset + grantVersion (A-946 ENTRY_CONTRACT grant key; the A-949 Admin ledger uses the same
// four fields). Journey 1 evidence in the entry row = what the SERVER read on chain 10143 (never request values).
export const ENTRY_ASSETS = Object.freeze(["MON", "USDC", "WETH", "AUSD"]); // pre-A-959: ["MON", "USDC"] (Euler = WETH · Upshift = AUSD at entry, A-955 ASSET_AUDIT)
export const JOURNEY1_CHAIN_ID = "10143";
const normAsset = (v) => (typeof v === "string" && ENTRY_ASSETS.includes(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null);

/** entryKey({ forkInstanceId, testerId }) — "fork-entry|<forkInstanceId>|<testerId>". */
export function entryKey(input) {
  const i = isObj(input) ? input : {};
  const forkInstanceId = normId(i.forkInstanceId); if (!forkInstanceId) return bad("missing_or_invalid", "forkInstanceId");
  const testerId = normId(i.testerId); if (!testerId) return bad("missing_or_invalid", "testerId");
  return { ok: true, key: `${KEY_PREFIX.ENTRY}${forkInstanceId}|${testerId}`, fields: { forkInstanceId, testerId } };
}

/**
 * entryRecord({ forkInstanceId, testerId, piggyAddress, journey1DepositTxHash, journey1RedeemTxHash, journey1BlockNumber })
 * The one row stored when the server let a tester in. journey1* = the server's own chain-10143 read (deposit + redeem, both from the Piggy).
 */
export function entryRecord(input) {
  const i = isObj(input) ? input : {};
  const k = entryKey(i); if (!k.ok) return k;
  const piggyAddress = normAddr(i.piggyAddress); if (!piggyAddress) return bad("missing_or_invalid", "piggyAddress");
  const journey1DepositTxHash = normHash(i.journey1DepositTxHash); if (!journey1DepositTxHash) return bad("missing_or_invalid", "journey1DepositTxHash");
  const journey1RedeemTxHash = normHash(i.journey1RedeemTxHash); if (!journey1RedeemTxHash) return bad("missing_or_invalid", "journey1RedeemTxHash");
  if (journey1DepositTxHash === journey1RedeemTxHash) return bad("missing_or_invalid", "journey1RedeemTxHash");
  const journey1BlockNumber = normBlock(i.journey1BlockNumber); if (journey1BlockNumber === null) return bad("missing_or_invalid", "journey1BlockNumber");
  return { ok: true, key: k.key, record: Object.freeze({ kind: KIND.ENTRY, schema: FORK_LEDGER_SCHEMA, key: k.key, ...k.fields, piggyAddress, journey1ChainId: JOURNEY1_CHAIN_ID, journey1DepositTxHash, journey1RedeemTxHash, journey1BlockNumber }) };
}

/** topupKey({ forkInstanceId, piggyAddress, asset, grantVersion }) — "fork-topup|<fork>|<piggy>|<MON|USDC|WETH|AUSD>|<grantVersion>". */
export function topupKey(input) {
  const i = isObj(input) ? input : {};
  const forkInstanceId = normId(i.forkInstanceId); if (!forkInstanceId) return bad("missing_or_invalid", "forkInstanceId");
  const piggyAddress = normAddr(i.piggyAddress); if (!piggyAddress) return bad("missing_or_invalid", "piggyAddress");
  const asset = normAsset(i.asset); if (!asset) return bad("missing_or_invalid", "asset");
  const grantVersion = normId(i.grantVersion); if (!grantVersion) return bad("missing_or_invalid", "grantVersion");
  return { ok: true, key: `${KEY_PREFIX.TOPUP}${forkInstanceId}|${piggyAddress}|${asset}|${grantVersion}`, fields: { forkInstanceId, piggyAddress, asset, grantVersion } };
}

/** topupRecord({ forkInstanceId, piggyAddress, asset, grantVersion, testerId, amountRaw }) — the outcome row after the Admin answered. */
export function topupRecord(input) {
  const i = isObj(input) ? input : {};
  const k = topupKey(i); if (!k.ok) return k;
  const testerId = normId(i.testerId); if (!testerId) return bad("missing_or_invalid", "testerId");
  const amountRaw = typeof i.amountRaw === "string" && /^[1-9][0-9]{0,77}$/.test(i.amountRaw.trim()) ? i.amountRaw.trim() : null;
  if (amountRaw === null) return bad("missing_or_invalid", "amountRaw");
  return { ok: true, key: k.key, record: Object.freeze({ kind: KIND.TOPUP, schema: FORK_LEDGER_SCHEMA, key: k.key, ...k.fields, testerId, amountRaw }) };
}

// [A-956 review fix 1] One Piggy = one tester per fork instance, and one Journey 1 tx = one tester (all instances).
// entryPiggyRecord: "fork-entry-piggy|<forkInstanceId>|<piggy>" → testerId. The entry service writes it with putIfAbsent BEFORE the entry
// row (it is the lock: a second tester with the same Piggy on the same instance finds it and is refused), and status / completion
// require the entry row and this row to name each other.
// journey1UseRecord: "fork-j1|<txHash>" → testerId + piggy. Written for the deposit and the redeem hash before the Piggy row; the same
// hash under another tester is refused, whatever the fork instance.
export function entryPiggyKey(input) {
  const i = isObj(input) ? input : {};
  const forkInstanceId = normId(i.forkInstanceId); if (!forkInstanceId) return bad("missing_or_invalid", "forkInstanceId");
  const piggyAddress = normAddr(i.piggyAddress); if (!piggyAddress) return bad("missing_or_invalid", "piggyAddress");
  return { ok: true, key: `${KEY_PREFIX.ENTRY_PIGGY}${forkInstanceId}|${piggyAddress}`, fields: { forkInstanceId, piggyAddress } };
}
export function entryPiggyRecord(input) {
  const i = isObj(input) ? input : {};
  const k = entryPiggyKey(i); if (!k.ok) return k;
  const testerId = normId(i.testerId); if (!testerId) return bad("missing_or_invalid", "testerId");
  return { ok: true, key: k.key, record: Object.freeze({ kind: KIND.ENTRY_PIGGY, schema: FORK_LEDGER_SCHEMA, key: k.key, ...k.fields, testerId }) };
}
export function journey1UseKey(input) {
  const i = isObj(input) ? input : {};
  const txHash = normHash(i.txHash); if (!txHash) return bad("missing_or_invalid", "txHash");
  return { ok: true, key: `${KEY_PREFIX.JOURNEY1_USE}${txHash}`, fields: { txHash } };
}
export function journey1UseRecord(input) {
  const i = isObj(input) ? input : {};
  const k = journey1UseKey(i); if (!k.ok) return k;
  const testerId = normId(i.testerId); if (!testerId) return bad("missing_or_invalid", "testerId");
  const piggyAddress = normAddr(i.piggyAddress); if (!piggyAddress) return bad("missing_or_invalid", "piggyAddress");
  return { ok: true, key: k.key, record: Object.freeze({ kind: KIND.JOURNEY1_USE, schema: FORK_LEDGER_SCHEMA, key: k.key, ...k.fields, journey1ChainId: JOURNEY1_CHAIN_ID, testerId, piggyAddress }) };
}

// ── [A-993] Fork restart reconcile records (A-981 loss window). Pure, append-only: an orphan is a SEPARATE marker row in its own
// namespace — the evidence row itself is never edited or deleted. A re-grant candidate is a record shape only (executes:false): nothing
// here (or in the reconcile module) calls the Admin top-up or moves value.
export const ORPHAN_REASON = Object.freeze({ ORPHANED_BY_RESTORE: "orphaned_by_restore" });
export const REGRANT_REASON = Object.freeze({ TOPUP_AFTER_SNAPSHOT: "topup_after_snapshot" });

// A CANONICAL evidence key -> its fields | null (the key must equal what evidenceKey rebuilds from them).
function parseEvidenceKey(key) {
  if (typeof key !== "string" || !key.startsWith(KEY_PREFIX.EVIDENCE)) return null;
  const p = key.slice(KEY_PREFIX.EVIDENCE.length).split("|");
  if (p.length !== 5) return null;
  const k = evidenceKey({ forkInstanceId: p[0], chainId: p[1], piggyAddress: p[2], txHash: p[3], blockNumber: p[4] });
  return k.ok && k.key === key ? k.fields : null;
}

/** orphanKey({ evidenceKey }) — "fork-orphan|<the evidence key's fields>": at most one marker per evidence row. */
export function orphanKey(input) {
  const i = isObj(input) ? input : {};
  const f = parseEvidenceKey(i.evidenceKey); if (!f) return bad("missing_or_invalid", "evidenceKey");
  return { ok: true, key: `${KEY_PREFIX.ORPHAN}${i.evidenceKey.slice(KEY_PREFIX.EVIDENCE.length)}`, fields: { evidenceKey: i.evidenceKey, forkInstanceId: f.forkInstanceId, piggyAddress: f.piggyAddress } };
}

/** orphanRecord({ evidenceKey, reason }) — the marker row markOrphaned appends. reason ∈ ORPHAN_REASON. */
export function orphanRecord(input) {
  const i = isObj(input) ? input : {};
  const k = orphanKey(i); if (!k.ok) return k;
  const reason = Object.values(ORPHAN_REASON).includes(i.reason) ? i.reason : null; if (!reason) return bad("missing_or_invalid", "reason");
  return { ok: true, key: k.key, record: Object.freeze({ kind: KIND.ORPHAN, schema: FORK_LEDGER_SCHEMA, key: k.key, ...k.fields, reason }) };
}

/** nextGrantVersion("g1") -> "g1.r1" · ("g1.r1") -> "g1.r2" · null when the result is not a valid id (too long). */
export function nextGrantVersion(v) {
  const g = normId(v); if (!g) return null;
  const m = /^(.*)\.r([1-9][0-9]{0,5})$/.exec(g);
  return normId(m ? `${m[1]}.r${Number(m[2]) + 1}` : `${g}.r1`);
}

// "g1.r3" -> { base: "g1", n: 3 } · "g1" -> { base: "g1", n: 0 }
const splitGrantVersion = (g) => { const m = /^(.*)\.r([1-9][0-9]{0,5})$/.exec(g); return m ? { base: m[1], n: Number(m[2]) } : { base: g, n: 0 }; };

/**
 * regrantRecord({ forkInstanceId, piggyAddress, asset, previousGrantVersion, grantVersion?, reason }) — a RE-GRANT CANDIDATE for a top-up
 * the restored chain lost (TOPUP_AFTER_SNAPSHOT). Key = the top-up key fields under the NEW grantVersion, own namespace "fork-regrant|…".
 * grantVersion defaults to nextGrantVersion(previous); [review fix 3] a caller that found that version already used (topups / regrants)
 * may pass a later one: it must be "<same base>.r<N>" with N above the previous one's. executes:false — this row never tops up.
 */
export function regrantRecord(input) {
  const i = isObj(input) ? input : {};
  const previousGrantVersion = normId(i.previousGrantVersion); if (!previousGrantVersion) return bad("missing_or_invalid", "previousGrantVersion");
  let grantVersion = nextGrantVersion(previousGrantVersion); if (!grantVersion) return bad("missing_or_invalid", "previousGrantVersion");
  if (i.grantVersion !== undefined && i.grantVersion !== null) {
    grantVersion = normId(i.grantVersion);
    const p = splitGrantVersion(previousGrantVersion); const g = grantVersion ? splitGrantVersion(grantVersion) : null;
    if (!g || g.base !== p.base || g.n <= p.n) return bad("missing_or_invalid", "grantVersion");
  }
  const t = topupKey({ forkInstanceId: i.forkInstanceId, piggyAddress: i.piggyAddress, asset: i.asset, grantVersion }); if (!t.ok) return t;
  const reason = Object.values(REGRANT_REASON).includes(i.reason) ? i.reason : null; if (!reason) return bad("missing_or_invalid", "reason");
  const key = `${KEY_PREFIX.REGRANT}${t.key.slice(KEY_PREFIX.TOPUP.length)}`;
  return { ok: true, key, record: Object.freeze({ kind: KIND.REGRANT, schema: FORK_LEDGER_SCHEMA, key, ...t.fields, previousGrantVersion, reason, executes: false }) };
}
