// Second mainnet W3-R: a fail-closed aBIL local lane boundary around the already-proven read-only reader.
//   node app/test/a761-abil-mainnet-lane.mjs
// Node only, no network: `fetch` is replaced by a thrower; the reader gets a local fake JSON-RPC transport.
//
// Part A (reader reuse): the module's identity facts ARE the reader's ABIL_RECORDED; a full fake read through
//   readSecondCurrent() is what abilReaderEvidence consumes; every reader UNKNOWN class stays UNKNOWN.
// Part B (blocking): every blocking field is UNKNOWN and blocks on its own; no caller input clears one.
// Part Q (quote / minOut / exit): missing or malformed quote, minOut or exit evidence => action 0 / unknown,
//   minOut 0 and the fork round trip are refused as probe-only; complete caller evidence still ends at action 0.
// Part G (rights gate): required, unsatisfied, not implemented here; wording comes from the destination record.
// Part L (live off / money safety reuse): never READY / allowed / live; shared executor refusal, chain-profile
//   binding and permissionNonce are reused; no send / sign / storage / network / calldata in the module.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, encodeAbiParameters } from "viem";

globalThis.fetch = async () => { throw new Error("real network is forbidden in this suite"); };

import * as AB from "../src/mainnet-job-abil.js";
import * as COMMON from "../src/mainnet-job-common.js";
import { ABIL_RECORDED as R, ABIL_UNKNOWN_CLASS, CURRENT_READER_STATUS as S, readSecondCurrent } from "../src/second-current-reader.js";
import * as ABI from "../src/abi/second-reader-abi.js";
import { MAINNET_LANE_CONFIG } from "../src/mainnet-job-lane.js";
import { RETURN_READ_METHODS, buildExecutionPlan } from "../src/second-job-readiness.js";
import { resolveChainProfile } from "../src/chain-profile.js";
import { authorize, issuePermission, permissionNonce } from "../src/permission-envelope.js";
import { privatePath, PRIVATE_RE } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const {
  ABIL_ACTION, ABIL_BLOCKING_FIELDS, ABIL_BLOCKING_FIELD_NAMES, ABIL_FORK_EVIDENCE, ABIL_FORK_SIZE_RAW, ABIL_JOB_ID,
  abilActionPlan, abilExecutionGate, abilField, abilPermissionRequest, abilReaderEvidence, abilReadiness, abilRightsGate,
} = AB;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SRC_DIR = path.join(REPO, "app/src");
const SRC = (f) => readFileSync(path.join(SRC_DIR, f), "utf8");
const MODULE = "mainnet-job-abil.js";
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const CODE = strip(SRC(MODULE));
const MAINNET = resolveChainProfile("monad-mainnet");
const TESTNET = resolveChainProfile("monad-testnet");
const BLOCKED = resolveChainProfile("nonsense-profile");
const ABIL_PROFILE = { ...MAINNET, jobId: ABIL_JOB_ID, liveExecution: false };
const PIGGY = { id: "piggy-1", address: "0x1111111111111111111111111111111111111111" };
const FORK_EXECUTOR = { kind: "local_fork", chainId: 143, forkBlock: 108999816, send: async () => { throw new Error("no send in this suite"); }, receipt: async () => null };
const LIVE_EXECUTOR = { ...FORK_EXECUTOR, kind: "live" };
const ABIL_RAW = privatePath("ops/receipts/A652_mainnet_fork_lab/raw/abil-spot.json");
const URL_ = "https://fork.local.invalid/rpc";
const NOW = "2026-10-05T00:00:00Z";
const HEAD = 109000000;
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const tryDecode = (abi, data) => { try { return decodeFunctionData({ abi, data }); } catch { return null; } };

let pass = 0;
let fail = 0;
let skip = 0;
async function check(label, fn) {
  try {
    const r = await fn();
    if (r === "SKIP") { console.log(`SKIP  ${label}`); skip += 1; } else { console.log(`PASS  ${label}`); pass += 1; }
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${e?.message || e}`);
    fail += 1;
  }
}

// Local fake chain answering only with the recorded aBIL values (same shape as the A-716 reader suite).
function world(over = {}) {
  const o = { chainId: 143, head: HEAD, token0: R.token, token1: R.usdc, fee: R.fee, factory: R.factory, decimals: R.tokenDecimals, ...over };
  const fetchImpl = async (url, init) => {
    assert.equal(url, URL_);
    const req = JSON.parse(init.body);
    const ok = (result) => ({ ok: true, json: async () => ({ id: req.id, result }) });
    const err = () => ({ ok: true, json: async () => ({ id: req.id, error: { code: 3, message: "execution reverted" } }) });
    if (!RETURN_READ_METHODS.includes(req.method)) return err();
    if (req.method === "eth_chainId") return ok(`0x${o.chainId.toString(16)}`);
    if (req.method === "eth_blockNumber") return ok(`0x${o.head.toString(16)}`);
    if (req.method === "eth_getCode") return ok("0x6080");
    const [{ to, data }] = req.params;
    const word = (v) => ok(encodeAbiParameters([{ type: "uint256" }], [BigInt(v)]));
    const addr = (a) => ok(encodeAbiParameters([{ type: "address" }], [a]));
    if (eq(to, R.pool)) {
      const f = tryDecode(ABI.ABIL_POOL_VIEW_ABI, data)?.functionName;
      if (f === "token0") return addr(o.token0);
      if (f === "token1") return addr(o.token1);
      if (f === "fee") return word(o.fee);
      if (f === "factory") return addr(o.factory);
      if (f === "liquidity") return word("69905557358485131");
      return err();
    }
    if (eq(to, R.router)) return tryDecode(ABI.ABIL_ROUTER_VIEW_ABI, data) ? addr(o.factory) : err();
    if (eq(to, R.token) && tryDecode(ABI.ERC20_DECIMALS_VIEW_ABI, data)) return word(o.decimals);
    const fn = tryDecode(ABI.ERC20_VIEW_ABI, data);
    if (fn && eq(to, R.token)) return fn.functionName === "balanceOf" ? word(54407835408222484n) : word(0);
    if (fn && eq(to, R.usdc)) return fn.functionName === "balanceOf" ? word(5000000) : word(0);
    return err();
  };
  return { profile: MAINNET, piggyAddress: PIGGY.address, rpcUrl: URL_, fetchImpl, now: () => NOW };
}
const FULL = await readSecondCurrent(world());
const FULL_ROW = FULL.candidates.find((c) => c.id === "abil-spot");
const QUOTE = { amountOutRaw: "54000000000000000", block: HEAD, source: "caller quote (test)" };
const EXIT = { amountOutRaw: "4900000", minOutRaw: "4800000", block: HEAD, source: "caller exit quote (test)" };
const COMPLETE = { step: "buy", reader: FULL, quote: QUOTE, minOutRaw: "53000000000000000", exitEvidence: EXIT };
const isAction0 = (o) => o.action === "none" && o.actionCount === 0 && o.liveExecution === false && o.executionPermission === false;

// ── Part A · A-716 reader reuse ─────────────────────────────────────────────────────────────────────────
await check("A1 module imports the A-716 reader surface and restates no identity constant", () => {
  assert.match(SRC(MODULE), /import \{[^}]*ABIL_RECORDED[^}]*\} from "\.\/second-current-reader\.js"/);
  assert.equal(ABIL_FORK_EVIDENCE.recorded, R, "identity is the reader's frozen object, not a copy");
  assert.equal(ABIL_FORK_EVIDENCE.chainId, R.chainId);
  assert.equal(ABIL_FORK_EVIDENCE.block, R.evidenceBlock);
  for (const a of [R.router, R.pool, R.token, R.factory]) assert.equal(CODE.toLowerCase().includes(a.toLowerCase()), false, `no restated ${a}`);
});

await check("A2 full fake read through readSecondCurrent -> IDENTITY_READ, quote still UNKNOWN, holdings passed through", () => {
  assert.equal(FULL_ROW.status, S.ABIL_QUOTE_INCOMPLETE);
  const ev = abilReaderEvidence(FULL);
  assert.equal(ev.status, "IDENTITY_READ");
  assert.equal(ev.identityProven, true);
  assert.equal(ev.quote, "UNKNOWN");
  assert.equal(ev.block, HEAD);
  assert.deepEqual({ ...ev.holdings }, FULL_ROW.read.holdings);
  assert.deepEqual(abilReaderEvidence(FULL_ROW), ev, "row or whole result give the same judgement");
});

await check("A3 every reader UNKNOWN class (missing/stale/conflicting/unsupported) stays UNKNOWN, no values", async () => {
  const cases = {
    missing: await readSecondCurrent({ ...world(), rpcUrl: undefined }),
    stale: await readSecondCurrent(world({ head: R.evidenceBlock - 1 })),
    conflicting: await readSecondCurrent(world({ fee: 500 })),
  };
  for (const [cls, res] of Object.entries(cases)) {
    const row = res.candidates.find((c) => c.id === "abil-spot");
    assert.equal(row.status, S.UNKNOWN, cls);
    const ev = abilReaderEvidence(res);
    assert.equal(ev.identityProven, false, cls);
    assert.equal(ev.status, "UNKNOWN");
    assert.equal(ev.unknownClass, cls);
    assert.equal(ev.holdings, null);
    assert.ok(ABIL_UNKNOWN_CLASS.includes(ev.unknownClass));
  }
  const unsupported = { id: "abil-spot", status: S.UNKNOWN, unknownClass: "unsupported", reason: "unsupported:x", read: null };
  assert.equal(abilReaderEvidence(unsupported).unknownClass, "unsupported");
});

await check("A4 forged / tampered reader rows are refused", () => {
  const r = FULL_ROW.read;
  const bad = [
    undefined, null, {}, { candidates: [] }, { ...FULL_ROW, id: "aave-usdc" }, { ...FULL_ROW, status: "ready" },
    { ...FULL_ROW, read: { ...r, identityMatchesRecorded: false } },
    { ...FULL_ROW, read: { ...r, router: PIGGY.address } },
    { ...FULL_ROW, read: { ...r, pool: PIGGY.address } },
    { ...FULL_ROW, read: { ...r, token: { ...r.token, address: PIGGY.address } } },
    { ...FULL_ROW, read: { ...r, chainId: 10143 } },
    { ...FULL_ROW, read: { ...r, block: R.evidenceBlock - 1 } },
    { ...FULL_ROW, read: null },
  ];
  for (const b of bad) assert.equal(abilReaderEvidence(b).identityProven, false, JSON.stringify(b)?.slice(0, 80));
});

await check("A5 fork evidence equals the recorded raw run (when present)", () => {
  if (!existsSync(ABIL_RAW)) return "SKIP";
  const raw = JSON.parse(readFileSync(ABIL_RAW, "utf8"));
  const E = ABIL_FORK_EVIDENCE;
  assert.equal(raw.block.number, E.block);
  assert.equal(raw.block.timestampIso.replace(".000Z", "Z"), E.blockTimestamp);
  assert.equal(raw.roundTrip.sentRaw, E.sentRaw);
  assert.equal(raw.roundTrip.deltaRaw, E.deltaRaw);
  assert.equal(raw.balances.abilAfterBuy, E.abilAfterBuy);
  assert.equal(raw.allowance.usdcToRouterAfter, E.allowancesAfter.usdcToRouterRaw);
  assert.equal(raw.allowance.abilToRouterAfter, E.allowancesAfter.abilToRouterRaw);
  const step = (id) => raw.steps.find((s) => s.step === id);
  assert.equal(Number(step("1a_approve").gasUsed), E.gasUsed.approveUsdc);
  assert.equal(Number(step("1b_buy").gasUsed), E.gasUsed.buy);
  assert.equal(Number(step("2a_approve").gasUsed), E.gasUsed.approveAbil);
  assert.equal(Number(step("2b_sell").gasUsed), E.gasUsed.sell);
  assert.equal(step("1b_buy").signature, E.swapSignature);
  assert.equal(step("1b_buy").selector, E.swapSelector);
  assert.match(step("1b_buy").label, /minOut=0 fork probe/);
  assert.equal(raw.resolution.router.address, R.router);
  assert.equal(raw.resolution.pool.address, R.pool);
  assert.equal(raw.resolution.token.address, R.token);
});

// ── Part B · blocking fields ────────────────────────────────────────────────────────────────────────────
await check("B1 eligibility / KYC / geo / rights / redemption / secondary liquidity are explicit blocking UNKNOWN fields", () => {
  for (const f of ["eligibility", "kyc", "geo", "rights", "redemption", "secondaryLiquidity", "quote", "minOut", "exitEvidence"]) {
    assert.ok(ABIL_BLOCKING_FIELDS[f], f);
    assert.equal(ABIL_BLOCKING_FIELDS[f].blocking, true, f);
    assert.equal(ABIL_BLOCKING_FIELDS[f].value, "UNKNOWN", f);
    assert.equal(abilField(f), "UNKNOWN", f);
    assert.ok(ABIL_BLOCKING_FIELD_NAMES.includes(f), f);
    assert.ok(Object.isFrozen(ABIL_BLOCKING_FIELDS[f]));
  }
  assert.ok(Object.isFrozen(ABIL_BLOCKING_FIELDS));
  assert.equal(abilField("nope"), "UNKNOWN");
  assert.equal(abilField(undefined), "UNKNOWN");
});

await check("B2 every blocking field blocks on its own: each appears in readiness.blockedBy even with complete caller evidence", () => {
  const rd = abilReadiness({ ...COMPLETE, profile: ABIL_PROFILE, piggy: PIGGY, executor: FORK_EXECUTOR });
  for (const f of ABIL_BLOCKING_FIELD_NAMES) assert.ok(rd.blockedBy.includes(`blocking_field:${f}`), f);
  // Removing any one field from consideration still leaves the lane refused: refusal is per field, not a single flag.
  for (const f of ABIL_BLOCKING_FIELD_NAMES) {
    const rest = ABIL_BLOCKING_FIELD_NAMES.filter((x) => x !== f);
    assert.ok(rest.every((x) => rd.blockedBy.includes(`blocking_field:${x}`)));
  }
});

await check("B3 complete caller evidence ends at a blocking field (action 0), never a call", () => {
  const out = abilActionPlan(COMPLETE);
  assert.ok(isAction0(out));
  assert.equal(out.reason, `blocking_field:${ABIL_BLOCKING_FIELD_NAMES[0]}`);
  assert.equal(out.call, null);
  assert.equal(abilActionPlan({ ...COMPLETE, step: "sell" }).reason, `blocking_field:${ABIL_BLOCKING_FIELD_NAMES[0]}`);
  // caller attempts to "resolve" a blocking field are ignored
  assert.equal(abilActionPlan({ ...COMPLETE, eligibility: "ok", kyc: true, geo: "US", rights: "accepted" }).reason, `blocking_field:${ABIL_BLOCKING_FIELD_NAMES[0]}`);
});

// ── Part Q · quote / minOut / exit evidence ─────────────────────────────────────────────────────────────
await check("Q1 no quote / no minOut / no exit evidence => action 0 with the named UNKNOWN", () => {
  const cases = [
    [{ ...COMPLETE, quote: undefined }, "missing_quote"],
    [{ ...COMPLETE, minOutRaw: undefined }, "missing_min_out"],
    [{ ...COMPLETE, exitEvidence: undefined }, "missing_exit_evidence"],
    [{ step: "buy", reader: FULL }, "missing_quote"],
    [{ ...COMPLETE, reader: undefined }, "reader:no_reader_row"],
    [{ ...COMPLETE, step: "swap" }, "unknown_step"],
    [undefined, "unknown_step"],
  ];
  for (const [input, reason] of cases) {
    const out = abilActionPlan(input);
    assert.ok(isAction0(out), reason);
    assert.equal(out.decision, "unknown");
    assert.equal(out.reason, reason);
    assert.equal(out.call, null);
  }
});

await check("Q2 malformed quote / minOut / exit evidence => action 0; minOut 0 and the fork round trip are probe-only", () => {
  const cases = [
    [{ ...COMPLETE, quote: { ...QUOTE, amountOutRaw: "0" } }, "quote_amount_not_exact"],
    [{ ...COMPLETE, quote: { ...QUOTE, amountOutRaw: "1.5" } }, "quote_amount_not_exact"],
    [{ ...COMPLETE, quote: { ...QUOTE, block: R.evidenceBlock - 1 } }, "quote_block_unproven"],
    [{ ...COMPLETE, quote: { ...QUOTE, source: "" } }, "quote_source_missing"],
    [{ ...COMPLETE, minOutRaw: "0" }, "min_out_zero_is_fork_probe_only"],
    [{ ...COMPLETE, minOutRaw: ABIL_FORK_EVIDENCE.forkMinOutRaw }, "min_out_zero_is_fork_probe_only"],
    [{ ...COMPLETE, minOutRaw: "-1" }, "min_out_not_exact"],
    [{ ...COMPLETE, minOutRaw: "54000000000000001" }, "min_out_above_quote"],
    [{ ...COMPLETE, exitEvidence: ABIL_FORK_EVIDENCE }, "exit_evidence_is_fork_probe"],
    [{ ...COMPLETE, exitEvidence: { ...EXIT, minOutRaw: "0" } }, "exit_evidence_is_fork_probe"],
    [{ ...COMPLETE, exitEvidence: { ...EXIT, amountOutRaw: "x" } }, "exit_evidence_not_exact"],
    [{ ...COMPLETE, exitEvidence: { ...EXIT, minOutRaw: "4900001" } }, "exit_min_out_above_quote"],
    [{ ...COMPLETE, exitEvidence: { ...EXIT, block: 1 } }, "exit_block_unproven"],
    [{ ...COMPLETE, exitEvidence: { ...EXIT, source: " " } }, "exit_source_missing"],
  ];
  for (const [input, reason] of cases) {
    const out = abilActionPlan(input);
    assert.ok(isAction0(out), reason);
    assert.equal(out.reason, reason);
  }
});

await check("Q3 the reader's own quote is UNKNOWN, so reader evidence alone never satisfies the quote requirement", () => {
  assert.equal(FULL_ROW.read.quote.status, "UNKNOWN");
  assert.equal(abilActionPlan({ step: "buy", reader: FULL, quote: FULL_ROW.read.quote, minOutRaw: "1", exitEvidence: EXIT }).reason, "quote_amount_not_exact");
});

// ── Part G · rights gate ────────────────────────────────────────────────────────────────────────────────
await check("G1 rights gate: required, unsatisfied, not implemented here; wording is the destination record's", () => {
  const plan = buildExecutionPlan("abil-spot", { context: { address: PIGGY.address, chain: "monad-mainnet" } }).plan;
  const g = abilRightsGate(PIGGY.address);
  assert.equal(g.required, true);
  assert.equal(g.satisfied, false);
  assert.equal(g.implementedHere, false);
  assert.equal(g.statement, plan.rights.statement);
  assert.equal(g.shareholderRights, false);
  assert.equal(g.eligibilityGate, plan.eligibilityGate);
  assert.equal(g.dividend, "UNKNOWN");
  for (const a of [undefined, "", "0x12", ["x"]]) {
    const u = abilRightsGate(a);
    assert.equal(u.required, true); assert.equal(u.satisfied, false); assert.equal(u.statement, "UNKNOWN");
  }
  assert.equal(/satisfied\s*:\s*true|implementedHere\s*:\s*true/.test(CODE), false);
});

await check("G2 the execution gate refuses on the rights gate before anything could pass", () => {
  const g = abilExecutionGate({ profile: ABIL_PROFILE, piggy: PIGGY, executor: FORK_EXECUTOR, step: "buy" });
  assert.ok(isAction0(g));
  assert.equal(g.allowed, false);
  assert.equal(g.reason, "rights_gate_unsatisfied");
  const rd = abilReadiness({ ...COMPLETE, profile: ABIL_PROFILE, piggy: PIGGY, executor: FORK_EXECUTOR });
  assert.ok(rd.blockedBy.includes("rights_gate_unsatisfied"));
  assert.equal(rd.rightsGate.satisfied, false);
});

// ── Part L · live off / money safety reuse ──────────────────────────────────────────────────────────────
await check("L1 readiness never READY / executable / live / permitted, whatever the input claims", () => {
  const inputs = [undefined, {}, { ...COMPLETE, profile: ABIL_PROFILE, piggy: PIGGY, executor: FORK_EXECUTOR },
    { ...COMPLETE, profile: { ...ABIL_PROFILE, liveExecution: true }, piggy: PIGGY, executor: LIVE_EXECUTOR }, { ready: true, liveExecution: true }];
  for (const i of inputs) {
    const rd = abilReadiness(i);
    assert.equal(rd.ready, false); assert.equal(rd.executable, false); assert.equal(rd.liveExecution, false);
    assert.equal(rd.executionPermission, false); assert.equal(rd.createsPermission, false);
    assert.equal(rd.action, "none"); assert.equal(rd.actionCount, 0); assert.equal(rd.decision, "unknown");
    assert.ok(rd.blockedBy.includes("live_execution_disabled"));
    assert.ok(!/READY/.test(JSON.stringify(rd)));
    assert.ok(Object.isFrozen(rd));
  }
});

await check("L2 execution gate: shared boundaries first, live executor refused by the shared refusal", () => {
  const g = (o) => abilExecutionGate({ profile: ABIL_PROFILE, piggy: PIGGY, executor: FORK_EXECUTOR, step: "buy", ...o });
  assert.equal(g({ step: "mint" }).reason, "unknown_step");
  assert.equal(g({ profile: BLOCKED }).reason, "profile_blocked");
  assert.equal(g({ profile: { ...ABIL_PROFILE, liveExecution: true } }).reason, "live_execution_disabled");
  assert.equal(g({ profile: MAINNET }).reason, MAINNET.jobId === ABIL_JOB_ID ? "rights_gate_unsatisfied" : "profile_not_abil_lane");
  assert.equal(g({ piggy: { id: "p", address: [PIGGY.address] } }).reason, "missing_piggy_address");
  for (const [label, executor] of [["none", undefined], ["live", LIVE_EXECUTOR], ["wrong chain", { ...FORK_EXECUTOR, chainId: 1 }], ["fork", FORK_EXECUTOR]]) {
    const shared = COMMON.executorRefusal(ABIL_PROFILE, executor);
    const out = g({ executor });
    assert.equal(out.allowed, false, label);
    assert.equal(out.reason, shared ?? "rights_gate_unsatisfied", label);
  }
});

await check("L3 permission request: shape authorize() compares, nonce from permissionNonce, issues nothing, binds via chain-profile", () => {
  const { request, error } = abilPermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "5000000", eventId: "evt-1" });
  assert.equal(error, null);
  assert.equal(request.permission, null); assert.equal(request.createsPermission, false); assert.ok(Object.isFrozen(request));
  assert.equal(request.action, ABIL_ACTION); assert.equal(request.destination, R.router); assert.equal(request.chain, MAINNET.scope);
  assert.equal(request.expectedAbilRaw, "UNKNOWN"); assert.equal(request.minOutRaw, "UNKNOWN");
  const fields = { piggyId: PIGGY.id, signerAddress: PIGGY.address, action: ABIL_ACTION, asset: "USDC", amount: "5000000", chain: MAINNET.scope, destination: R.router };
  assert.equal(request.nonce, permissionNonce({ ...fields, at: "evt-1" }));
  const nowMs = 1_000_000;
  const { envelope } = issuePermission({ intent: request, auth: { method: "passkey", verified: true, verifiedAt: nowMs }, nonce: request.nonce, nowMs });
  const context = { selectedPiggyId: PIGGY.id, selectedPiggyAddress: PIGGY.address, activeSignerAddress: PIGGY.address };
  assert.equal(authorize(envelope, request, { nowMs, context }).ok, true);
  assert.equal(authorize(envelope, { ...request, amount: "4999999" }, { nowMs, context }).reason, "amount_mismatch");
  assert.equal(authorize(envelope, { ...request, destination: R.pool }, { nowMs, context }).reason, "destination_mismatch");
  assert.equal(abilPermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: String(BigInt(ABIL_FORK_SIZE_RAW) + 1n) }).error, "amount_above_fork_proven_size");
  assert.equal(abilPermissionRequest({ profile: MAINNET, piggy: PIGGY, amountRaw: "5.0" }).error, "amount_not_exact");
  assert.equal(abilPermissionRequest({ profile: TESTNET, piggy: PIGGY, amountRaw: "1" }).error, "profile_chain_not_abil_evidence");
  assert.equal(abilPermissionRequest({ profile: BLOCKED, piggy: PIGGY, amountRaw: "1" }).error, "profile_blocked");
  assert.equal(abilPermissionRequest({ profile: { ...MAINNET, usdc: { symbol: "USDC", address: PIGGY.address, decimals: 6 } }, piggy: PIGGY, amountRaw: "1" }).error, "profile_asset_not_abil_evidence");
  for (const bad of [undefined, null, "x"]) assert.equal(abilPermissionRequest(bad).request, null);
});

await check("L4 module reuses the shared boundaries (common / chain-profile / permission-envelope) and has no own copies", () => {
  const src = SRC(MODULE);
  assert.match(src, /from "\.\/mainnet-job-common\.js"/);
  assert.match(src, /executorRefusal\(profile, executor\)/);
  assert.match(src, /from "\.\/chain-profile\.js"/);
  assert.match(src, /permissionNonce\(/);
  assert.equal(/function\s+(executorRefusal|bindRecordToProfile|permissionNonce|formatUnits)\b/.test(CODE), false);
});

await check("L5 no send / sign / storage / network / timers / calldata / executor construction / permission issuing", () => {
  assert.equal(/\.sendTransaction\s*\(|\.sendRawTransaction\s*\(|\.send\s*\(|executeMoneyStep|money-executor|signTransaction|signMessage|privateKey|mnemonic|walletClient|createWalletClient|createPublicClient|fetch\(|localStorage|sessionStorage|setItem|getItem|setTimeout|setInterval|issuePermission|authorize\(|consume\(|eth_|rpcUrl|http|readContract|encodeFunctionData|readSecondCurrent\(|makeReadOnlyReader/.test(CODE), false);
  assert.equal(/local_fork/.test(SRC(MODULE)), false);
  assert.equal(/(allowed|ready|executable|executionPermission|createsPermission|liveExecution|satisfied|implementedHere|blocking\s*:\s*false)\s*:?\s*true|actionCount\s*:\s*[1-9]|action\s*:\s*"(?!none")/.test(CODE), false);
});

await check("L6 live stays off: lane config unchanged, no product file imports this module, no writer ABI under abi/", () => {
  assert.deepEqual({ ...MAINNET_LANE_CONFIG }, { reader: null, liveExecution: false });
  assert.equal(MAINNET.liveExecution, false);
  assert.notEqual(MAINNET.jobId, ABIL_JOB_ID);
  const files = readdirSync(SRC_DIR).filter((x) => x.endsWith(".js") && x !== MODULE);
  assert.deepEqual(files.filter((f) => /mainnet-job-abil/.test(SRC(f))), []);
  assert.equal(existsSync(path.join(SRC_DIR, "abi", MODULE)), false, "no writer ABI under abi/ (second-current-reader forbids it)");
});

await check("L7 hygiene: no private path, card id or yield / instant / guaranteed wording in the shipped module", () => {
  const src = SRC(MODULE);
  assert.equal(PRIVATE_RE.test(src) || /receipts\//.test(src), false);
  assert.equal(/\bA-\d{3}\b/.test(src), false);
  assert.equal(/\b(apy|apr|yield|earn|guaranteed)\b|["'`>](safe|instant|immediate)\b/i.test(strip(src)), false);
});

console.log(`\n${pass}/${pass + fail} PASS${skip ? ` (${skip} SKIP)` : ""}`);
process.exit(fail === 0 ? 0 : 1);
