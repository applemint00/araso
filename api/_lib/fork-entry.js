// [A-956] Journey 2 entry service (card E). Pure orchestration over injected parts — no env, no file I/O, no logging:
//   invites     createInviteTable (fork-auth.js)        testerId comes ONLY from here (server-config invite token), never from the body
//   challenges  createMemoryChallengeStore (fork-auth)   nonce · 2 min · single use
//   store       fork-ledger-store-contract adapter       entries / topups / evidence / stamps / rewards, putIfAbsent only (atomic SET NX in production)
//   admin       createForkAdminClient (fork-grant-client) the CURRENT fork instance + idempotent top-up (127.0.0.1 only, token from env)
//   testnetRpc  (method, params) => result               the server's OWN read of chain 10143 (Journey 1 evidence; nothing trusted from the app)
//   forkRpc     (method, params) => result               the server's OWN read of the fork (completion evidence placeholder)
// Order (A-952 "Order card E calls"): entry check → top-up grant → [step evidence → verdict → stamp → reward] (completion = slot + tests only,
// closed unless config.completionOpen === true and a server-config rewardCampaignVersion exists; no payout anywhere).
import { appOriginOk, verifyChallenge, issueChallengeAsync, createRedisChallengeStore } from "./fork-auth.js"; // [A-960] async issue (Redis challenge store)
import { createUpstashRest, readUpstashEnv } from "./grant-redis-store.js"; // [A-960]
import { createUpstashInviteStore } from "./invite-redis-store.js"; // [A-960]
import { createUpstashForkLedgerStore } from "./fork-ledger-redis-store.js"; // [A-960]
import {
  ENTRY_ASSETS, FORK_LEDGER_SCHEMA, VERDICT, entryKey, entryPiggyKey, entryPiggyRecord, entryRecord, evidenceRecord, journey1UseRecord, journeyVerdict, rewardLedgerApply, stampRecord, topupRecord,
} from "./fork-ledger-contract.js";
import { isForkGrantAsset } from "./fork-grant-client.js";

// Journey 1 = the First Journey on Monad testnet: shMON deposit(assets, receiver) → redeem(shares, receiver, owner), both sent by the Piggy.
export const JOURNEY1 = Object.freeze({
  chainId: 10143,
  target: "0x282bddff5e58793acab65438b257dbd15a8745c9", // = main.js SHMON_ADDRESS (the First Journey's one canonical contract), lower-case
  depositSelector: "0x6e553f65", // deposit(uint256,address)
  redeemSelector: "0xba087652", // redeem(uint256,address,address)
});
export const FORK_SCOPE = "monad-fork";
const HASH_RE = /^0x[0-9a-f]{64}$/;
const ADDR_RE = /^0x[0-9a-f]{40}$/;
const ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const low = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const hexNum = (v) => { try { return typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) ? BigInt(v) : null; } catch { return null; } };
const word = (input, k) => (typeof input === "string" ? input.slice(10 + 64 * k, 10 + 64 * (k + 1)) : "");
const wordAddr = (input, k) => { const w = low(word(input, k)); return w.length === 64 && /^0{24}[0-9a-f]{40}$/.test(w) ? `0x${w.slice(24)}` : null; };

/** JSON-RPC caller over fetch (server side). Errors are thrown as plain codes; the URL never appears in them. */
export function jsonRpc({ url, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  let id = 0;
  return async (method, params = []) => {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), redirect: "error", ...(ctl ? { signal: ctl.signal } : {}) });
      const j = await res.json();
      if (j && Object.prototype.hasOwnProperty.call(j, "error") && j.error) throw new Error("rpc_error");
      return j ? j.result : null;
    } catch { throw new Error("rpc_unavailable"); } finally { if (t) clearTimeout(t); }
  };
}

/**
 * verifyJourney1 — the server reads chain 10143 itself. The request only POINTS at two tx hashes; every judged value is read here:
 * chain id 10143 (eth_chainId and the tx's own chainId) · both txs from == piggy, to == the shMON target · status 0x1 · deposit calldata =
 * deposit(·, receiver = piggy) · redeem calldata = redeem(·, receiver = piggy, owner = piggy) · deposit mined at or before redeem.
 * -> { ok, depositTxHash, redeemTxHash, blockNumber } | { ok:false, reason }
 */
export async function verifyJourney1({ rpc, piggyAddress, depositTxHash, redeemTxHash }) {
  const piggy = low(piggyAddress);
  const dep = low(depositTxHash); const red = low(redeemTxHash);
  if (!ADDR_RE.test(piggy)) return { ok: false, reason: "bad_piggy" };
  if (!HASH_RE.test(dep) || !HASH_RE.test(red) || dep === red) return { ok: false, reason: "journey1_pointer_invalid" };
  if (typeof rpc !== "function") return { ok: false, reason: "journey1_rpc_missing" };
  try {
    const cid = hexNum(await rpc("eth_chainId", []));
    if (cid !== BigInt(JOURNEY1.chainId)) return { ok: false, reason: "journey1_wrong_chain" };
    const read = async (hash, selector) => {
      const [tx, rc] = await Promise.all([rpc("eth_getTransactionByHash", [hash]), rpc("eth_getTransactionReceipt", [hash])]);
      if (!tx || !rc) return { ok: false, reason: "journey1_tx_not_found" };
      if (low(tx.hash) !== hash || low(rc.transactionHash) !== hash) return { ok: false, reason: "journey1_tx_mismatch" };
      if (tx.chainId !== undefined && tx.chainId !== null && hexNum(tx.chainId) !== BigInt(JOURNEY1.chainId)) return { ok: false, reason: "journey1_wrong_chain" };
      if (low(tx.from) !== piggy || low(rc.from) !== piggy) return { ok: false, reason: "journey1_not_from_piggy" };
      if (low(tx.to) !== JOURNEY1.target || low(rc.to) !== JOURNEY1.target) return { ok: false, reason: "journey1_wrong_target" };
      if (low(rc.status) !== "0x1") return { ok: false, reason: "journey1_tx_failed" };
      if (low(tx.input).slice(0, 10) !== selector) return { ok: false, reason: "journey1_wrong_shape" };
      const block = hexNum(rc.blockNumber);
      if (block === null) return { ok: false, reason: "journey1_tx_not_found" };
      return { ok: true, tx, block };
    };
    const d = await read(dep, JOURNEY1.depositSelector); if (!d.ok) return d;
    const r = await read(red, JOURNEY1.redeemSelector); if (!r.ok) return r;
    if (wordAddr(d.tx.input, 1) !== piggy) return { ok: false, reason: "journey1_wrong_shape" };
    if (wordAddr(r.tx.input, 1) !== piggy || wordAddr(r.tx.input, 2) !== piggy) return { ok: false, reason: "journey1_wrong_shape" };
    if (d.block > r.block) return { ok: false, reason: "journey1_wrong_order" };
    return { ok: true, depositTxHash: dep, redeemTxHash: red, blockNumber: r.block.toString() };
  } catch {
    return { ok: false, reason: "journey1_rpc_unavailable" };
  }
}

/**
 * createForkEntryService(parts) -> { challenge, enter, status, complete }. Every method returns a plain object, never throws.
 * config: { invites, appOrigin, grantVersion, grantAssets?, entryNotAfter?, completionOpen?, rewardCampaignVersion?, journeys? }
 *   appOrigin = the app origin the challenge names in its `uri:` line (server config; required)
 *   journeys = server registry { [journeyId]: { journeyVersion, steps: [{ stepId, to, selector }] } } (completion slot only)
 */
export function createForkEntryService({ config, store, challenges, admin, testnetRpc, forkRpc = null, now = () => Date.now() }) {
  // pre-A-959: const assets = Array.isArray(config?.grantAssets) && config.grantAssets.length ? config.grantAssets.filter((a) => ENTRY_ASSETS.includes(a)) : [...ENTRY_ASSETS];
  // [A-959] entry grant list = every asset that is BOTH a row of the fork profile asset table (fork-grant-client, A-955 table) AND an asset
  // the ledger can key (fork-ledger-contract ENTRY_ASSETS — the top-up row key forkInstanceId|piggy|asset|grantVersion). Each one goes
  // through the same topupOnce below (store row + in-process single flight + Admin ledger key), so repeat / 2 concurrent = 1 per asset.
  // Order = ENTRY_ASSETS order. WETH / AUSD join here as soon as ENTRY_ASSETS lists them (fork-ledger-contract.js — outside A-959's files).
  const grantable = (a) => ENTRY_ASSETS.includes(a) && isForkGrantAsset(a);
  const assets = Array.isArray(config?.grantAssets) && config.grantAssets.length ? config.grantAssets.filter(grantable) : ENTRY_ASSETS.filter(grantable);
  const grantVersion = typeof config?.grantVersion === "string" && /^[a-z0-9][a-z0-9._-]{0,31}$/.test(config.grantVersion) ? config.grantVersion : null;
  const tester = (token) => (config?.invites && typeof config.invites.testerFor === "function" ? config.invites.testerFor(token) : null);
  const expired = () => typeof config?.entryNotAfter === "number" && now() > config.entryNotAfter;
  const refuse = (reason, extra = {}) => ({ ok: true, allowed: false, reason, ...extra });
  const ready = () => !!(store && challenges && admin && grantVersion && appOriginOk(config?.appOrigin));
  const inflight = new Map(); // single flight per top-up key inside this process (the Admin is the cross-process guard)

  // [A-956 review fix 1] the stored entry counts only when the Piggy row of the same instance names the same tester (the Piggy row is the
  // lock written first; an entry row without its matching Piggy row — e.g. a lost race — is not an entry).
  async function enteredRow(forkInstanceId, testerId, piggy) {
    const k = entryKey({ forkInstanceId, testerId }); if (!k.ok) return { ok: false, reason: "no_entry" };
    const row = await store.get("entries", k.key);
    if (!row) return { ok: false, reason: "no_entry" };
    if (row.piggyAddress !== piggy) return { ok: false, reason: "piggy_mismatch" };
    const pk = entryPiggyKey({ forkInstanceId, piggyAddress: piggy });
    const lock = pk.ok ? await store.get("entryPiggies", pk.key) : null;
    if (!lock || lock.testerId !== testerId) return { ok: false, reason: "piggy_already_entered" };
    return { ok: true, row };
  }

  async function currentInstance() {
    const inst = await admin.instance();
    return inst && inst.ok ? inst : null;
  }

  async function topupOnce({ forkInstanceId, piggyAddress, asset, testerId }) {
    const rec0 = topupRecord({ forkInstanceId, piggyAddress, asset, grantVersion, testerId, amountRaw: "1" });
    if (!rec0.ok) return { ok: false, reason: "topup_key_invalid" };
    const prior = await store.get("topups", rec0.key);
    if (prior) return { ok: true, asset, amountRaw: prior.amountRaw, noop: true };
    if (inflight.has(rec0.key)) { const r = await inflight.get(rec0.key); return r.ok ? { ...r, noop: true } : r; }
    const run = (async () => {
      const t = await admin.topup({ piggyAddress, asset, grantVersion });
      if (!t || !t.ok) return { ok: false, reason: "topup_failed" };
      if (t.forkInstanceId !== forkInstanceId) return { ok: false, reason: "fork_instance_changed" };
      const rec = topupRecord({ forkInstanceId, piggyAddress, asset, grantVersion, testerId, amountRaw: t.amountRaw });
      if (!rec.ok) return { ok: false, reason: "topup_bad_answer" };
      const put = await store.putIfAbsent("topups", rec.key, rec.record);
      if (!put.ok && put.reason !== "exists") return { ok: false, reason: "store_failed" };
      return { ok: true, asset, amountRaw: t.amountRaw, noop: t.noop === true };
    })();
    inflight.set(rec0.key, run);
    try { return await run; } finally { inflight.delete(rec0.key); }
  }

  return Object.freeze({
    /** 1) challenge for (tester from the invite token, Piggy, the CURRENT fork instance). */
    async challenge({ inviteToken, piggyAddress }) {
      try {
        if (!ready()) return { ok: false, status: 503, reason: "entry_unavailable" };
        const testerId = await tester(inviteToken); if (!testerId) return { ok: false, status: 401, reason: "not_invited" };
        if (expired()) return refuse("entry_expired");
        const inst = await currentInstance(); if (!inst) return { ok: false, status: 503, reason: "fork_unavailable" };
        const c = await issueChallengeAsync({ store: challenges, uri: config.appOrigin, chainId: inst.chainId, testerId, piggyAddress, forkInstanceId: inst.forkInstanceId, now: now() });
        if (!c.ok) return { ok: false, status: 400, reason: c.reason };
        return { ok: true, nonce: c.nonce, message: c.message, expiresAt: c.expiresAt };
      } catch { return { ok: false, status: 503, reason: "entry_unavailable" }; }
    },

    /** 2)+3) proof → Journey 1 read on 10143 → entry row (putIfAbsent) → each grant asset (see `assets`) topped up once → allowed + forkInstanceId. */
    async enter({ inviteToken, nonce, signature, piggyAddress, journey1 }) {
      try {
        if (!ready()) return { ok: false, status: 503, reason: "entry_unavailable" };
        const testerId = await tester(inviteToken); if (!testerId) return { ok: false, status: 401, reason: "not_invited" };
        const proof = await verifyChallenge({ store: challenges, nonce, signature, testerId, piggyAddress, now: now() });
        if (!proof.ok) return refuse(proof.reason);
        if (expired()) return refuse("entry_expired");
        const piggy = proof.record.piggyAddress;
        const inst = await currentInstance(); if (!inst) return { ok: false, status: 503, reason: "fork_unavailable" };
        if (inst.forkInstanceId !== proof.record.forkInstanceId) return refuse("fork_instance_changed", { reenter: true });
        // [A-960] [review fix: after the fork-instance check, so a refused stale-instance request binds nothing] Redis invites (bind present): the invite is bound once to the first Piggy that proves control (보충 7) — here, or earlier
        // at the first grant. Bound to another Piggy / this Piggy bound to another tester / expired-unbound = no entry. Memory table = no bind.
        if (typeof config?.invites?.bind === "function") {
          const b = await config.invites.bind({ token: inviteToken, piggyAddress: piggy });
          if (!b || b.ok !== true) return refuse(b?.status || "invite_not_bound");
        }
        const j = journey1 && typeof journey1 === "object" ? journey1 : {};
        const j1 = await verifyJourney1({ rpc: testnetRpc, piggyAddress: piggy, depositTxHash: j.depositTxHash, redeemTxHash: j.redeemTxHash });
        if (!j1.ok) return refuse(j1.reason);
        const er = entryRecord({ forkInstanceId: inst.forkInstanceId, testerId, piggyAddress: piggy, journey1DepositTxHash: j1.depositTxHash, journey1RedeemTxHash: j1.redeemTxHash, journey1BlockNumber: j1.blockNumber });
        if (!er.ok) return refuse("entry_invalid");
        // [A-956 review fix 1] claim order (each = one SET NX): Journey 1 tx rows (one tester per tx, any instance) → the Piggy row
        // (one tester per Piggy per instance; the lock) → the entry row (one Piggy per tester per instance). A refusal at any step leaves
        // only rows that already belong to this tester + this Piggy (the signature proved control), so nothing is granted to anyone else.
        for (const txHash of [j1.depositTxHash, j1.redeemTxHash]) {
          const u = journey1UseRecord({ txHash, testerId, piggyAddress: piggy });
          if (!u.ok) return refuse("entry_invalid");
          const pu = await store.putIfAbsent("journey1Uses", u.key, u.record);
          if (!pu.ok && pu.reason !== "exists") return { ok: false, status: 503, reason: "store_failed" };
          if (!pu.ok && (pu.existing.testerId !== testerId || pu.existing.piggyAddress !== piggy)) return refuse("journey1_already_used");
        }
        const pr = entryPiggyRecord({ forkInstanceId: inst.forkInstanceId, piggyAddress: piggy, testerId });
        if (!pr.ok) return refuse("entry_invalid");
        const pp = await store.putIfAbsent("entryPiggies", pr.key, pr.record);
        if (!pp.ok && pp.reason !== "exists") return { ok: false, status: 503, reason: "store_failed" };
        if (!pp.ok && pp.existing.testerId !== testerId) return refuse("piggy_already_entered");
        const put = await store.putIfAbsent("entries", er.key, er.record);
        if (!put.ok && put.reason !== "exists") return { ok: false, status: 503, reason: "store_failed" };
        if (!put.ok && put.existing && put.existing.piggyAddress !== piggy) return refuse("tester_bound_to_other_piggy");
        const grants = [];
        for (const asset of assets) {
          const g = await topupOnce({ forkInstanceId: inst.forkInstanceId, piggyAddress: piggy, asset, testerId });
          if (!g.ok) return refuse(g.reason);
          grants.push({ asset, amountRaw: g.amountRaw, noop: g.noop });
        }
        return { ok: true, allowed: true, forkScope: FORK_SCOPE, forkInstanceId: inst.forkInstanceId, grants };
      } catch { return { ok: false, status: 503, reason: "entry_unavailable" }; }
    },

    /** 6) re-check before any fork money action: no cached verdict — current instance + stored entry for this tester + same Piggy. */
    async status({ inviteToken, piggyAddress, forkInstanceId }) {
      try {
        if (!ready()) return { ok: false, status: 503, reason: "entry_unavailable" };
        const testerId = await tester(inviteToken); if (!testerId) return { ok: false, status: 401, reason: "not_invited" };
        const piggy = low(piggyAddress); if (!ADDR_RE.test(piggy)) return refuse("bad_piggy");
        const inst = await currentInstance(); if (!inst) return { ok: false, status: 503, reason: "fork_unavailable" };
        if (low(forkInstanceId) !== inst.forkInstanceId) return refuse("fork_instance_changed", { reenter: true });
        if (expired()) return refuse("entry_expired");
        const e = await enteredRow(inst.forkInstanceId, testerId, piggy);
        if (!e.ok) return refuse(e.reason, e.reason === "no_entry" ? { reenter: true } : {});
        return { ok: true, allowed: true, forkScope: FORK_SCOPE, forkInstanceId: inst.forkInstanceId };
      } catch { return { ok: false, status: 503, reason: "entry_unavailable" }; }
    },

    /**
     * 7) completion SLOT (closed by default): step evidence read by the server from the fork RPC → putIfAbsent("evidence") → journeyVerdict
     * over the stored rows with the current context → on COMPLETE: stamp (putIfAbsent "stamps") + reward via rewardLedgerApply's record
     * (putIfAbsent "rewards"), all in this one request. testerId = auth · campaign = config · steps/version = server registry. No payout.
     */
    async complete({ inviteToken, piggyAddress, journeyId, txHashes }) {
      try {
        if (config?.completionOpen !== true || typeof config?.rewardCampaignVersion !== "string") return { ok: false, status: 404, reason: "completion_not_open" };
        if (!ready() || typeof forkRpc !== "function") return { ok: false, status: 503, reason: "entry_unavailable" };
        const testerId = await tester(inviteToken); if (!testerId) return { ok: false, status: 401, reason: "not_invited" };
        const piggy = low(piggyAddress); if (!ADDR_RE.test(piggy)) return refuse("bad_piggy");
        const jid = low(journeyId);
        const reg = ID_RE.test(jid) && config.journeys && Object.prototype.hasOwnProperty.call(config.journeys, jid) ? config.journeys[jid] : null;
        if (!reg) return refuse("unknown_journey");
        const inst = await currentInstance(); if (!inst) return { ok: false, status: 503, reason: "fork_unavailable" };
        const e = await enteredRow(inst.forkInstanceId, testerId, piggy);
        if (!e.ok) return refuse("no_entry");
        const hashes = Array.isArray(txHashes) ? [...new Set(txHashes.map(low))] : [];
        if (hashes.length === 0 || hashes.length > 32 || hashes.some((h) => !HASH_RE.test(h))) return refuse("bad_evidence_pointer");
        for (const h of hashes) {
          const [tx, rc] = await Promise.all([forkRpc("eth_getTransactionByHash", [h]), forkRpc("eth_getTransactionReceipt", [h])]);
          if (!tx || !rc || low(tx.hash) !== h || low(rc.transactionHash) !== h) return refuse("evidence_not_found");
          if (low(tx.from) !== piggy || low(rc.from) !== piggy) return refuse("evidence_not_from_piggy");
          const step = reg.steps.find((s) => low(s.to) === low(tx.to) && low(s.selector) === low(tx.input).slice(0, 10));
          if (!step) return refuse("evidence_not_a_step");
          const ev = evidenceRecord({ forkInstanceId: inst.forkInstanceId, chainId: inst.chainId, piggyAddress: piggy, txHash: h, blockNumber: rc.blockNumber, status: low(rc.status) === "0x1" ? "success" : "failed", journeyId: jid, journeyVersion: reg.journeyVersion, stepId: step.stepId, blockHash: rc.blockHash ?? null }); // [A-993] + blockHash (receipt's; not in the key)
          if (!ev.ok) return refuse(ev.reason === "tx_not_success" ? "evidence_tx_failed" : "evidence_invalid");
          const put = await store.putIfAbsent("evidence", ev.key, ev.record);
          if (!put.ok && put.reason !== "exists") return { ok: false, status: 503, reason: "store_failed" };
          if (!put.ok && (put.existing.journeyId !== ev.record.journeyId || put.existing.journeyVersion !== ev.record.journeyVersion || put.existing.stepId !== ev.record.stepId)) return refuse("evidence_reused");
        }
        const rows = (await store.list("evidence")).filter((r) => r.forkInstanceId === inst.forkInstanceId && r.piggyAddress === piggy);
        const orphaned = (await store.list("orphans")).filter((o) => o.forkInstanceId === inst.forkInstanceId && o.piggyAddress === piggy); // [A-993] restore-lost steps: skipped
        const verdict = journeyVerdict({ journeyId: jid, journeyVersion: reg.journeyVersion, steps: reg.steps.map((s) => s.stepId), evidence: rows, orphaned, context: { forkInstanceId: inst.forkInstanceId, chainId: inst.chainId, piggyAddress: piggy, forkStartBlock: inst.forkStartBlock, testerId } });
        if (verdict.verdict !== VERDICT.COMPLETE) return { ok: true, allowed: true, verdict: verdict.verdict, missing: [...verdict.missing], reason: verdict.reason };
        const st = stampRecord({ testerId, forkInstanceId: inst.forkInstanceId, journeyId: jid });
        if (st.ok) await store.putIfAbsent("stamps", st.key, st.record);
        const entries = {};
        for (const r of await store.list("rewards")) entries[r.key] = r;
        const applied = rewardLedgerApply(Object.freeze({ schema: FORK_LEDGER_SCHEMA, entries: Object.freeze(entries) }), { testerId, rewardCampaignVersion: config.rewardCampaignVersion, verdict });
        if (!applied.ok) return { ok: true, allowed: true, verdict: verdict.verdict, rewarded: false, reason: applied.reason };
        const put = await store.putIfAbsent("rewards", applied.key, applied.record); // ONLY the record rewardLedgerApply returned
        return { ok: true, allowed: true, verdict: verdict.verdict, rewarded: put.ok === true, reason: put.ok ? null : "duplicate_reward", payout: "none" };
      } catch { return { ok: false, status: 503, reason: "entry_unavailable" }; }
    },
  });
}

/** [A-960] Upstash parts for a hosted entry route: { invites, challenges, store } over one Upstash (same env pairs as /api/grant), or null
 *  (fail-closed). The route file (api/fork-entry.js) is outside A-960; it keeps its local memory parts until a card wires this in. */
export function upstashForkEntryParts(env = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const cfg = readUpstashEnv(env);
  const cmd = cfg ? createUpstashRest({ url: cfg.url, token: cfg.token, fetchImpl }) : null;
  if (!cmd) return null;
  const invites = createUpstashInviteStore({ cmd });
  const challenges = createRedisChallengeStore({ cmd });
  const store = createUpstashForkLedgerStore({ cmd });
  return invites && challenges && store ? { invites, challenges, store } : null;
}
