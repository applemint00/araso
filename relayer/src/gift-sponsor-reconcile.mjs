// [A-913 E] Chain-truth reconcile for the Gift sponsor ledger. Runs on relayer start (server.mjs) and from relayer/tools/gift-gas-reconcile.mjs --sponsor.
//
// For every ledger entry that is not finished (state != CLAIMED, or CLAIMED with revokeStatus != "done"):
//   1. READ chain truth (read-only): code at the Piggy (our designator / none / foreign) · commits(giftId, Piggy) · gifts(giftId).claimed/expiry ·
//      chain time · Piggy nonce · sponsor nonces · the recorded in-flight tx receipt (if any). "Delegation enabled" = the Piggy still carries our designator;
//      "revoked" = the Piggy code is clean after the commit (the A-814 D revoke: Piggy-signed type-4 {address 0x0, nonce n+1} submitted by the sponsor).
//   2. DECIDE exactly ONE next step from the table below (decideNextStep is pure and exported; the README table is generated from RECONCILE_TABLE).
//   3. EXECUTE only that step through the same guarded steps the live flow uses (value 0, preflight before every send, inflight marker before broadcast).
// "Sent but unsure" (an `inflight` marker without a ledger transition) is NEVER resent blindly: the receipt / the chain effect is read first; while a
// tx may still be pending (receipt absent, sponsor pending nonce > latest, or younger than the injected `inflightGraceSeconds`) the answer is WAIT.
// `inflightGraceSeconds` is an UNKNOWN number => injected; missing => WAIT forever (report only, never resend).
// Nothing here chooses a recipient, signs for a user, or sends MON to the Piggy: all calldata is rebuilt from the persisted plan (buildSponsorCalls).

import { SponsorStepError, buildSponsorCalls } from "./gift-sponsor-service.mjs";

const ZERO32 = `0x${"0".repeat(64)}`;
const lc = (s) => String(s).toLowerCase();
const short = (g) => `${String(g).slice(0, 10)}…`;

/** Single source for the operator runbook (README table) and the tests. step = what reconcile does NEXT (one step). */
export const RECONCILE_TABLE = Object.freeze([
  { row: "R1", installed: "no",  commit: "no",    claim: "no",  delegation: "-",       window: "open",    step: "INSTALL",       note: "start from the beginning with the stored plan (install, then commit on the next round)" },
  { row: "R1x", installed: "no", commit: "no",    claim: "no",  delegation: "-",       window: "expired", step: "ARCHIVE",       note: "nothing on chain, window over: archive; a fresh Face ID request may start" },
  { row: "R2", installed: "yes", commit: "no",    claim: "no",  delegation: "enabled", window: "open",    step: "COMMIT",        note: "continue: commitClaim via redeemDelegations" },
  { row: "R3", installed: "yes", commit: "no",    claim: "no",  delegation: "enabled", window: "expired", step: "REVOKE+ARCHIVE", note: "revoke only (best effort), archive, wait for a NEW Face ID" },
  { row: "R4", installed: "yes", commit: "yes",   claim: "no",  delegation: "enabled", window: "-",       step: "REVOKE+CLAIM",  note: "revoke (never blocks), then plain claim()" },
  { row: "R5", installed: "yes", commit: "yes",   claim: "no",  delegation: "revoked ", window: "-",      step: "CLAIM",         note: "plain claim()" },
  { row: "R6", installed: "yes", commit: "yes",   claim: "yes", delegation: "enabled", window: "-",       step: "REVOKE",        note: "revoke cleanup, ledger CLAIMED" },
  { row: "R7", installed: "yes", commit: "yes",   claim: "yes", delegation: "revoked ", window: "-",      step: "DONE",          note: "ledger CLAIMED, revokeStatus done" },
  { row: "R8", installed: "?",   commit: "?",     claim: "?",   delegation: "?",       window: "-",       step: "WAIT",          note: "tx sent but unsure (inflight): read receipt / chain effect first; never resend while it may be pending" },
  { row: "H",  installed: "?",   commit: "foreign", claim: "?", delegation: "?",       window: "-",       step: "HUMAN",         note: "anything the table does not cover (foreign code at the Piggy, foreign commit hash, receipt success with no effect): UNKNOWN, operator decides" },
]);

const isOwed = (e) => e.state !== "CLAIMED" || (e.revokeStatus !== "done" && e.revokeStatus !== "exhausted"); // exhausted = revoke gave up (needsHuman), claim unaffected

/** Read-only chain truth for one entry. Throws if any read fails (caller answers WAIT). */
export async function readChainTruth({ chain, policy, entry }) {
  const plan = entry.plan;
  const calls = buildSponsorCalls(policy, plan);
  const inflight = entry.inflight ?? null;
  const revokeHash = inflight === null && entry.revokeInflight?.txHash ? entry.revokeInflight.txHash : (entry.revokeInflight?.txHash ?? null);
  const claimHash = entry.claimTx ?? (inflight?.kind === "claim" ? inflight.txHash ?? null : null);
  const [code, commitRaw, gift, now, authNonce, nonces, receipt, claimReceipt, revokeReceipt] = await Promise.all([
    chain.getCode(calls.delegator),
    chain.getCommit(entry.giftId, calls.delegator),
    chain.getGift(entry.giftId),
    chain.getTimestamp(),
    chain.getNonce(calls.delegator),
    chain.getSponsorNonces(),
    inflight?.txHash ? chain.getReceipt(inflight.txHash) : Promise.resolve(null),
    claimHash ? chain.getReceipt(claimHash) : Promise.resolve(null),
    revokeHash ? chain.getReceipt(revokeHash) : Promise.resolve(null),
  ]);
  const c = lc(typeof code === "string" ? code : "0x");
  const designator = c === "0x" || c === "" ? "none" : c === calls.designator ? "ours" : "other";
  const commit = commitRaw && typeof commitRaw.hash === "string" && lc(commitRaw.hash) !== ZERO32
    ? { hash: lc(commitRaw.hash), blockNumber: commitRaw.blockNumber ?? null } : null;
  return {
    designator, commit, now: BigInt(now), authNonce: BigInt(authNonce),
    gift: { exists: gift?.exists === true, claimed: gift?.claimed === true, expiry: typeof gift?.expiry === "bigint" ? gift.expiry : null },
    nonces: { latest: BigInt(nonces.latest), pending: BigInt(nonces.pending) }, receipt: receipt ?? null, revokeReceipt: revokeReceipt ?? null,
    // the escrow clears commits() on claim, so "our claim" is proven by OUR recorded claim tx receipt (success) + gifts(giftId).claimed - not by commits()
    ourClaim: claimReceipt?.status === "success" && gift?.claimed === true,
    claimTxRecorded: claimHash !== null,
  };
}

/** Is the in-flight step's effect visible on chain? */
function effectVisible(kind, truth, plan) {
  if (kind === "install") return truth.designator === "ours";
  if (kind === "redeem") return truth.commit !== null && truth.commit.hash === plan.commitHash;
  if (kind === "revoke") return truth.designator === "none";
  if (kind === "claim") return truth.gift.claimed;
  return false;
}

/** PURE. (entry, truth, { inflightGraceSeconds, nowMs }) -> { step, row, why }. Exactly one next step, or WAIT / HUMAN. */
export function decideNextStep(entry, truth, opts = {}) {
  const d = decideCore(entry, truth, opts);
  if (!String(d.step).includes("REVOKE")) return d;
  // [F-2] a revoke sent-but-unsure (own marker): never resend while it may be pending. Only steps that need a revoke are held; CLAIM is never blocked by it.
  const rv = entry.revokeInflight;
  if (!rv || truth.designator === "none") return d;
  const { inflightGraceSeconds = null, nowMs = Date.now() } = opts;
  if (rv.txHash) return truth.revokeReceipt === null ? { step: "WAIT", row: "R8", why: "revoke_receipt_absent" } : d;
  if (truth.nonces.pending > truth.nonces.latest) return { step: "WAIT", row: "R8", why: "revoke_tx_pending" };
  const graceMs = Number.isSafeInteger(inflightGraceSeconds) && inflightGraceSeconds > 0 ? inflightGraceSeconds * 1000 : null;
  if (graceMs === null) return { step: "WAIT", row: "R8", why: "grace_unknown" };
  return nowMs - Number(rv.at) >= graceMs ? d : { step: "WAIT", row: "R8", why: "revoke_too_young" };
}

function decideCore(entry, truth, { inflightGraceSeconds = null, nowMs = Date.now() } = {}) {
  const plan = entry.plan;
  if (!plan) return { step: "HUMAN", row: "H", why: "no_plan" };
  if (truth.designator === "other") return { step: "HUMAN", row: "H", why: "foreign_code_at_piggy" };
  if (truth.commit && truth.commit.hash !== plan.commitHash) return { step: "HUMAN", row: "H", why: "foreign_commit_hash" };

  // R8: a send was started (inflight marker) and the ledger never saw its confirmation.
  const inf = entry.inflight;
  if (inf && !effectVisible(inf.kind, truth, plan)) {
    if (inf.txHash) {
      if (truth.receipt === null) return { step: "WAIT", row: "R8", why: "receipt_absent" };
      if (truth.receipt.status === "success") return { step: "HUMAN", row: "H", why: "receipt_success_no_effect" };
      // receipt reverted: provably did not take effect -> fall through to the table
    } else {
      if (truth.nonces.pending > truth.nonces.latest) return { step: "WAIT", row: "R8", why: "sponsor_tx_pending" };
      const graceMs = Number.isSafeInteger(inflightGraceSeconds) && inflightGraceSeconds > 0 ? inflightGraceSeconds * 1000 : null;
      if (graceMs === null) return { step: "WAIT", row: "R8", why: "grace_unknown" };            // UNKNOWN number: never resend without it
      if (!(nowMs - Number(inf.at) >= graceMs)) return { step: "WAIT", row: "R8", why: "inflight_too_young" };
      // old enough, nothing pending, effect not visible: the tx was never mined (or mined and reverted) -> safe to take the table's step
    }
  }

  const planCommit = plan.commitHash;
  const hasCommit = truth.commit !== null && truth.commit.hash === planCommit;
  const windowOpen = BigInt(plan.beforeSeconds) > truth.now;
  const giftLive = truth.gift.exists && !truth.gift.claimed && truth.gift.expiry !== null && truth.gift.expiry > truth.now;

  if (truth.gift.claimed) {
    // claimed elsewhere ONLY when there is no claim tx of ours; a recorded claim tx whose receipt is not (yet) proven success is never archived
    if (!hasCommit && !truth.ourClaim) {
      if (truth.claimTxRecorded || entry.inflight?.kind === "claim") return truth.nonces.pending > truth.nonces.latest ? { step: "WAIT", row: "R8", why: "claim_tx_pending" } : { step: "HUMAN", row: "H", why: "claim_tx_not_proven" };
      return { step: "ARCHIVE", row: "R1x", why: "gift_claimed_elsewhere" };
    }
    return truth.designator === "none" ? { step: "DONE", row: "R7", why: "claimed_and_revoked" } : { step: "REVOKE", row: "R6", why: "claimed_revoke_cleanup" };
  }
  if (hasCommit) return truth.designator === "none" ? { step: "CLAIM", row: "R5", why: "committed_revoked" } : { step: "REVOKE+CLAIM", row: "R4", why: "committed_enabled" };
  // commit absent
  if (truth.designator === "ours") {
    if (windowOpen && giftLive) return { step: "COMMIT", row: "R2", why: "installed_window_open" };
    return { step: "REVOKE+ARCHIVE", row: "R3", why: "installed_window_over_or_gift_gone" };
  }
  if (windowOpen && giftLive && truth.authNonce === BigInt(plan.authorization.nonce)) return { step: "INSTALL", row: "R1", why: "nothing_on_chain_window_open" };
  return { step: "ARCHIVE", row: "R1x", why: "nothing_on_chain_window_over" };
}

export function createGiftSponsorReconciler({ ledger, policy, chain, steps, runExclusive = (fn) => fn(), log = () => {}, nowMs = () => Date.now(), inflightGraceSeconds = null, maxRounds = 4, revokeBackoffSeconds = null }) {
  const say = (m, id) => { try { log(`gift-sponsor-reconcile ${m}${id ? ` ${short(id)}` : ""}`); } catch { /* logger must not break flow */ } };
  const rounds = Number.isSafeInteger(maxRounds) && maxRounds >= 1 ? maxRounds : 4;

  /** Bring the ledger up to what the chain PROVES (never beyond it, never backwards). */
  async function adopt(entry, truth) {
    const id = entry.giftId;
    const rank = { RESERVED: 0, INSTALLED: 1, COMMITTED: 2, REVOKED: 3, CLAIMED: 4 };
    const eff = (e) => (e.state === "UNKNOWN" ? (e.lastGoodState ?? "RESERVED") : e.state);
    const hasCommit = truth.commit !== null && truth.commit.hash === entry.plan.commitHash;
    const mine = hasCommit || truth.ourClaim;
    const revoked = mine && truth.designator === "none";
    if (truth.gift.claimed && mine) { await ledger.update(id, "CLAIMED", { inflight: null, ...(revoked ? { revokeStatus: "done", revokeInflight: null } : {}) }); return; }
    if (revoked && rank[eff(await ledger.get(id))] < rank.REVOKED) { await ledger.update(id, "REVOKED", { revokeStatus: "done", inflight: null, revokeInflight: null, commitBlock: String(truth.commit.blockNumber ?? "") }); return; }
    if (hasCommit && rank[eff(await ledger.get(id))] < rank.COMMITTED) await ledger.update(id, "COMMITTED", { inflight: null, commitBlock: String(truth.commit.blockNumber ?? "") });
    if (truth.designator === "ours" && rank[eff(await ledger.get(id))] < rank.INSTALLED) await ledger.update(id, "INSTALLED", { inflight: null });
  }

  async function reconcileOne(id, { dryRun = false } = {}) {
    let entry = await ledger.get(id);
    if (!entry || !isOwed(entry)) return { giftId: id, step: "NONE", row: "-", why: "not_owed", progress: false };
    let truth;
    try { truth = await readChainTruth({ chain, policy, entry }); }
    catch { say("chain_read_failed(WAIT)", id); return { giftId: id, step: "WAIT", row: "R8", why: "chain_read_failed", progress: false }; }
    // [F-2] a revoke tx that MINED (receipt known) without cleaning the Piggy is a counted failure, not a pending tx and not a HUMAN stop
    if (!dryRun && entry.revokeInflight?.txHash && truth.revokeReceipt && truth.designator !== "none") {
      const n = (entry.revokeFailures ?? 0) + 1;
      await ledger.mark(id, { revokeInflight: null, revokeFailures: n, revokeNextAt: nowMs() + (revokeBackoffSeconds ? revokeBackoffSeconds * 1000 * 2 ** (n - 1) : 0) });
      entry = await ledger.get(id);
    }
    const d = decideNextStep(entry, truth, { inflightGraceSeconds, nowMs: nowMs() });
    const out = { giftId: id, state: entry.state, step: d.step, row: d.row, why: d.why, progress: false };
    if (dryRun) return out;
    say(`${d.row} ${d.step} (${d.why})`, id);
    try {
      if (d.step === "WAIT") return out;
      if (d.step === "HUMAN") { await ledger.mark(id, { needsHuman: d.why }); if (entry.state !== "UNKNOWN") await ledger.update(id, "UNKNOWN"); return out; }
      if (d.step === "ARCHIVE") { await ledger.archive(id, d.why); return { ...out, progress: true }; }
      if (d.step === "REVOKE+ARCHIVE") { await adopt(entry, truth); await steps.revoke(id); await ledger.archive(id, d.why); return { ...out, progress: true }; }
      await adopt(entry, truth);
      if (d.step === "DONE") { await ledger.mark(id, { revokeStatus: "done", inflight: null }); return { ...out, progress: true }; }
      if (d.step === "INSTALL") await steps.install(id);
      else if (d.step === "COMMIT") await steps.commit(id);
      else if (d.step === "REVOKE") { await steps.revoke(id); }
      else if (d.step === "REVOKE+CLAIM") { await steps.revoke(id); await steps.claim(id); }
      else if (d.step === "CLAIM") await steps.claim(id);
      // revoke-only on a claimed gift can end "unavailable": that is a state the ledger records, not progress
      const after = await ledger.get(id);
      return { ...out, progress: d.step !== "REVOKE" || after.revokeStatus === "done" };
    } catch (err) {
      if (err instanceof SponsorStepError && err.notSent) { try { await ledger.mark(id, { inflight: null, lastError: err.code }); } catch { /* failstop */ } say(`step_not_sent(${err.code})`, id); return { ...out, why: `${d.why}/${err.code}` }; }
      try { const e2 = await ledger.get(id); if (e2 && e2.state !== "CLAIMED") await ledger.update(id, "UNKNOWN"); } catch { /* failstop */ }
      say("step_ambiguous(UNKNOWN)", id);
      return { ...out, why: `${d.why}/ambiguous` };
    }
  }

  /** Decide only (no send, no ledger write): the operator report. */
  async function plan() {
    const out = [];
    for (const e of (await ledger.list()).filter(isOwed)) out.push(await reconcileOne(e.giftId, { dryRun: true }));
    return out;
  }

  /** Execute: up to `maxRounds` rounds, each round one step per owed entry, re-reading chain truth between steps. Serialized with live requests. */
  function run() {
    return runExclusive(async () => {
      const results = [];
      for (let r = 1; r <= rounds; r += 1) {
        const owed = (await ledger.list()).filter(isOwed);
        if (owed.length === 0) break;
        let progressed = false;
        for (const e of owed) { const res = await reconcileOne(e.giftId); results.push({ round: r, ...res }); if (res.progress) progressed = true; }
        if (!progressed) break;
      }
      return { results, remaining: (await ledger.list()).filter(isOwed).map((e) => ({ giftId: e.giftId, state: e.state, revokeStatus: e.revokeStatus ?? null })) };
    });
  }

  return { run, plan, reconcileOne };
}
