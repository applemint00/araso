// [A-959] Fork grant assets = the fork profile asset table (A-955). Node only, network 0 (global fetch trapped; the A-949 Admin is an
// in-process fake speaking the real protocol, used through the REAL createForkAdminClient). Rows:
//   1 client allow-list = the rows of the fork profile asset table (no hard-coded asset names) · asset outside the table = bad_asset, 0 calls
//   2 the 4 table assets each reach the Admin once · repeat = noop · 2 concurrent first requests = 1 real top-up per asset
//   3 entry grant list = table ∩ ledger-keyable (ENTRY_ASSETS) · each once · repeat entry / 2 concurrent entries = 1 per asset
//   4 the A-949 Admin (private harness, skipped when absent): WETH / AUSD rows read from the same table, amounts = server config with the
//     A-959 defaults, the Public Guard section byte-equal to the pre-A-959 copy (no new public method).
// The real fork run (anvil, 4 assets on the chain) = _private/ops/harness/a949-fork-infra/a959-grant-run.mjs (receipt A959).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createInviteTable, createMemoryChallengeStore } from "../../api/_lib/fork-auth.js";
import { JOURNEY1, createForkEntryService } from "../../api/_lib/fork-entry.js";
import { createForkAdminClient, forkAssetTable, forkGrantAssets, isForkGrantAsset } from "../../api/_lib/fork-grant-client.js";
import { createMemoryForkLedgerStore } from "../../api/_lib/fork-ledger-store-contract.js";
import { ENTRY_ASSETS } from "../../api/_lib/fork-ledger-contract.js";
import { resolveChainProfile } from "../src/chain-profile.js";

let netCalls = 0;
globalThis.fetch = async () => { netCalls += 1; throw new Error("A-959 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String((e && e.message) || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const src = (f) => readFileSync(path.join(REPO, f), "utf8");
const code = (s) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\/.*$/gm, "");

const FORK_ID = "fork-143-110874000-20261010t000000z-a959a959";
const APP_ORIGIN = "http://localhost:5173";
const TOKEN = "local-test-invite-0959";
const PIGGY = privateKeyToAccount(`0x${"c3".repeat(32)}`);
const P = PIGGY.address.toLowerCase();
const GRANT = { MON: 5n * 10n ** 18n, USDC: 10n * 10n ** 6n, WETH: 15n * 10n ** 17n, AUSD: 150n * 10n ** 6n }; // = A-959 Admin defaults

function fakeAdmin({ token = "admin-token-0123456789abcdef", delayMs = 5 } = {}) {
  const st = { instance: FORK_ID, topups: new Map(), balance: new Map(), realTopups: 0, perAsset: {}, calls: [], chain: Promise.resolve() };
  const fetchImpl = async (url, init = {}) => {
    st.calls.push(url);
    const u = new URL(url);
    const json = (status, body) => ({ status, json: async () => body });
    if (init.headers?.authorization !== `Bearer ${token}`) return json(401, { error: "unauthorized" });
    if (u.pathname === "/admin/instance") return json(200, { ready: true, meta: { forkInstanceId: st.instance, parentBlockNumber: 110874000, chainId: 31337143 } });
    if (u.pathname === "/admin/topup") {
      const b = JSON.parse(init.body);
      const run = async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        if (!Object.prototype.hasOwnProperty.call(GRANT, b.asset)) return json(400, { error: "asset" });
        const key = `${st.instance}|${b.piggyAddress.toLowerCase()}|${b.asset}|${b.grantVersion}`;
        if (st.topups.has(key)) return json(200, { noop: true, key, record: st.topups.get(key) });
        st.realTopups += 1; st.perAsset[b.asset] = (st.perAsset[b.asset] || 0) + 1;
        const bk = `${b.piggyAddress.toLowerCase()}|${b.asset}`;
        st.balance.set(bk, (st.balance.get(bk) || 0n) + GRANT[b.asset]);
        const record = { key, forkInstanceId: st.instance, piggyAddress: b.piggyAddress, asset: b.asset, grantVersion: b.grantVersion, amountRaw: GRANT[b.asset].toString() };
        st.topups.set(key, record);
        return json(200, { noop: false, key, record });
      };
      const p = st.chain.then(run, run); st.chain = p.catch(() => {}); return p;
    }
    return json(404, { error: "unknown" });
  };
  return { st, client: createForkAdminClient({ url: "http://127.0.0.1:47959", token, fetchImpl }) };
}

// ── 1 ──
await check("1 allowed assets = the fork profile asset table rows (A-955): USDC · MON · WETH · AUSD, same object rows", async () => {
  const table = resolveChainProfile("monad-fork", { rpcUrl: "https://x.invalid", forkInstanceId: "a959" }).assets;
  assert.deepEqual([...forkGrantAssets()], Object.keys(table));
  assert.deepEqual([...forkGrantAssets()].sort(), ["AUSD", "MON", "USDC", "WETH"]);
  assert.equal(forkAssetTable(), table, "the same frozen table object (read, not copied)");
  assert.equal(forkAssetTable().WETH.address, "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242");
  assert.equal(forkAssetTable().AUSD.address, "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a");
  for (const a of ["MON", "USDC", "WETH", "AUSD"]) assert.equal(isForkGrantAsset(a), true, a);
});
await check("1 no asset names hard-coded in the client: its code (comments stripped) holds no MON/USDC/WETH/AUSD literal", async () => {
  assert.doesNotMatch(code(src("api/_lib/fork-grant-client.js")), /["'](MON|USDC|WETH|AUSD)["']/);
});
await check("1 asset outside the table = bad_asset before any Admin call (case, prototype names, shares, other tokens, non-strings)", async () => {
  const A = fakeAdmin();
  for (const asset of ["DAI", "weth", "Ausd", "shMON", "k3WETH", "earnAUSD", "WMON", "USDT0", "toString", "__proto__", "constructor", "hasOwnProperty", "", " WETH", null, undefined, 1, {}, ["WETH"]]) {
    const r = await A.client.topup({ piggyAddress: PIGGY.address, asset, grantVersion: "a959-g1" });
    assert.deepEqual(r, { ok: false, reason: "bad_asset" }, JSON.stringify(asset));
  }
  assert.equal(A.st.calls.length, 0, "no Admin call for a refused asset");
});

// ── 2 ──
await check("2 the 4 table assets: 2 concurrent first top-ups = 1 real each · then repeat + 2 concurrent = noop · balance = 1 grant", async () => {
  const A = fakeAdmin();
  for (const asset of ["MON", "USDC", "WETH", "AUSD"]) {
    const [x, y] = await Promise.all([0, 1].map(() => A.client.topup({ piggyAddress: PIGGY.address, asset, grantVersion: "a959-g1" })));
    assert.equal(x.ok && y.ok, true, asset);
    assert.deepEqual([x.noop, y.noop].sort(), [false, true], `${asset} first race`);
    assert.equal(x.key, y.key); assert.equal(x.key, `${FORK_ID}|${P}|${asset}|a959-g1`);
    const z = await A.client.topup({ piggyAddress: PIGGY.address, asset, grantVersion: "a959-g1" });
    const w = await Promise.all([0, 1].map(() => A.client.topup({ piggyAddress: PIGGY.address, asset, grantVersion: "a959-g1" })));
    assert.equal(z.noop, true); assert.equal(w.every((r) => r.ok && r.noop), true);
    assert.equal(A.st.perAsset[asset], 1, `${asset} real top-ups`);
    assert.equal(A.st.balance.get(`${P}|${asset}`), GRANT[asset]);
    assert.equal(x.amountRaw, GRANT[asset].toString());
  }
  assert.equal(A.st.realTopups, 4);
  const v2 = await A.client.topup({ piggyAddress: PIGGY.address, asset: "WETH", grantVersion: "a959-g2" });
  assert.equal(v2.noop, false, "a new grantVersion = a new key");
});

// ── 3 ──
const shmon = parseAbi(["function deposit(uint256 assets, address receiver) payable returns (uint256)", "function redeem(uint256 shares, address receiver, address owner) returns (uint256)"]);
const h = (n) => `0x${n.toString(16).padStart(64, "0")}`;
function testnet(who) {
  const txs = new Map();
  const add = (hash, input, block) => txs.set(hash, { tx: { hash, from: who, to: JOURNEY1.target, input, chainId: "0x279f" }, rc: { transactionHash: hash, from: who, to: JOURNEY1.target, status: "0x1", blockNumber: `0x${block.toString(16)}` } });
  add(h(1), encodeFunctionData({ abi: shmon, functionName: "deposit", args: [1n, who] }), 100);
  add(h(2), encodeFunctionData({ abi: shmon, functionName: "redeem", args: [1n, who, who] }), 101);
  const rpc = async (method, params) => {
    if (method === "eth_chainId") return "0x279f";
    const t = txs.get(String(params[0]).toLowerCase());
    return method === "eth_getTransactionByHash" ? (t ? t.tx : null) : t ? t.rc : null;
  };
  return { rpc, journey1: { depositTxHash: h(1), redeemTxHash: h(2) } };
}
function entrySetup(config = {}) {
  const A = fakeAdmin();
  const T = testnet(PIGGY.address);
  const svc = createForkEntryService({ config: { invites: createInviteTable([TOKEN]), appOrigin: APP_ORIGIN, grantVersion: "a959-g1", ...config }, store: createMemoryForkLedgerStore(), challenges: createMemoryChallengeStore(), admin: A.client, testnetRpc: T.rpc });
  const enter = async () => {
    const c = await svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
    assert.equal(c.ok, true, c.reason);
    return svc.enter({ inviteToken: TOKEN, nonce: c.nonce, signature: await PIGGY.signMessage({ message: c.message }), piggyAddress: PIGGY.address, journey1: T.journey1 });
  };
  return { A, svc, enter };
}
const EXPECTED_ENTRY = ENTRY_ASSETS.filter((a) => isForkGrantAsset(a));
await check(`3 entry grants = table ∩ ledger-keyable, ENTRY_ASSETS order (today: ${EXPECTED_ENTRY.join(" ")}) · each once`, async () => {
  assert.ok(EXPECTED_ENTRY.length >= 2 && EXPECTED_ENTRY.includes("MON") && EXPECTED_ENTRY.includes("USDC"));
  const S = entrySetup();
  const r = await S.enter();
  assert.equal(r.allowed, true, r.reason);
  assert.deepEqual(r.grants.map((g) => [g.asset, g.amountRaw, g.noop]), EXPECTED_ENTRY.map((a) => [a, GRANT[a].toString(), false]));
  for (const a of EXPECTED_ENTRY) assert.equal(S.A.st.perAsset[a], 1, a);
  assert.equal(S.A.st.realTopups, EXPECTED_ENTRY.length);
});
await check("3 repeat entry (new challenge) and 2 concurrent entries = still 1 real top-up per asset", async () => {
  const S = entrySetup();
  const [a, b] = await Promise.all([S.enter(), S.enter()]);
  assert.equal(a.allowed && b.allowed, true, `${a.reason} ${b.reason}`);
  const r = await S.enter();
  assert.equal(r.allowed, true); assert.equal(r.grants.every((g) => g.noop === true), true, "third entry = noop");
  for (const x of EXPECTED_ENTRY) assert.equal(S.A.st.perAsset[x], 1, x);
  assert.equal(S.A.st.realTopups, EXPECTED_ENTRY.length);
});
await check("3 config.grantAssets cannot add an asset outside the table or the ledger (DAI / shMON / lower-case dropped, never sent)", async () => {
  const S = entrySetup({ grantAssets: ["DAI", "shMON", "weth", "USDC"] });
  const r = await S.enter();
  assert.equal(r.allowed, true, r.reason);
  assert.deepEqual(r.grants.map((g) => g.asset), ["USDC"]);
  assert.deepEqual(Object.keys(S.A.st.perAsset), ["USDC"]);
});

// ── 4 ── (private harness; a public checkout has none)
const INFRA = path.join(REPO, "_private/ops/harness/a949-fork-infra/fork-infra.mjs");
const PRE = path.join(REPO, "_private/wt/a959d/pre/fork-infra.mjs");
if (existsSync(INFRA)) {
  const infra = readFileSync(INFRA, "utf8");
  await check("4 Admin: asset rows read from the fork asset table · A-959 defaults WETH 1.5e18 / AUSD 150e6 · amounts overridable by server env", async () => {
    assert.match(infra, /import \{ forkAssetTable \} from "\.\.\/\.\.\/\.\.\/\.\.\/api\/_lib\/fork-grant-client\.js"/);
    assert.match(infra, /GRANT_DEFAULTS = Object\.freeze\(\{ MON: 5n \* 10n \*\* 18n, USDC: 10n \* 10n \*\* 6n, WETH: 15n \* 10n \*\* 17n, AUSD: 150n \* 10n \*\* 6n \}\)/);
    assert.match(infra, /process\.env\[`A949_GRANT_\$\{asset\}_RAW`\]/);
    assert.equal(15n * 10n ** 17n, GRANT.WETH); assert.equal(150n * 10n ** 6n, GRANT.AUSD);
    assert.doesNotMatch(code(infra), /0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242|0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a/i, "no WETH/AUSD address copied into the harness");
  });
  await check("4 Admin boundary unchanged: Public Guard section byte-equal to the pre-A-959 copy · Admin still 127.0.0.1 + bearer", async () => {
    const section = (s) => s.slice(s.indexOf("// ── Public Guard"), s.indexOf("// ── Admin (127.0.0.1, bearer token)"));
    if (existsSync(PRE)) assert.equal(section(infra), section(readFileSync(PRE, "utf8")));
    assert.ok(section(infra).length > 1000);
    assert.match(infra, /s\.listen\(port, "127\.0\.0\.1"/);
    assert.match(infra, /if \(!tokenOk\(request\.headers\.authorization\)\) \{ send\(401/);
  });
} else console.log("SKIP  4 (no _private harness in this checkout)");

await check("network 0", async () => { assert.equal(netCalls, 0); });
console.log(`\nA-959 fork grant assets: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
