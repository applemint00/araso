// [A-869] Offline reconcile helper for the Gift gas ledger. NO network, NO keys.
//  - default = read-only report (nothing written);
//  - --apply may only APPEND audit records (NOTE / VOID_REVIEWED / CHAIN_CHECKED). It never changes an entry's
//    state, never deletes, never signs, never broadcasts. VOID is a recorded human decision, not a deletion.
//  - opens the ledger through the writer lock, so it refuses to run while the service holds the ledger.
//  - output never contains rawTx (only its length and whether keccak256(rawTx) == txHash).
// usage: node relayer/tools/gift-gas-reconcile.mjs --ledger <path> [--apply --giftId 0x.. --action NOTE --note "text"]
//
// [A-913 E] --sponsor mode = the Gift SPONSOR ledger (relayer/src/gift-sponsor-*.mjs), chain-truth reconcile. Same code the Vercel Cron route runs.
//   node relayer/tools/gift-gas-reconcile.mjs --sponsor                 -> PLAN: read-only RPC reads, prints the next step per owed giftId (README table row). No tx, no key needed
//                                                                          (sponsor address from GIFT_SPONSOR_PRIVATE_KEY if set - never printed - or --sponsor-address 0x..)
//   node relayer/tools/gift-gas-reconcile.mjs --sponsor --apply         -> EXECUTE the same next steps through the guarded steps (needs GIFT_SPONSOR_PRIVATE_KEY; value-0 sponsor txs only)
//   env: the sponsor env of api/_lib/gift-sponsor-runtime.js (MONAD_RPC_URL, GIFT_SPONSOR_ESCROW_ADDRESS, GIFT_SPONSOR_GAS_UNITS, GIFT_SPONSOR_GAS_BUFFER_BPS, GIFT_SPONSOR_LEASE_SECONDS)
//        + the store: KV_REST_API_URL/KV_REST_API_TOKEN (production ledger) or GIFT_SPONSOR_LEDGER_DIR (local file ledger, single-writer lock).
//   --apply takes the same sponsor lease as live requests, so it cannot interleave with a claim in flight (busy => nothing done).

import { pathToFileURL } from "node:url";
import { keccak256 } from "viem";
import { openGiftGasLedger } from "../src/gift-gas-ledger.mjs";
import { createPublicClient, defineChain, http as viemHttp } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildGiftSponsorRuntime, readGiftSponsorEnv } from "../../api/_lib/gift-sponsor-runtime.js";
import { RECONCILE_TABLE } from "../src/gift-sponsor-reconcile.mjs";

const PLAN_ONLY_DUMMY_KEY = `0x${"0".repeat(63)}1`; // never used to sign: plan mode only reads; the real account is passed separately

/** Sponsor reconcile. mode "plan" (default) = read-only; "apply" = execute next steps. Returns the report object. */
export async function sponsorReconcile({ env = process.env, apply = false, sponsorAddress = null, deps = {} } = {}) {
  const key = env.GIFT_SPONSOR_PRIVATE_KEY || null;
  if (apply && !key) throw new Error("MISSING_GIFT_SPONSOR_PRIVATE_KEY");
  const cfg = readGiftSponsorEnv({ ...env, GIFT_SPONSOR_PRIVATE_KEY: key ?? PLAN_ONLY_DUMMY_KEY });
  const account = key ? privateKeyToAccount(key) : (sponsorAddress ? { address: sponsorAddress, type: "json-rpc" } : null);
  if (!account) throw new Error("MISSING_SPONSOR_ADDRESS");
  const chainDef = defineChain({ id: 143, name: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } });
  const transport = viemHttp(cfg.rpcUrl);
  const publicClient = deps.publicClient ?? createPublicClient({ chain: chainDef, transport });
  const rt = buildGiftSponsorRuntime(cfg, { publicClient, account, log: () => {}, ...(deps.store ? { store: deps.store } : {}) });
  try {
    if (!apply) return { mode: "plan", table: RECONCILE_TABLE.map((r) => r.row), plan: await rt.reconciler.plan() };
    const pre = await rt.preflight();
    if (!pre) return { mode: "apply", error: "preflight_failed", remaining: (await rt.store.list()).length };
    return { mode: "apply", ...(await rt.reconciler.run()) };
  } finally { rt.store.close?.(); }
}


const TOOL_ACTIONS = new Set(["NOTE", "VOID_REVIEWED", "CHAIN_CHECKED"]);
const GUIDE = {
  PENDING: "reserved, NOTHING signed: confirm on chain the relayer nonce is unused and no transfer to `to` exists, then record VOID_REVIEWED. Do not delete.",
  SENT: "rawTx durable: server recover() re-broadcasts the SAME bytes. Compare txHash on chain; never sign again at this nonce.",
  UNKNOWN: "human decision: compare nonce / txHash / transfers on chain, then record CHAIN_CHECKED; service.resolveUnknown() may move it to CONFIRMED if the receipt verifies.",
  CONFIRMED: "none",
};

export function reconcileLedger(path, { apply = null, io } = {}) {
  const ledger = openGiftGasLedger(path, { noCreate: true, ...(io ? { io } : {}) });
  try {
    const entries = ledger.list();
    const report = entries.map((e) => ({
      giftId: e.giftId, state: e.state, to: e.to, valueWei: e.valueWei, nonce: e.nonce, txHash: e.txHash, reason: e.reason,
      rawTxBytes: e.rawTx ? (e.rawTx.length - 2) / 2 : 0,
      rawTxHashMatches: e.rawTx ? keccak256(e.rawTx) === e.txHash : null,
      next: GUIDE[e.state],
    }));
    let appended = 0;
    if (apply) {
      const stateOf = () => JSON.stringify(ledger.list());
      const before = stateOf();
      for (const a of apply) {
        if (!TOOL_ACTIONS.has(a.action)) throw new Error("RECONCILE_BAD_ACTION");
        ledger.appendAudit(a.giftId ?? null, a.action, a.note ?? ""); appended += 1;
      }
      if (stateOf() !== before) throw new Error("RECONCILE_INVARIANT: entries changed"); // cannot happen; belt and braces
    }
    return { entries: report, counts: entries.reduce((m, e) => ({ ...m, [e.state]: (m[e.state] ?? 0) + 1 }), {}), auditAppended: appended, auditTotal: ledger.auditTrail().length };
  } finally {
    ledger.close();
  }
}

async function mainSponsor(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) { if (argv[i] === "--apply" || argv[i] === "--sponsor") a[argv[i].slice(2)] = true; else if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[++i]; }
  try { console.log(JSON.stringify(await sponsorReconcile({ apply: a.apply === true, sponsorAddress: a["sponsor-address"] ?? null }), (k, v) => (typeof v === "bigint" ? v.toString() : v), 2)); }
  catch (e) { console.error(String(e.message).split("\n")[0]); process.exit(1); }
}

function main(argv) {
  if (argv.includes("--sponsor")) return mainSponsor(argv);
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") a.apply = true;
    else if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[++i];
  }
  if (!a.ledger) { console.error("usage: --ledger <path> [--apply --giftId 0x.. --action NOTE|VOID_REVIEWED|CHAIN_CHECKED --note text]"); process.exit(2); }
  const apply = a.apply ? [{ giftId: a.giftId ?? null, action: a.action, note: a.note ?? "" }] : null;
  try { console.log(JSON.stringify(reconcileLedger(a.ledger, { apply }), null, 2)); }
  catch (e) { console.error(String(e.message).split("\n")[0]); process.exit(1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
