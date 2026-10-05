// [A-716] aBIL reader R1. Node only, no network: `fetch` is replaced by a thrower and the reader gets a local fake
// JSON-RPC transport. Nothing here opens a socket.
//   node app/test/a716-abil-reader.mjs
// What is pinned:
//   · the aBIL read uses ONLY the already-recorded A-652 address / ABI evidence (SRC checks cite exact phrases);
//   · reads stay inside RETURN_READ_METHODS and every ABI fragment is `view`;
//   · missing / stale / conflicting / unsupported → row `unknown` with read:null (the "unknown invariant");
//   · the quote is UNKNOWN even on a full read; no READY / permission / execution / plan field is created;
//   · the A-710 decision core still decides aBIL `unknown`, action none.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, encodeAbiParameters } from "viem";

import { resolveChainProfile } from "../src/chain-profile.js";
import { ABIL_RECORDED as R, ABIL_UNKNOWN_CLASS, CURRENT_READER_STATUS as S, makeReadOnlyReader, readSecondCurrent } from "../src/second-current-reader.js";
import * as ABI from "../src/abi/second-reader-abi.js";
import { decideCurrentCandidates } from "../src/mainnet-job-lane.js";
import { RETURN_READ_METHODS } from "../src/second-job-readiness.js";

globalThis.fetch = async () => { throw new Error("real network is forbidden in this suite"); };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "../..");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    const out = await fn();
    console.log(`${out === "SKIP" ? "SKIP" : "PASS"}  ${label}`);
    pass += 1;
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${e?.message || e}`);
    fail += 1;
  }
}

const URL_ = "https://fork.local.invalid/rpc";
const NOW = "2026-10-03T00:00:00Z";
const PROFILE = resolveChainProfile("monad-mainnet");
const PIGGY = "0x1111111111111111111111111111111111111111";
const OTHER = "0x9999999999999999999999999999999999999999";
const HEAD = 109000000;
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const tryDecode = (abi, data) => { try { return decodeFunctionData({ abi, data }); } catch { return null; } };

// Fake chain. Only aBIL-path addresses answer; every other eth_call errors (so other candidates fail, which is
// irrelevant here). `over` replaces any single recorded answer to build a missing / stale / conflicting world.
function world(over = {}) {
  const o = { chainId: 143, head: HEAD, token0: R.token, token1: R.usdc, fee: R.fee, poolFactory: R.factory, routerFactory: R.factory, decimals: R.tokenDecimals, code: {}, revert: {}, garbage: {}, ...over };
  const calls = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, URL_);
    const req = JSON.parse(init.body);
    calls.push(req);
    const ok = (result) => ({ ok: true, json: async () => ({ id: req.id, result }) });
    const err = () => ({ ok: true, json: async () => ({ id: req.id, error: { code: 3, message: "execution reverted" } }) });
    if (!RETURN_READ_METHODS.includes(req.method)) return err();
    if (req.method === "eth_chainId") return ok(`0x${o.chainId.toString(16)}`);
    if (req.method === "eth_blockNumber") return ok(`0x${o.head.toString(16)}`);
    const tag = `0x${o.head.toString(16)}`;
    if (req.method === "eth_getCode") {
      assert.equal(req.params[1], tag);
      const key = Object.keys(o.code).find((k) => eq(k, req.params[0]));
      return ok(key ? o.code[key] : "0x6080");
    }
    const [{ to, data }, blockTag] = req.params;
    assert.equal(blockTag, tag, "every call pinned to the one block");
    const word = (v) => ok(encodeAbiParameters([{ type: "uint256" }], [BigInt(v)]));
    const addr = (a) => ok(encodeAbiParameters([{ type: "address" }], [a]));
    const answer = (name, fn) => (o.revert[name] ? err() : o.garbage[name] ? ok("0x01") : fn());
    if (eq(to, R.pool)) {
      const f = tryDecode(ABI.ABIL_POOL_VIEW_ABI, data)?.functionName;
      if (f === "token0") return answer("token0", () => addr(o.token0));
      if (f === "token1") return answer("token1", () => addr(o.token1));
      if (f === "fee") return answer("fee", () => word(o.fee));
      if (f === "factory") return answer("poolFactory", () => addr(o.poolFactory));
      if (f === "liquidity") return answer("liquidity", () => word("69905557358485131"));
      return err();
    }
    if (eq(to, R.router)) return tryDecode(ABI.ABIL_ROUTER_VIEW_ABI, data) ? answer("routerFactory", () => addr(o.routerFactory)) : err();
    if (eq(to, R.token) && tryDecode(ABI.ERC20_DECIMALS_VIEW_ABI, data)) return answer("decimals", () => word(o.decimals));
    const fn = tryDecode(ABI.ERC20_VIEW_ABI, data);
    if (fn && eq(to, R.token)) return fn.functionName === "balanceOf" ? answer("abilBalance", () => word(54407835408222484n)) : word(0);
    if (fn && eq(to, R.usdc)) return fn.functionName === "balanceOf" ? word(5000000) : word(0);
    return err();
  };
  return { calls, input: { profile: PROFILE, piggyAddress: PIGGY, rpcUrl: URL_, fetchImpl, now: () => NOW } };
}
const abilOf = (r) => r.candidates.find((c) => c.id === "abil-spot");
const abilCalls = (calls) => calls.filter((c) => c.method === "eth_call" && [R.pool, R.router, R.token, R.usdc].some((a) => eq(a, c.params[0].to)));

// Field names that would mean a go / permission / execution / plan exists. None may appear anywhere in a row.
const FORBIDDEN_KEY = /ready|permission|execut|plan|preview|envelope|allowed|approved|go$/i;
function forbiddenKeys(v, at = "") {
  if (!v || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) => [...(FORBIDDEN_KEY.test(k) ? [`${at}${k}`] : []), ...forbiddenKeys(x, `${at}${k}.`)]);
}
function assertUnknownInvariant(row, cls) {
  assert.equal(row.status, S.UNKNOWN, `status unknown (got ${row.status} / ${row.reason})`);
  assert.equal(row.unknownClass, cls);
  assert.ok(ABIL_UNKNOWN_CLASS.includes(row.unknownClass));
  assert.ok(row.reason.startsWith(`${cls}:`), `reason names the class: ${row.reason}`);
  assert.equal(row.read, null, "an UNKNOWN row carries no partial values");
  assert.ok(row.unknown.includes("quote"));
  assert.deepEqual(forbiddenKeys(row), []);
  assert.ok(!/READY/.test(JSON.stringify(row)));
}

// ── HAPPY · read from recorded evidence ─────────────────────────────────────────────────────────────
await check("H1 full read: identity matches recorded, holdings read, quote UNKNOWN", async () => {
  const w = world();
  const row = abilOf(await readSecondCurrent(w.input));
  assert.equal(row.status, S.ABIL_QUOTE_INCOMPLETE);
  assert.equal(row.reason, "pool_identity_matches_recorded_quote_unknown");
  const r = row.read;
  assert.equal(r.chainId, 143);
  assert.equal(r.block, HEAD);
  assert.equal(r.observedAt, NOW);
  assert.ok(r.source.startsWith("read-only rpc eth_chainId/eth_blockNumber/eth_getCode/eth_call @"));
  assert.equal(r.identityMatchesRecorded, true);
  assert.ok(eq(r.router, "0xFE951b693A2FE54BE5148614B109E316B567632F"));
  assert.ok(eq(r.pool, "0xb8700E0D0Df2B0b09A1374FbCdCC85E2E14F7898"));
  assert.deepEqual(r.token, { address: R.token, symbol: "aBIL", decimals: 18 });
  assert.equal(r.poolLiquidityRaw, "69905557358485131");
  assert.deepEqual(r.holdings, { usdcRaw: "5000000", abilRaw: "54407835408222484", usdcAllowanceToRouterRaw: "0", abilAllowanceToRouterRaw: "0" });
  assert.deepEqual(r.quote, { value: null, status: "UNKNOWN", reason: "no_recorded_quoter_or_price_view" });
  assert.deepEqual(row.unknown, ["quote", "dividend", "eligibility"]);
  assert.deepEqual(r.recorded, { source: R.source, block: 108999816 });
});

await check("H2 bounded: whitelist methods only, recorded addresses only, one pinned block, fixed call count", async () => {
  const w = world();
  await readSecondCurrent(w.input);
  for (const c of w.calls) assert.ok(RETURN_READ_METHODS.includes(c.method), c.method);
  const a = abilCalls(w.calls);
  // 6 identity views + liquidity + 2 balances + 2 allowances (the other candidates' USDC calls also hit R.usdc).
  const toPath = a.filter((c) => [R.pool, R.router, R.token].some((x) => eq(x, c.params[0].to)));
  assert.equal(toPath.length, 9);
  const codes = w.calls.filter((c) => c.method === "eth_getCode").map((c) => c.params[0].toLowerCase());
  for (const x of [R.router, R.pool, R.token]) assert.ok(codes.includes(x.toLowerCase()), `code checked at ${x}`);
});

// ── SRC · every recorded constant is quoted from already-recorded evidence ──────────────────────────
const MX = "_private/ops/receipts/A652_mainnet_fork_lab/MAINNET_FORK_MATRIX.md";
const HN = "_private/ops/harness/a652-mainnet-fork-lab.mjs";
const RD = "app/src/second-job-readiness.js";
const SOURCES = {
  router: [MX, "router `0xFE951b693A2FE54BE5148614B109E316B567632F` (11,364 B)"],
  pool: [MX, "Pool `0xb8700E0D0Df2B0b09A1374FbCdCC85E2E14F7898` (757 B)"],
  "token0 aBIL / token1 USDC, fee 3000": [MX, "token0 aBIL / token1 USDC, fee 3000"],
  "token + decimals 18": [MX, "aBIL `0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f` (decimals 18)"],
  factory: [MX, "Both `factory()` = `0xC1e98D0A2a58fB8aBd10ccc30a58efff4080Aa21`"],
  "chain 143 + USDC": [MX, "chain id **143**, USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`"],
  "evidence block": [MX, "block **108,999,816**"],
  "readiness destination = router": [RD, "destination: \"0xFE951b693A2FE54BE5148614B109E316B567632F\""],
  "ABI token0": [HN, "{ name: \"token0\", type: \"function\", stateMutability: \"view\", inputs: [], outputs: [{ type: \"address\" }] }"],
  "ABI token1": [HN, "{ name: \"token1\", type: \"function\", stateMutability: \"view\", inputs: [], outputs: [{ type: \"address\" }] }"],
  "ABI fee": [HN, "{ name: \"fee\", type: \"function\", stateMutability: \"view\", inputs: [], outputs: [{ type: \"uint24\" }] }"],
  "ABI liquidity": [HN, "{ name: \"liquidity\", type: \"function\", stateMutability: \"view\", inputs: [], outputs: [{ type: \"uint128\" }] }"],
  "ABI factory": [HN, "{ name: \"factory\", type: \"function\", stateMutability: \"view\", inputs: [], outputs: [{ type: \"address\" }] }"],
  "ABI decimals": [HN, "{ name: \"decimals\", type: \"function\", stateMutability: \"view\", inputs: [], outputs: [{ type: \"uint8\" }] }"],
};
await check("SRC1 each recorded constant / ABI fragment cites an exact phrase present in the recorded source", () => {
  let skipped = false;
  for (const [fact, [file, phrase]] of Object.entries(SOURCES)) {
    const abs = path.join(REPO, file);
    if (!existsSync(abs)) { assert.ok(file.startsWith("_private/"), `${file} missing`); skipped = true; continue; }
    assert.ok(readFileSync(abs, "utf8").includes(phrase), `${fact}: phrase not found in ${file}`);
  }
  return skipped ? "SKIP" : undefined;
});
await check("SRC2 the code constants equal the cited values (no new fact)", () => {
  assert.equal(R.chainId, 143);
  assert.equal(R.evidenceBlock, 108999816);
  assert.equal(R.router, "0xFE951b693A2FE54BE5148614B109E316B567632F");
  assert.equal(R.pool, "0xb8700E0D0Df2B0b09A1374FbCdCC85E2E14F7898");
  assert.equal(R.token, "0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f");
  assert.equal(R.factory, "0xC1e98D0A2a58fB8aBd10ccc30a58efff4080Aa21");
  assert.equal(R.usdc, PROFILE.usdc.address);
  assert.deepEqual([R.fee, R.tokenDecimals, R.tokenSymbol], [3000, 18, "aBIL"]);
  // Nothing beyond the recorded surface: no quoter / price / slot0 / swap fragment exists.
  const names = [ABI.ABIL_POOL_VIEW_ABI, ABI.ABIL_ROUTER_VIEW_ABI, ABI.ERC20_DECIMALS_VIEW_ABI].flat().map((f) => f.name);
  assert.deepEqual(names, ["token0", "token1", "fee", "liquidity", "factory", "factory", "decimals"]);
  const all = Object.values(ABI).flat().map((f) => f.name);
  for (const n of ["slot0", "quoteExactInputSingle", "quoteExactInput", "exactInputSingle", "observe", "approve"]) assert.ok(!all.includes(n), `${n} is not vendored`);
});

// ── WHITELIST · RPC read-only ───────────────────────────────────────────────────────────────────────
await check("W1 a non-whitelisted method is refused before any transport call", async () => {
  let sent = 0;
  const reader = makeReadOnlyReader({ rpcUrl: URL_, fetchImpl: async () => { sent += 1; return { ok: true, json: async () => ({ result: "0x" }) }; }, now: () => NOW });
  for (const m of ["eth_sendRawTransaction", "eth_sendTransaction", "eth_sign", "eth_estimateGas", "eth_getBalance", "personal_sign", "anvil_setBalance"]) {
    await assert.rejects(reader.rpc(m, []), (e) => e.status === "method_not_read_only", m);
  }
  assert.equal(sent, 0);
  await reader.rpc("eth_chainId", []);
  assert.equal(sent, 1);
});
await check("W2 every vendored ABI fragment is view", () => {
  for (const [name, abi] of Object.entries(ABI)) for (const f of abi) assert.equal(f.stateMutability, "view", `${name}.${f.name}`);
});

// ── UNKNOWN INVARIANT · missing / stale / conflicting / unsupported ────────────────────────────────
await check("U1 missing → unknown: no rpc, no transport, no Piggy, no profile USDC, unreachable, no code", async () => {
  const cases = [
    [{ profile: PROFILE, piggyAddress: PIGGY }, "missing:no_rpc"],
    [{ profile: PROFILE, piggyAddress: PIGGY, rpcUrl: URL_ }, "missing:no_transport"],
    [{ ...world().input, piggyAddress: "nope" }, "missing:missing_piggy_address"],
    [{ ...world().input, profile: { ...PROFILE, usdc: null } }, "missing:profile_usdc_missing"],
    [{ ...world().input, fetchImpl: async () => { throw new Error("down"); } }, "missing:rpc_unreachable"],
    [world({ code: { [R.pool]: "0x" } }).input, "missing:no_code_at_pool"],
    [world({ code: { [R.router]: "0x" } }).input, "missing:no_code_at_router"],
    [world({ code: { [R.token]: "0x" } }).input, "missing:no_code_at_token"],
  ];
  for (const [input, reason] of cases) {
    const row = abilOf(await readSecondCurrent(input));
    assertUnknownInvariant(row, "missing");
    assert.equal(row.reason, reason);
  }
});
await check("U2 stale → unknown: RPC head below the recorded evidence block", async () => {
  const row = abilOf(await readSecondCurrent(world({ head: R.evidenceBlock - 1 }).input));
  assertUnknownInvariant(row, "stale");
  assert.equal(row.reason, "stale:rpc_head_behind_recorded_evidence");
  // At exactly the recorded block it is readable.
  assert.equal(abilOf(await readSecondCurrent(world({ head: R.evidenceBlock }).input)).status, S.ABIL_QUOTE_INCOMPLETE);
});
await check("U3 conflicting → unknown: chain, token0, token1, fee, pool/router factory, decimals, profile USDC", async () => {
  const cases = [
    [{ chainId: 1 }, "chain_differs_from_recorded"],
    [{ token0: OTHER }, "token0_differs_from_recorded"],
    [{ token1: OTHER }, "token1_differs_from_recorded"],
    [{ token0: R.usdc, token1: R.token }, "token0_differs_from_recorded"],
    [{ fee: 500 }, "fee_differs_from_recorded"],
    [{ poolFactory: OTHER }, "poolFactory_differs_from_recorded"],
    [{ routerFactory: OTHER }, "routerFactory_differs_from_recorded"],
    [{ decimals: 6 }, "tokenDecimals_differs_from_recorded"],
  ];
  for (const [over, reason] of cases) {
    const row = abilOf(await readSecondCurrent(world(over).input));
    assertUnknownInvariant(row, "conflicting");
    assert.equal(row.reason, `conflicting:${reason}`);
  }
  const usdc = abilOf(await readSecondCurrent({ ...world().input, profile: { ...PROFILE, usdc: { ...PROFILE.usdc, address: OTHER } } }));
  assertUnknownInvariant(usdc, "conflicting");
  assert.equal(usdc.reason, "conflicting:usdc_differs_from_recorded");
});
await check("U4 unsupported → unknown: a view reverts or answers undecodably", async () => {
  for (const name of ["token0", "fee", "poolFactory", "routerFactory", "decimals", "liquidity", "abilBalance"]) {
    for (const mode of ["revert", "garbage"]) {
      const row = abilOf(await readSecondCurrent(world({ [mode]: { [name]: true } }).input));
      assertUnknownInvariant(row, "unsupported");
      assert.equal(row.reason, "unsupported:unreadable_result", `${mode} ${name}`);
    }
  }
});
await check("U5 a full read still reports the quote as UNKNOWN (never a number)", async () => {
  const row = abilOf(await readSecondCurrent(world().input));
  assert.equal(row.read.quote.value, null);
  assert.equal(row.read.quote.status, "UNKNOWN");
  assert.ok(!("price" in row.read) && !("amountOut" in row.read) && !("rate" in row.read));
});

// ── NO-READY · no go / permission / execution / plan field ──────────────────────────────────────────
await check("N1 no READY / permission / execution / plan field in any aBIL row, read or unknown", async () => {
  const rows = [abilOf(await readSecondCurrent(world().input)), abilOf(await readSecondCurrent(world({ fee: 1 }).input)), abilOf(await readSecondCurrent({}))];
  for (const row of rows) {
    assert.deepEqual(forbiddenKeys(row), [], row.reason);
    const text = JSON.stringify(row);
    assert.ok(!/READY|"ready"|executionPermission|"plan"|"envelope"/.test(text), text);
  }
});

// ── A-710 decision core does not regress ────────────────────────────────────────────────────────────
await check("D1 A-710 decision core: aBIL decides unknown / action none, with or without a rule", async () => {
  const r = await readSecondCurrent(world().input);
  const SCOPE = { accountId: PIGGY, chainId: "monad-mainnet" };
  const EVENT = "a716-event-1";
  const bare = decideCurrentCandidates({ currentRead: r, scope: SCOPE, eventId: EVENT, nowIso: NOW });
  assert.equal(bare.length, r.candidates.length);
  const d = bare.find((x) => x.candidateId === "abil-spot");
  assert.deepEqual([d.decision, d.action, d.executionPermission], ["unknown", "none", false]);
  const rule = { kind: "agreed_rule", agreedBy: "user", eventId: EVENT, candidateId: "abil-spot", field: "abilRaw", comparator: "gte", expected: "1" };
  const ruled = decideCurrentCandidates({ currentRead: r, agreedRules: { "abil-spot": rule }, scope: SCOPE, eventId: EVENT, nowIso: NOW }).find((x) => x.candidateId === "abil-spot");
  assert.deepEqual([ruled.decision, ruled.action, ruled.executionPermission], ["unknown", "none", false]);
  assert.equal(ruled.receipt.decision, "unknown");
});

console.log(`\na716-abil-reader: ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
