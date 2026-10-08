// [A-646 phase A] Money placement MODEL (non-visible logic only).
//   node app/test/a646-money-placement-model.mjs
//
// Covers A-645 NEXT_APP_INPUT: T3 (remembered-split store part), T4 (plan hash / approval),
// T5 (registry-only destinations at model level), T6 (per-leg partial success), amount<->percent
// consistency, T10 (no `cash` special case in app/src), plus a static check that the model functions
// touch no WebAuthn / tx / signer / network / storage-global.
// Network 0 · browser 0 · tx 0. The "rail" below is a TEST-ONLY in-memory adapter defined in this
// file; it never exists in app/src and so cannot reach the product bundle.
// On the pre-A-646 tree the model exports do not exist → every group fails → exit 1.
// pre-A-911 baseline: the A-646 allocation model pinned here is unchanged. The split is drawn on the own screen as amounts only (no % column, Owner answer 5); the percent maths stays in the model.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as AM from "../src/add-money.js";
import * as FE from "../src/funding-entry.js";
import * as BR from "../src/funding-intent-bridge.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, "../src");

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error("returned false");
    console.log(`PASS  ${label}`);
    pass += 1;
  } catch (e) {
    console.log(`FAIL  ${label} — ${e?.message || e}`);
    fail += 1;
  }
}
function eq(a, b, msg = "") {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg} expected ${sb} got ${sa}`);
}
function truthy(v, msg = "") {
  if (!v) throw new Error(msg || "expected truthy");
}

const SCOPE = { chainId: "10143", accountId: "acct_1" };
const ASSET = { symbol: "USDC", decimals: 6 };
const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const A3 = "0x3333333333333333333333333333333333333333";
const EVIL = "0x9999999999999999999999999999999999999999";
const PIGGIES = [
  { id: "p_honey", name: "Honeybun", address: A1 },
  { id: "p_mochi", name: "Mochi", address: A2 },
  { id: "p_tofu", name: "Tofu", address: A3 },
];
const TOTAL = "1000000000"; // 1000 USDC in minor units

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}
let seq = 0;
function fixedRandom(bytes) { seq += 1; for (let i = 0; i < bytes.length; i += 1) bytes[i] = (seq * 31 + i) & 0xff; }
function plan(rows, { piggies = PIGGIES, total = TOTAL, asset = ASSET, scope = SCOPE, planId } = {}) {
  return AM.buildAllocationPlan({
    planId: planId || AM.newPlanId({ randomBytes: fixedRandom }),
    chainId: scope.chainId, accountId: scope.accountId, asset, total, rows, piggies,
  });
}
const ROWS3 = [
  { piggyId: "p_honey", amount: "500000000" },
  { piggyId: "p_mochi", amount: "300000000" },
  { piggyId: "p_tofu", amount: "200000000" },
];

// ── 0. Exports exist (pre-A-646 → all FAIL) ───────────────────────────────────────────────
const EXPECTED = {
  AM: ["percentBpsFromAmount", "amountFromPercentBps", "allocationSum", "newPlanId", "canonicalPlanJson", "computePlanHash",
    "buildAllocationPlan", "approvalForPlan", "checkPlanApproval", "lastSplitKey", "ratiosFromPlan", "saveLastSplit",
    "loadLastSplit", "prefillFromLastSplit"],
  FE: ["planLegIntent", "expandPlanToLegIntents"],
  BR: ["derivePlanState", "markPlanApproved", "nextLegToSend", "markLegPending", "applyLegResult", "planLegReceipts", "planProgress"],
};
check("model exports exist (add-money / funding-entry / funding-intent-bridge)", () => {
  const missing = [];
  for (const n of EXPECTED.AM) if (typeof AM[n] !== "function") missing.push(`add-money.${n}`);
  for (const n of EXPECTED.FE) if (typeof FE[n] !== "function") missing.push(`funding-entry.${n}`);
  for (const n of EXPECTED.BR) if (typeof BR[n] !== "function") missing.push(`funding-intent-bridge.${n}`);
  if (missing.length) throw new Error(`missing: ${missing.join(", ")}`);
});

// ── 1. Amount <-> percent (pure) ────────────────────────────────────────────────────────
check("M1 amount→percent: 500/1000 = 5000 bps, 0 = 0, total = 10000", () => {
  eq(AM.percentBpsFromAmount("500000000", TOTAL), 5000);
  eq(AM.percentBpsFromAmount("0", TOTAL), 0);
  eq(AM.percentBpsFromAmount(TOTAL, TOTAL), 10000);
  eq(AM.percentBpsFromAmount("1", "0"), null, "total 0");
  eq(AM.percentBpsFromAmount("2000000000", TOTAL), null, "amount > total");
  eq(AM.percentBpsFromAmount("1.5", TOTAL), null, "non-integer units");
});
check("M2 percent→amount: 100% = total exactly, 0% = 0, floor otherwise (no silent remainder)", () => {
  eq(AM.amountFromPercentBps(10000, "999999999"), "999999999");
  eq(AM.amountFromPercentBps(0, TOTAL), "0");
  eq(AM.amountFromPercentBps(3333, "100"), "33");
  eq(AM.amountFromPercentBps(10001, TOTAL), null);
  eq(AM.amountFromPercentBps(12.5, TOTAL), null);
});
check("M3 consistency both ways: percent→amount→percent round-trips for every bps (totals ≥ 20000 units)", () => {
  for (const T of ["20001", "1000000", "123456789", TOTAL, "999999999999999999999"]) {
    for (let bps = 0; bps <= 10000; bps += 7) {
      const a = AM.amountFromPercentBps(bps, T);
      const back = AM.percentBpsFromAmount(a, T);
      if (back !== bps) throw new Error(`T=${T} bps=${bps} → ${a} → ${back}`);
    }
  }
});
check("M4 consistency both ways: amount→percent is within ½ bps of the exact ratio (display only)", () => {
  const T = 777777777n;
  for (const a of [0n, 1n, 12345n, 388888888n, 777777776n, T]) {
    const bps = AM.percentBpsFromAmount(a.toString(), T.toString());
    const exact2 = a * 20000n; // 2 * a * 10000
    const lo = (BigInt(bps) * 2n - 1n) * T;
    const hi = (BigInt(bps) * 2n + 1n) * T;
    truthy(exact2 >= lo && exact2 <= hi, `a=${a} bps=${bps}`);
  }
});
check("M5 Σ≠total blocks the plan (sum_mismatch, no remainder dump); Σ=total balanced", () => {
  const s = AM.allocationSum([{ amount: "400000000" }, { amount: "500000000" }], TOTAL);
  eq([s.balanced, s.remainder, s.reason], [false, "100000000", "sum_mismatch"]);
  const over = AM.allocationSum([{ amount: "600000000" }, { amount: "500000000" }], TOTAL);
  eq([over.balanced, over.remainder], [false, "-100000000"]);
  eq(AM.allocationSum(ROWS3, TOTAL).balanced, true);
  const r = plan([{ piggyId: "p_honey", amount: "400000000" }, { piggyId: "p_mochi", amount: "500000000" }]);
  eq([r.ok, r.reason, r.plan, r.remainder], [false, "sum_mismatch", null, "100000000"]);
});
check("M6 100% to one Piggy = one leg; 0-amount legs dropped", () => {
  const r = plan([{ piggyId: "p_honey", amount: TOTAL }, { piggyId: "p_mochi", amount: "0" }, { piggyId: "p_tofu", amount: "0" }]);
  truthy(r.ok, r.reason);
  eq(r.plan.legs.map((l) => [l.piggyId, l.amount]), [["p_honey", TOTAL]]);
});

// ── T5. Destinations only from the registry by piggyId ───────────────────────────────────
check("T5a each leg target = registry address of that piggyId; preview carries the Piggy name", () => {
  const r = plan(ROWS3);
  truthy(r.ok, r.reason);
  eq(r.plan.legs.map((l) => [l.piggyId, l.name, l.target, l.amount]), [
    ["p_honey", "Honeybun", A1, "500000000"], ["p_mochi", "Mochi", A2, "300000000"], ["p_tofu", "Tofu", A3, "200000000"],
  ]);
});
check("T5b no address input: a row carrying address/target/destination/to/recipient is refused", () => {
  for (const k of ["address", "target", "destination", "to", "recipient"]) {
    const rows = ROWS3.map((r, i) => (i === 0 ? { ...r, [k]: EVIL } : r));
    const r = plan(rows);
    eq([r.ok, r.reason], [false, "address_input_forbidden"], k);
  }
  eq(plan([{ ...ROWS3[0], note: "x" }, ROWS3[1], ROWS3[2]]).reason, "unknown_row_field");
});
check("T5c unknown piggyId / Piggy without address / duplicate row → no plan", () => {
  eq(plan([{ piggyId: "p_ghost", amount: TOTAL }]).reason, "unknown_piggy");
  eq(plan([{ piggyId: "p_honey", amount: TOTAL }], { piggies: [{ id: "p_honey", name: "H", address: "" }] }).reason, "piggy_address_missing");
  eq(plan([{ piggyId: "p_honey", amount: "500000000" }, { piggyId: "p_honey", amount: "500000000" }]).reason, "duplicate_piggy");
});
check("T5d/S6 plan → N single-target startFunding intents (targetPiggyId + registry target), no router", () => {
  const { plan: p } = plan(ROWS3);
  const { approval } = AM.approvalForPlan(p);
  const rail = [{ method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, available: true, railId: "a646_test_only_rail" }];
  const intents = FE.expandPlanToLegIntents(p, { approval, method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, adapters: rail, assetChangeAcknowledged: true });
  eq(intents.length, 3);
  for (const [i, it] of intents.entries()) {
    truthy(it.ok, it.reason);
    eq([it.intent.targetPiggyId, it.intent.target], [p.legs[i].piggyId, PIGGIES.find((x) => x.id === p.legs[i].piggyId).address]);
    eq(it.idempotencyKey, `${p.planId}:${p.legs[i].piggyId}`);
    truthy(!("targets" in it.intent) && !("router" in it.intent) && !("legs" in it.intent), "single target only");
  }
  eq(intents.map((it) => it.intent.requestedAmount), ["500", "300", "200"]);
});
check("S6/S9 rails = 0 → every leg intent is truthfully unavailable; nothing to send", () => {
  const { plan: p } = plan(ROWS3);
  const { approval } = AM.approvalForPlan(p);
  const intents = FE.expandPlanToLegIntents(p, { approval, method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, assetChangeAcknowledged: true });
  eq(intents.map((it) => [it.ok, it.state]), [[false, "unavailable"], [false, "unavailable"], [false, "unavailable"]]);
  truthy(intents.every((it) => !it.intent), "no intent object");
});
check("S6 leg intents refuse without a matching approval, or a leg not in the plan", () => {
  const { plan: p } = plan(ROWS3);
  const rail = [{ method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, available: true, railId: "a646_test_only_rail" }];
  eq(FE.planLegIntent(p, p.legs[0], { method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, adapters: rail, assetChangeAcknowledged: true }).reason, "no_approval");
  const { approval } = AM.approvalForPlan(p);
  const forged = { ...p.legs[0], target: EVIL };
  eq(FE.planLegIntent(p, forged, { approval, method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, adapters: rail, assetChangeAcknowledged: true }).reason, "leg_not_in_plan");
});

// ── T4. planId / planHash ───────────────────────────────────────────────────────────
check("T4a planId unique per preview; format plan_<32hex>", () => {
  const ids = new Set(Array.from({ length: 50 }, () => AM.newPlanId()));
  eq(ids.size, 50);
  truthy([...ids].every((id) => /^plan_[0-9a-f]{32}$/.test(id)));
});
check("T4b planHash = sha256(canonical JSON {version,chainId,accountId,asset,total,legs sorted by piggyId})", () => {
  const { plan: p } = plan(ROWS3);
  const canon = AM.canonicalPlanJson(p);
  eq(Object.keys(JSON.parse(canon)), ["version", "chainId", "accountId", "asset", "total", "legs"]);
  eq(JSON.parse(canon).legs, [["p_honey", A1, "500000000"], ["p_mochi", A2, "300000000"], ["p_tofu", A3, "200000000"]]);
  eq(p.planHash, createHash("sha256").update(canon, "utf8").digest("hex"), "matches node:crypto");
});
check("T4c any change to amount / destination / asset / decimals / chain / account / total / version → new hash", () => {
  const { plan: p } = plan(ROWS3);
  const h0 = AM.computePlanHash(p);
  const variants = {
    amount: { ...p, legs: p.legs.map((l, i) => (i === 0 ? { ...l, amount: "500000001" } : l)) },
    destination: { ...p, legs: p.legs.map((l, i) => (i === 1 ? { ...l, target: EVIL } : l)) },
    swap_amounts_between_piggies: { ...p, legs: p.legs.map((l, i) => (i === 0 ? { ...l, amount: "300000000" } : i === 1 ? { ...l, amount: "500000000" } : l)) },
    swap_destinations: { ...p, legs: p.legs.map((l, i) => (i === 0 ? { ...l, target: A2 } : i === 1 ? { ...l, target: A1 } : l)) },
    asset: { ...p, asset: { symbol: "USDT", decimals: 6 } },
    decimals: { ...p, asset: { symbol: "USDC", decimals: 18 } },
    chain: { ...p, chainId: "143" },
    account: { ...p, accountId: "acct_2" },
    total: { ...p, total: "1000000001" },
    version: { ...p, version: 2 },
    extra_leg: { ...p, legs: [...p.legs, { piggyId: "p_zz", target: A1, amount: "1" }] },
  };
  for (const [k, v] of Object.entries(variants)) if (AM.computePlanHash(v) === h0) throw new Error(`no hash change: ${k}`);
});
check("T4d leg order: input row order does not matter (canonical), and execution order is the hashed order", () => {
  const a = plan(ROWS3, { planId: "plan_" + "a".repeat(32) }).plan;
  const b = plan([...ROWS3].reverse(), { planId: "plan_" + "b".repeat(32) }).plan;
  eq(a.planHash, b.planHash);
  eq(b.legs.map((l) => l.piggyId), ["p_honey", "p_mochi", "p_tofu"]);
  eq(AM.computePlanHash({ ...a, legs: [...a.legs].reverse() }), a.planHash, "hash sorts legs; order cannot be smuggled");
});
check("T4e approval binds planId + planHash; any mutation after approval → old approval rejected", () => {
  const { plan: p } = plan(ROWS3);
  const { approval } = AM.approvalForPlan(p);
  eq(AM.checkPlanApproval(p, approval), { ok: true, reason: null });
  const mutated = { ...p, legs: p.legs.map((l, i) => (i === 2 ? { ...l, target: EVIL } : l)) };
  eq(AM.checkPlanApproval(mutated, approval).ok, false);
  const reHashed = { ...mutated, planHash: AM.computePlanHash(mutated) }; // attacker recomputes the stored hash
  eq(AM.checkPlanApproval(reHashed, approval).reason, "plan_hash_mismatch");
  const other = plan(ROWS3).plan; // same content, new preview → new planId
  eq(other.planHash, p.planHash);
  eq(AM.checkPlanApproval(other, approval).reason, "plan_id_mismatch");
  eq(AM.checkPlanApproval(p, null).reason, "no_approval");
  const { plan: approved } = BR.markPlanApproved(p, approval);
  eq(BR.nextLegToSend(reHashed, approval).leg, null);
  eq(BR.markLegPending({ ...approved, legs: mutated.legs }, "p_honey", approval).ok, false);
});

// ── T3. Remembered split store (prefill only) ─────────────────────────────────────────
function approvedPlan(rows = ROWS3) {
  const { plan: p } = plan(rows);
  const { approval } = AM.approvalForPlan(p);
  return { p: BR.markPlanApproved(p, approval).plan, approval };
}
check("T3a key scoped chainId.accountId; first-time user → no prefill, no default", () => {
  eq(AM.lastSplitKey(SCOPE), "araso.lastSplit.10143.acct_1");
  eq(AM.lastSplitKey({ chainId: "", accountId: "x" }), null);
  eq(AM.loadLastSplit(memStorage(), SCOPE), { ratios: null, error: null });
});
check("T3b only an approved plan is remembered (draft / wrong approval → nothing written)", () => {
  const st = memStorage();
  const { plan: p } = plan(ROWS3);
  eq(AM.saveLastSplit(st, SCOPE, p, null).saved, false);
  eq(AM.saveLastSplit(st, SCOPE, p, { planId: p.planId, planHash: "0".repeat(64) }).saved, false);
  eq(AM.saveLastSplit(st, { ...SCOPE, accountId: "acct_2" }, p, AM.approvalForPlan(p).approval).error, "scope_mismatch");
  eq(st._map.size, 0);
});
check("T3c confirmed plan → next Add Money prefills the same ratios (data only; executes:false)", () => {
  const st = memStorage();
  const { p, approval } = approvedPlan();
  eq(AM.saveLastSplit(st, SCOPE, p, approval, { at: "2026-09-29T00:00:00Z" }), { saved: true, error: null });
  const { ratios, error } = AM.loadLastSplit(st, SCOPE);
  eq(error, null);
  eq(ratios, [{ piggyId: "p_honey", bps: 5000 }, { piggyId: "p_mochi", bps: 3000 }, { piggyId: "p_tofu", bps: 2000 }]);
  const pre = AM.prefillFromLastSplit(ratios, PIGGIES, "2000000000");
  eq(pre.executes, false);
  eq(pre.rows, [{ piggyId: "p_honey", amount: "1000000000" }, { piggyId: "p_mochi", amount: "600000000" }, { piggyId: "p_tofu", amount: "400000000" }]);
  eq(AM.allocationSum(pre.rows, "2000000000").balanced, true);
  truthy(!("intents" in pre) && !("approval" in pre) && !("planHash" in pre), "prefill carries no execution/approval");
  // Prefill still needs a fresh plan + fresh approval — the old approval is for a different plan.
  const next = plan(pre.rows, { total: "2000000000" }).plan;
  eq(AM.checkPlanApproval(next, approval).ok, false);
  eq(BR.nextLegToSend(next, approval).leg, null);
});
check("T3d record = closed, non-secret, no address / amount / permission field", () => {
  const st = memStorage();
  const { p, approval } = approvedPlan();
  AM.saveLastSplit(st, SCOPE, p, approval, { at: "2026-09-29T00:00:00Z" });
  const raw = st.getItem("araso.lastSplit.10143.acct_1");
  const rec = JSON.parse(raw);
  eq(Object.keys(rec).sort(), ["accountId", "chainId", "ratios", "updatedAt", "version"]);
  truthy(rec.ratios.every((r) => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(["bps", "piggyId"])));
  truthy(!/0x[0-9a-fA-F]{40}/.test(raw), "no address");
  truthy(!/"(amount|total|permission|approval|planHash|planId|auto\w*|secret|prf\w*)"/i.test(raw), "no amount/permission/secret");
});
check("T3e rounding: ratios always sum to exactly 10000; prefill of full set sums to total exactly", () => {
  const { p, approval } = approvedPlan([{ piggyId: "p_honey", amount: "333333334" }, { piggyId: "p_mochi", amount: "333333333" }, { piggyId: "p_tofu", amount: "333333333" }]);
  const r = AM.ratiosFromPlan(p);
  eq(r.reduce((s, x) => s + x.bps, 0), 10000);
  const st = memStorage();
  eq(AM.saveLastSplit(st, SCOPE, p, approval).saved, true);
  for (const T of ["1", "7", "100", "999999999", "1000000000"]) {
    const pre = AM.prefillFromLastSplit(r, PIGGIES, T);
    eq(AM.allocationSum(pre.rows, T).balanced, true, `T=${T}`);
  }
});
check("T3f deleted Piggy drops its leg; nothing is silently re-assigned (Σ<total keeps confirm blocked)", () => {
  const st = memStorage();
  const { p, approval } = approvedPlan();
  AM.saveLastSplit(st, SCOPE, p, approval);
  const { ratios } = AM.loadLastSplit(st, SCOPE);
  const pre = AM.prefillFromLastSplit(ratios, PIGGIES.filter((x) => x.id !== "p_mochi"), TOTAL);
  eq(pre.dropped, ["p_mochi"]);
  eq(pre.rows, [{ piggyId: "p_honey", amount: "500000000" }, { piggyId: "p_tofu", amount: "200000000" }]);
  eq(AM.allocationSum(pre.rows, TOTAL).balanced, false);
  eq(plan(pre.rows).reason, "sum_mismatch");
  // A new Piggy that was not in the memory gets "0", never a guessed share.
  const withNew = AM.prefillFromLastSplit(ratios, [...PIGGIES, { id: "p_new", name: "New", address: EVIL }], TOTAL);
  eq(withNew.rows.find((r) => r.piggyId === "p_new").amount, "0");
});
check("T3g tampered record → no prefill (extra field, permission field, bad version, scope, ratios, secret, corrupt)", () => {
  const base = { version: 1, chainId: "10143", accountId: "acct_1", ratios: [{ piggyId: "p_honey", bps: 6000 }, { piggyId: "p_mochi", bps: 4000 }], updatedAt: "x" };
  const cases = {
    extra_top: { ...base, note: 1 },
    permission_top: { ...base, permission: { auto: true } },
    auto_execute: { ...base, autoExecute: true },
    permission_in_ratio: { ...base, ratios: [{ piggyId: "p_honey", bps: 6000, permission: true }, { piggyId: "p_mochi", bps: 4000 }] },
    address_in_ratio: { ...base, ratios: [{ piggyId: "p_honey", bps: 6000, address: EVIL }, { piggyId: "p_mochi", bps: 4000 }] },
    amount_in_ratio: { ...base, ratios: [{ piggyId: "p_honey", bps: 6000, amount: "1" }, { piggyId: "p_mochi", bps: 4000 }] },
    bad_version: { ...base, version: 2 },
    missing_version: (({ version, ...r }) => r)(base),
    wrong_scope: { ...base, accountId: "acct_2" },
    sum_not_10000: { ...base, ratios: [{ piggyId: "p_honey", bps: 6000 }, { piggyId: "p_mochi", bps: 3000 }] },
    dup_piggy: { ...base, ratios: [{ piggyId: "p_honey", bps: 5000 }, { piggyId: "p_honey", bps: 5000 }] },
    zero_bps: { ...base, ratios: [{ piggyId: "p_honey", bps: 10000 }, { piggyId: "p_mochi", bps: 0 }] },
    float_bps: { ...base, ratios: [{ piggyId: "p_honey", bps: 5000.5 }, { piggyId: "p_mochi", bps: 4999.5 }] },
    secret_like: { ...base, secret: "x" },
    ratios_object: { ...base, ratios: { p_honey: 10000 } },
  };
  for (const [k, v] of Object.entries(cases)) {
    const st = memStorage();
    st.setItem("araso.lastSplit.10143.acct_1", JSON.stringify(v));
    const r = AM.loadLastSplit(st, SCOPE);
    if (r.ratios !== null || !r.error) throw new Error(`${k} → ${JSON.stringify(r)}`);
  }
  for (const raw of ["{", "[]", "null", "42", '"s"']) {
    const st = memStorage();
    st.setItem("araso.lastSplit.10143.acct_1", raw);
    eq(AM.loadLastSplit(st, SCOPE).ratios, null, raw);
  }
  eq(AM.prefillFromLastSplit(null, PIGGIES, TOTAL).rows, null);
});
check("T3h storage that throws → never throws, no prefill / not saved", () => {
  const boom = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  eq(AM.loadLastSplit(boom, SCOPE), { ratios: null, error: "storage_unavailable" });
  const { p, approval } = approvedPlan();
  eq(AM.saveLastSplit(boom, SCOPE, p, approval), { saved: false, error: "storage_unavailable" });
});

// ── T6. Per-leg partial success (injected TEST-ONLY rail) ────────────────────────────────
const TEST_RAIL = [{ method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, available: true, railId: "a646_test_only_rail" }];
function sendLeg(p, approval, piggyId, status, { retry = false, tx = null } = {}) {
  const pend = BR.markLegPending(p, piggyId, approval, { retry });
  if (!pend.ok) return { ok: false, reason: pend.reason, plan: p, sent: 0 };
  const leg = pend.plan.legs.find((l) => l.piggyId === piggyId);
  const it = FE.planLegIntent(pend.plan, leg, { approval, method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, adapters: TEST_RAIL, assetChangeAcknowledged: true });
  if (!it.ok) throw new Error(`intent: ${it.reason}`);
  const result = status === "confirmed"
    ? { status, chain: it.intent.targetChain, asset: it.intent.targetAsset, target: it.intent.target, amount: it.intent.requestedAmount, txHash: tx || `0xtx_${piggyId}_${leg.attempts}`, at: "t" }
    : { status };
  const applied = FE.applyFundingResult(it.intent, result);
  const r = BR.applyLegResult(pend.plan, piggyId, applied);
  if (!r.ok) throw new Error(`apply: ${r.reason}`);
  return { ok: true, plan: r.plan, sent: 1, key: pend.idempotencyKey, planId: pend.planId };
}
function freshApproved() {
  const { plan: p } = plan(ROWS3);
  const { approval } = AM.approvalForPlan(p);
  eq(BR.derivePlanState(p), "draft");
  const a = BR.markPlanApproved(p, approval);
  truthy(a.ok && a.permissionGranted === false, a.reason);
  eq(a.plan.state, "approved");
  return { p: a.plan, approval };
}
check("T6a 2 confirmed + 1 unknown = needs_attention; no auto-retry; nothing else sends until reconciled", () => {
  let { p, approval } = freshApproved();
  eq(BR.nextLegToSend(p, approval).leg.piggyId, "p_honey");
  p = sendLeg(p, approval, "p_honey", "confirmed").plan;
  eq(p.state, "in_progress");
  p = sendLeg(p, approval, "p_mochi", "confirmed").plan;
  p = sendLeg(p, approval, "p_tofu", "unknown").plan;
  eq(p.state, "needs_attention");
  eq(BR.planProgress(p), { legs: 3, placed: 2, failed: 0, needsAttention: 1, pending: 0, state: "needs_attention" });
  eq(BR.nextLegToSend(p, approval), { leg: null, reason: "reconcile_unknown_first" });
  eq(BR.nextLegToSend(p, approval, { retry: true }).leg, null, "retry flag does not bypass unknown");
  eq(BR.markLegPending(p, "p_tofu", approval, { retry: true }).reason, "reconcile_unknown_first");
  eq(BR.markLegPending(p, "p_honey", approval, { retry: true }).reason, "leg_already_confirmed");
});
check("T6b 2 confirmed + 1 failed = partial; retry resends ONLY the failed leg, same planId + key; confirmed never resent", () => {
  let { p, approval } = freshApproved();
  p = sendLeg(p, approval, "p_honey", "confirmed").plan;
  const failedFirst = sendLeg(p, approval, "p_mochi", "failed");
  p = failedFirst.plan;
  p = sendLeg(p, approval, "p_tofu", "confirmed").plan;
  eq(p.state, "partial");
  eq(BR.nextLegToSend(p, approval), { leg: null, reason: "retry_needs_explicit_request" }, "no auto-retry of failed either");
  const nxt = BR.nextLegToSend(p, approval, { retry: true });
  eq(nxt.leg.piggyId, "p_mochi");
  for (const id of ["p_honey", "p_tofu"]) eq(BR.markLegPending(p, id, approval, { retry: true }).reason, "leg_already_confirmed");
  const retried = sendLeg(p, approval, "p_mochi", "confirmed", { retry: true });
  eq([retried.planId, retried.key], [p.planId, failedFirst.key]);
  eq(retried.key, `${p.planId}:p_mochi`);
  p = retried.plan;
  eq(p.state, "complete");
  eq(p.legs.map((l) => l.attempts), [1, 2, 1], "honey/tofu sent once each");
  eq(BR.nextLegToSend(p, approval, { retry: true }), { leg: null, reason: "nothing_to_send" });
});
check("T6c unknown reconciled by a definitive result → confirmed or failed; pending never clears unknown", () => {
  let { p, approval } = freshApproved();
  p = sendLeg(p, approval, "p_honey", "unknown").plan;
  const leg = p.legs.find((l) => l.piggyId === "p_honey");
  const it = FE.planLegIntent(p, leg, { approval, method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, adapters: TEST_RAIL, assetChangeAcknowledged: true }).intent;
  p = BR.applyLegResult(p, "p_honey", FE.applyFundingResult(it, { status: "pending" })).plan;
  eq(p.legs[0].state, "unknown");
  p = BR.applyLegResult(p, "p_honey", FE.applyFundingResult(it, { status: "failed", errorCode: "x" })).plan;
  eq([p.legs[0].state, p.state], ["failed", "in_progress"]);
});
check("T6d one leg at a time; results for another Piggy / address / amount are refused (no change)", () => {
  let { p, approval } = freshApproved();
  const pend = BR.markLegPending(p, "p_honey", approval);
  p = pend.plan;
  eq(BR.markLegPending(p, "p_mochi", approval).reason, "one_leg_at_a_time");
  eq(BR.nextLegToSend(p, approval).reason, "one_leg_at_a_time");
  const mochiLeg = p.legs.find((l) => l.piggyId === "p_mochi");
  const mochiIntent = FE.planLegIntent(p, mochiLeg, { approval, method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, adapters: TEST_RAIL, assetChangeAcknowledged: true }).intent;
  const wrong = FE.applyFundingResult(mochiIntent, { status: "confirmed", chain: "10143", asset: "USDC", target: A2, amount: "300", txHash: "0xabc" });
  const r = BR.applyLegResult(p, "p_honey", wrong);
  eq([r.ok, r.reason], [false, "leg_mismatch"]);
  eq(r.plan.legs[0].state, "pending");
  const honeyLeg = p.legs[0];
  const hi = FE.planLegIntent(p, honeyLeg, { approval, method: FE.FUNDING_METHOD.FROM_ANOTHER_WALLET, adapters: TEST_RAIL, assetChangeAcknowledged: true }).intent;
  eq(BR.applyLegResult(p, "p_honey", FE.applyFundingResult({ ...hi, requestedAmount: "499" }, { status: "failed" })).reason, "leg_mismatch");
  eq(BR.applyLegResult(p, "p_honey", FE.applyFundingResult({ ...hi, target: EVIL }, { status: "failed" })).reason, "leg_mismatch");
});
check("T6e each leg its own result + Receipt key; no blended Receipt; duplicate evidence refused", () => {
  let { p, approval } = freshApproved();
  p = sendLeg(p, approval, "p_honey", "confirmed").plan;
  p = sendLeg(p, approval, "p_mochi", "confirmed").plan;
  const dup = sendLeg.bind(null);
  let threw = null;
  try { dup(p, approval, "p_tofu", "confirmed", { tx: "0xtx_p_honey_1" }); } catch (e) { threw = e.message; }
  truthy(/duplicate_evidence|apply/.test(String(threw)), `expected refusal, got ${threw}`);
  p = sendLeg(p, approval, "p_tofu", "confirmed").plan;
  const receipts = BR.planLegReceipts(p);
  eq(receipts.map((r) => r.key), [`${p.planId}:p_honey`, `${p.planId}:p_mochi`, `${p.planId}:p_tofu`]);
  eq(new Set(receipts.map((r) => r.evidenceKey)).size, 3);
  for (const r of receipts) {
    eq([r.receipt.piggyId, r.receipt.planId, r.receipt.action], [r.piggyId, p.planId, "add_money"]);
    truthy(!("legs" in r.receipt) && !Array.isArray(r.receipt.piggyId), "one Piggy per Receipt");
  }
  eq(receipts.map((r) => r.receipt.resolvedAmount), ["500", "300", "200"]);
});
check("T6f draft (unapproved) plan: nothing can be sent; approval with a different hash refused", () => {
  const { plan: p } = plan(ROWS3);
  const { approval } = AM.approvalForPlan(p);
  eq(BR.nextLegToSend(p, approval).reason, "not_the_approved_plan");
  eq(BR.markLegPending(p, "p_honey", approval).ok, false);
  eq(BR.markPlanApproved(p, { ...approval, planHash: "f".repeat(64) }).ok, false);
});

// ── T10 + static: no `cash` special case; model touches no WebAuthn / tx / signer / network ─────
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}
check("T10 no `cash` identifier special-cased anywhere in app/src (*.js)", () => {
  const hits = walk(SRC_DIR).filter((f) => f.endsWith(".js")).flatMap((f) => readFileSync(f, "utf8").split("\n")
    .map((line, i) => [f, i + 1, line]).filter(([, , line]) => /\bcash\b/i.test(line)));
  if (hits.length) throw new Error(hits.map(([f, n]) => `${path.relative(SRC_DIR, f)}:${n}`).join(", "));
});
const MODEL_FNS = [
  ...EXPECTED.AM.map((n) => [`add-money.${n}`, AM[n]]),
  ...EXPECTED.FE.map((n) => [`funding-entry.${n}`, FE[n]]),
  ...EXPECTED.BR.map((n) => [`funding-intent-bridge.${n}`, BR[n]]),
];
const FORBIDDEN = [
  /navigator\s*\.\s*credentials/, /webauthn/i, /PublicKeyCredential/, /requestPrf|requestMoneyPermission|activateSigningSession/,
  /sendTransaction|sendRawTransaction|eth_send|writeContract|signMessage|signTypedData|signTransaction/,
  /privateKey|createSecp256k1|signer/i, /\bfetch\s*\(/, /XMLHttpRequest|WebSocket/, /\blocalStorage\b|\bsessionStorage\b/,
  /\bdocument\b|\bwindow\b|innerHTML/, /\b(apy|yield|venue)\b/i, /["'`](safe|instant)["'`]/i, /\bcash\b/i,
];
check("static: model functions contain no WebAuthn / tx / signer / network / DOM / global storage / yield words", () => {
  const bad = [];
  for (const [name, fn] of MODEL_FNS) {
    if (typeof fn !== "function") { bad.push(`${name}:missing`); continue; }
    const src = fn.toString();
    for (const re of FORBIDDEN) if (re.test(src)) bad.push(`${name}:${re}`);
  }
  if (bad.length) throw new Error(bad.join(" | "));
});
check("static: the three model files import only local pure modules (no signer/session/network module)", () => {
  // pre-A-877 baseline: ["./add-money.js", "./funding-entry.js", "./piggy-registry.js", "./piggy-session.js"]
  // [A-877] + the three pure modules the Relay plan boundary needs (gate · chain/token identity · rail adapter).
  const allowed = new Set(["./add-money.js", "./funding-entry.js", "./piggy-registry.js", "./piggy-session.js",
    "./execution-safety.js", "./funding-context.js", "./funding-rail-relay.js"]);
  for (const f of ["add-money.js", "funding-entry.js", "funding-intent-bridge.js"]) {
    const src = readFileSync(path.join(SRC_DIR, f), "utf8");
    const imports = [...src.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
    for (const i of imports) if (!allowed.has(i)) throw new Error(`${f} imports ${i}`);
  }
});
check("static: [A-877] the three added modules stay pure (no imports, network, signer or session)", () => {
  const bad = [];
  for (const f of ["execution-safety.js", "funding-context.js", "funding-rail-relay.js"]) {
    const src = readFileSync(path.join(SRC_DIR, f), "utf8");
    if (/^\s*import[\s{*"']/m.test(src) || /\bimport\s*\(/.test(src) || /\brequire\s*\(/.test(src)) bad.push(`${f}:import`);
    if (/[^\w.]fetch\s*\(|\b(?:window|self)\.fetch\s*\(|globalThis\.fetch|XMLHttpRequest|WebSocket|sendBeacon/.test(src)) bad.push(`${f}:network`);
    if (/sendTransaction|sendRawTransaction|signTransaction|signMessage|signTypedData|eth_send|writeContract|walletClient|privateKey|mnemonic/.test(src)) bad.push(`${f}:signer`);
    if (/piggy-session|localStorage|sessionStorage|indexedDB|navigator\.credentials/.test(src)) bad.push(`${f}:session`);
  }
  if (bad.length) throw new Error(bad.join(" | "));
});
check("static: the test-only rail id exists nowhere in app/src", () => {
  const hit = walk(SRC_DIR).filter((f) => /\.(js|css|html)$/.test(f)).find((f) => readFileSync(f, "utf8").includes("a646_test_only_rail"));
  if (hit) throw new Error(hit);
});

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 && pass > 0 ? 0 : 1);
