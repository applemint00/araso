// [A-956] Journey 2 entry — server side. Node only, network 0 (global fetch trapped; testnet RPC + A-949 Admin are in-process fakes that
// speak the same protocol). Card success_criteria rows: tester proof (challenge · 2 min · single use · other-Piggy signature refused) ·
// Journey 1 read by the server (forged client receipt refused) · entry putIfAbsent · MON + USDC top-up once (repeat + 2 concurrent = 1) ·
// re-check (status: no entry / other instance / expired) · E MUST (testerId from auth, campaign from config, steps from the registry,
// evidence from the fork RPC, rewards only via rewardLedgerApply's record, verdict → reward in one request, no payout) · route hygiene
// (no Admin URL/token in answers, unexpected fields 400, cross-site refused) · Admin client loopback-only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto"; // [A-983] sha256 pin for the grant.js baseline
import { existsSync, readFileSync } from "node:fs"; // [A-960 re-pin] + existsSync
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FORK_CHALLENGE_TTL_MS, createInviteTable, createMemoryChallengeStore, challengeMessage } from "../../api/_lib/fork-auth.js";
import { JOURNEY1, createForkEntryService, verifyJourney1 } from "../../api/_lib/fork-entry.js";
import { adminOrigin, createForkAdminClient, forkAdminClientFromEnv } from "../../api/_lib/fork-grant-client.js";
import { createMemoryForkLedgerStore, isForkLedgerStore } from "../../api/_lib/fork-ledger-store-contract.js";
import { KIND, entryRecord, topupRecord } from "../../api/_lib/fork-ledger-contract.js";
import { createForkEntryHandler, forkEntryOriginProblem, localForkEntryServiceFromEnv } from "../../api/fork-entry.js";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

let netCalls = 0;
globalThis.fetch = async () => { netCalls += 1; throw new Error("A-956 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String((e && e.message) || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const src = (f) => readFileSync(path.join(REPO, f), "utf8");

// ── fixtures ──
const PIGGY = privateKeyToAccount(`0x${"a1".repeat(32)}`);
const OTHER = privateKeyToAccount(`0x${"b2".repeat(32)}`);
const P = PIGGY.address.toLowerCase();
const Q = OTHER.address.toLowerCase();
const TOKEN = "local-test-invite-0001"; // test-only literal (the real local token comes from env and is never committed)
const TOKEN2 = "local-test-invite-0002";
const shmon = parseAbi(["function deposit(uint256 assets, address receiver) payable returns (uint256)", "function redeem(uint256 shares, address receiver, address owner) returns (uint256)"]);
const h = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const FORK_ID = "fork-143-110874000-20261010t000000z-a956a956";
const FORK_ID_2 = "fork-143-110874000-20261010t000100z-b956b956";
const APP_ORIGIN = "http://localhost:5173"; // server config: the app origin named in the challenge

function testnetChain() {
  const txs = new Map();
  let chain = "0x279f";
  const add = (hash, { from, to = JOURNEY1.target, input, status = "0x1", block = 100, chainId = "0x279f" }) => {
    txs.set(hash, { tx: { hash, from, to, input, chainId }, rc: { transactionHash: hash, from, to, status, blockNumber: `0x${block.toString(16)}` } });
  };
  const rpc = async (method, params) => {
    if (method === "eth_chainId") return chain;
    const t = txs.get(String(params[0]).toLowerCase());
    if (method === "eth_getTransactionByHash") return t ? t.tx : null;
    if (method === "eth_getTransactionReceipt") return t ? t.rc : null;
    throw new Error("unexpected method");
  };
  return { rpc, add, txs, setChain: (c) => { chain = c; } };
}
const depositInput = (receiver) => encodeFunctionData({ abi: shmon, functionName: "deposit", args: [10n ** 17n, receiver] });
const redeemInput = (receiver, owner) => encodeFunctionData({ abi: shmon, functionName: "redeem", args: [10n ** 17n, receiver, owner] });
function journey1For(t, who, base) {
  t.add(h(base), { from: who, input: depositInput(who), block: 100 });
  t.add(h(base + 1), { from: who, input: redeemInput(who, who), block: 101 });
  return { depositTxHash: h(base), redeemTxHash: h(base + 1) };
}

// A fake A-949 Admin speaking the real protocol (GET /admin/instance · POST /admin/topup), serialized + idempotent per key, used through
// the REAL createForkAdminClient (fetchImpl injected). Counts real top-ups and keeps balances.
function fakeAdmin({ token = "admin-token-0123456789abcdef", delayMs = 5 } = {}) {
  const st = { instance: FORK_ID, start: 110874000, topups: new Map(), balance: new Map(), realTopups: 0, calls: [], chain: Promise.resolve() };
  const GRANT = { MON: 5n * 10n ** 18n, USDC: 100n * 10n ** 6n, WETH: 15n * 10n ** 17n, AUSD: 150n * 10n ** 6n }; // pre-A-959: MON + USDC only (A-959 ① entry = 4 assets; WETH 1.5 · AUSD 150 = A-949 harness defaults)
  const fetchImpl = async (url, init = {}) => {
    st.calls.push({ url, auth: init.headers?.authorization || null });
    const u = new URL(url);
    const json = (status, body) => ({ status, json: async () => body });
    if (init.headers?.authorization !== `Bearer ${token}`) return json(401, { error: "unauthorized" });
    if (u.pathname === "/admin/instance") return json(200, { ready: true, meta: { forkInstanceId: st.instance, parentBlockNumber: st.start, chainId: 31337143 } });
    if (u.pathname === "/admin/topup") {
      const b = JSON.parse(init.body);
      const run = async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        const key = `${st.instance}|${b.piggyAddress.toLowerCase()}|${b.asset}|${b.grantVersion}`;
        if (st.topups.has(key)) return json(200, { noop: true, key, record: st.topups.get(key) });
        st.realTopups += 1;
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
  const client = createForkAdminClient({ url: "http://127.0.0.1:47999", token, fetchImpl });
  return { st, client, token, fetchImpl };
}

function setup({ now = () => Date.now(), config = {}, forkRpc = null } = {}) {
  const t = testnetChain();
  const A = fakeAdmin();
  const store = createMemoryForkLedgerStore();
  const challenges = createMemoryChallengeStore();
  const svc = createForkEntryService({ config: { invites: createInviteTable([TOKEN, TOKEN2]), appOrigin: APP_ORIGIN, grantVersion: "a956-g1", ...config }, store, challenges, admin: A.client, testnetRpc: t.rpc, forkRpc, now });
  return { t, A, store, challenges, svc };
}
async function signedEnter(S, { account = PIGGY, piggy = account.address, signer = account, token = TOKEN, journey1 } = {}) {
  const c = await S.svc.challenge({ inviteToken: token, piggyAddress: piggy });
  assert.equal(c.ok, true, `challenge ${c.reason}`);
  const signature = await signer.signMessage({ message: c.message });
  return S.svc.enter({ inviteToken: token, nonce: c.nonce, signature, piggyAddress: piggy, journey1 });
}

// ── 1) tester proof ──
await check("1 tester proof: challenge text = server template for this Piggy/tester/fork; nonce 128-bit; expires in exactly 2 minutes", async () => {
  const S = setup({ now: () => 1_700_000_000_000 });
  const c = await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
  assert.equal(c.ok, true); assert.match(c.nonce, /^[0-9a-f]{32}$/);
  assert.equal(c.expiresAt - 1_700_000_000_000, FORK_CHALLENGE_TTL_MS); assert.equal(FORK_CHALLENGE_TTL_MS, 120000);
  const lines = c.message.split("\n");
  assert.equal(lines.length, 8);
  assert.equal(lines[0], "Araso Journey 2 entry"); assert.equal(lines[1], `uri: ${APP_ORIGIN}`); assert.equal(lines[2], "chainId: 31337143");
  assert.equal(lines[3], `piggy: ${P}`); assert.match(lines[4], /^tester: tester-[0-9a-f]{16}$/);
  assert.equal(lines[5], `fork: ${FORK_ID}`); assert.equal(lines[6], `nonce: ${c.nonce}`);
  assert.equal(c.message.includes(TOKEN), false, "the invite token never appears in the challenge");
});
await check("1 testerId only from the server-config invite token: unknown / missing / short token = 401 not_invited; two tokens = two testers", async () => {
  const S = setup();
  for (const tok of [undefined, null, "", "short", "local-test-invite-9999", `${TOKEN} `]) {
    const c = await S.svc.challenge({ inviteToken: tok, piggyAddress: PIGGY.address });
    assert.equal(c.ok, false); assert.equal(c.status, 401); assert.equal(c.reason, "not_invited");
  }
  const inv = createInviteTable([TOKEN, TOKEN2]);
  assert.notEqual(inv.testerFor(TOKEN), inv.testerFor(TOKEN2)); assert.equal(inv.testerFor(TOKEN), createInviteTable([TOKEN]).testerFor(TOKEN), "stable id");
  // a body testerId is not even a parameter: the service ignores it
  const c = await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address, testerId: "tester-forged" });
  assert.equal(c.message.includes("tester-forged"), false);
});
await check("1 replay: the same nonce + valid signature twice → the second is refused (single use); top-up stays 1 per asset", async () => {
  const S = setup();
  const j1 = journey1For(S.t, P, 1000);
  const c = await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
  const signature = await PIGGY.signMessage({ message: c.message });
  const a = await S.svc.enter({ inviteToken: TOKEN, nonce: c.nonce, signature, piggyAddress: PIGGY.address, journey1: j1 });
  const b = await S.svc.enter({ inviteToken: TOKEN, nonce: c.nonce, signature, piggyAddress: PIGGY.address, journey1: j1 });
  assert.equal(a.allowed, true); assert.equal(b.allowed, false); assert.equal(b.reason, "unknown_or_used_nonce");
  assert.equal(S.A.st.realTopups, 4); // pre-A-959: 2 (MON + USDC)
});
await check("1 expiry: a signature presented after 2 minutes is refused (and the nonce is gone afterwards)", async () => {
  let t = 1_700_000_000_000;
  const S = setup({ now: () => t });
  const j1 = journey1For(S.t, P, 1100);
  const c = await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
  const signature = await PIGGY.signMessage({ message: c.message });
  t += FORK_CHALLENGE_TTL_MS;
  const r = await S.svc.enter({ inviteToken: TOKEN, nonce: c.nonce, signature, piggyAddress: PIGGY.address, journey1: j1 });
  assert.equal(r.allowed, false); assert.equal(r.reason, "challenge_expired"); assert.equal(S.challenges.size(), 0); assert.equal(S.A.st.realTopups, 0);
});
await check("1 another Piggy's signature is refused (signer_not_piggy); claiming another Piggy's challenge is refused (piggy_mismatch)", async () => {
  const S = setup();
  const j1 = journey1For(S.t, P, 1200);
  const r1 = await signedEnter(S, { account: PIGGY, signer: OTHER, journey1: j1 });
  assert.equal(r1.allowed, false); assert.equal(r1.reason, "signer_not_piggy");
  const c = await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
  const sigQ = await OTHER.signMessage({ message: c.message });
  const r2 = await S.svc.enter({ inviteToken: TOKEN, nonce: c.nonce, signature: sigQ, piggyAddress: OTHER.address, journey1: j1 });
  assert.equal(r2.allowed, false); assert.equal(r2.reason, "piggy_mismatch");
  // a challenge made for tester A presented with tester B's token
  const c2 = await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
  const r3 = await S.svc.enter({ inviteToken: TOKEN2, nonce: c2.nonce, signature: await PIGGY.signMessage({ message: c2.message }), piggyAddress: PIGGY.address, journey1: j1 });
  assert.equal(r3.allowed, false); assert.equal(r3.reason, "tester_mismatch");
  // a signature over a DIFFERENT text (e.g. the client edited the message) does not recover to the Piggy
  const c3 = await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
  const r4 = await S.svc.enter({ inviteToken: TOKEN, nonce: c3.nonce, signature: await PIGGY.signMessage({ message: c3.message.replace(FORK_ID, FORK_ID_2) }), piggyAddress: PIGGY.address, journey1: j1 });
  assert.equal(r4.reason, "signer_not_piggy");
  for (const [a, b] of [[`uri: ${APP_ORIGIN}`, "uri: https://evil.example"], ["chainId: 31337143", "chainId: 143"]]) {
    const cx = await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
    const rx = await S.svc.enter({ inviteToken: TOKEN, nonce: cx.nonce, signature: await PIGGY.signMessage({ message: cx.message.replace(a, b) }), piggyAddress: PIGGY.address, journey1: j1 });
    assert.equal(rx.reason, "signer_not_piggy", `${b}: a signature for another origin/chain is not this challenge's`);
  }
  for (const bad of ["", "0x", `0x${"00".repeat(65)}`, 123, null]) {
    const c4 = await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
    const r5 = await S.svc.enter({ inviteToken: TOKEN, nonce: c4.nonce, signature: bad, piggyAddress: PIGGY.address, journey1: j1 });
    assert.equal(r5.allowed, false, String(bad));
  }
  assert.equal(S.A.st.realTopups, 0);
});

// ── 2) Journey 1 read by the server ──
await check("2 Journey 1 = the server's own 10143 read: from = Piggy · to = shMON · status 1 · deposit→redeem shape · order", async () => {
  const t = testnetChain();
  const ok = journey1For(t, P, 2000);
  assert.deepEqual(await verifyJourney1({ rpc: t.rpc, piggyAddress: P, ...ok }), { ok: true, depositTxHash: ok.depositTxHash, redeemTxHash: ok.redeemTxHash, blockNumber: "101" });
  const cases = [
    ["journey1_not_from_piggy", (b) => t.add(h(b), { from: Q, input: depositInput(P) })],
    ["journey1_wrong_target", (b) => t.add(h(b), { from: P, to: `0x${"cd".repeat(20)}`, input: depositInput(P) })],
    ["journey1_tx_failed", (b) => t.add(h(b), { from: P, input: depositInput(P), status: "0x0" })],
    ["journey1_wrong_shape", (b) => t.add(h(b), { from: P, input: redeemInput(P, P) })],
    ["journey1_wrong_shape", (b) => t.add(h(b), { from: P, input: depositInput(Q) })],
    ["journey1_wrong_chain", (b) => t.add(h(b), { from: P, input: depositInput(P), chainId: "0x8f" })],
    ["journey1_tx_not_found", () => {}],
  ];
  let n = 3000;
  for (const [reason, mk] of cases) {
    mk(n); t.add(h(n + 1), { from: P, input: redeemInput(P, P), block: 101 });
    const r = await verifyJourney1({ rpc: t.rpc, piggyAddress: P, depositTxHash: h(n), redeemTxHash: h(n + 1) });
    assert.equal(r.ok, false, reason); assert.equal(r.reason, reason); n += 10;
  }
  t.add(h(4000), { from: P, input: depositInput(P), block: 200 }); t.add(h(4001), { from: P, input: redeemInput(P, P), block: 150 });
  assert.equal((await verifyJourney1({ rpc: t.rpc, piggyAddress: P, depositTxHash: h(4000), redeemTxHash: h(4001) })).reason, "journey1_wrong_order");
  t.add(h(4010), { from: P, input: depositInput(P) }); t.add(h(4011), { from: P, input: redeemInput(P, Q) });
  assert.equal((await verifyJourney1({ rpc: t.rpc, piggyAddress: P, depositTxHash: h(4010), redeemTxHash: h(4011) })).reason, "journey1_wrong_shape");
  assert.equal((await verifyJourney1({ rpc: t.rpc, piggyAddress: P, depositTxHash: ok.depositTxHash, redeemTxHash: ok.depositTxHash })).reason, "journey1_pointer_invalid");
  t.setChain("0x8f");
  assert.equal((await verifyJourney1({ rpc: t.rpc, piggyAddress: P, ...ok })).reason, "journey1_wrong_chain", "an RPC that is not 10143");
  assert.equal((await verifyJourney1({ rpc: async () => { throw new Error("down"); }, piggyAddress: P, ...ok })).reason, "journey1_rpc_unavailable");
});
await check("2 forged client receipt refused: hashes that do not exist on 10143, or that belong to another Piggy, admit nothing and top up nothing", async () => {
  const S = setup();
  const forged = { depositTxHash: h(0xdead), redeemTxHash: h(0xbeef), status: "success", from: P, to: JOURNEY1.target, chainId: 10143 };
  const r1 = await signedEnter(S, { journey1: forged });
  assert.equal(r1.allowed, false); assert.equal(r1.reason, "journey1_tx_not_found");
  const theirs = journey1For(S.t, Q, 5000); // a real Journey 1 — of ANOTHER Piggy
  const r2 = await signedEnter(S, { journey1: theirs });
  assert.equal(r2.allowed, false); assert.equal(r2.reason, "journey1_not_from_piggy");
  assert.equal(S.A.st.realTopups, 0); assert.deepEqual(await S.store.list("entries"), []);
});

// ── 3) entry + top-up once ──
await check("3 allowed → entry row (putIfAbsent, canonical) + MON and USDC once each; answer = allowed + forkScope + forkInstanceId", async () => {
  const S = setup();
  const j1 = journey1For(S.t, P, 6000);
  const r = await signedEnter(S, { journey1: j1 });
  assert.equal(r.allowed, true); assert.equal(r.forkScope, "monad-fork"); assert.equal(r.forkInstanceId, FORK_ID);
  assert.deepEqual(r.grants.map((g) => [g.asset, g.amountRaw, g.noop]), [["MON", "5000000000000000000", false], ["USDC", "100000000", false], ["WETH", "1500000000000000000", false], ["AUSD", "150000000", false]]); // pre-A-959: MON + USDC
  const rows = await S.store.list("entries");
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, KIND.ENTRY); assert.equal(rows[0].piggyAddress, P); assert.equal(rows[0].journey1ChainId, "10143");
  assert.equal(rows[0].journey1DepositTxHash, j1.depositTxHash); assert.match(rows[0].testerId, /^tester-[0-9a-f]{16}$/);
  assert.equal((await S.store.list("topups")).length, 4); // pre-A-959: 2 (MON + USDC)
  assert.equal(S.A.st.realTopups, 4); assert.equal(S.A.st.balance.get(`${P}|MON`), 5n * 10n ** 18n); assert.equal(S.A.st.balance.get(`${P}|USDC`), 10n ** 8n); // pre-A-959: 2 (MON + USDC)
});
await check("3 same request repeated (new challenge each time) ×3 → still exactly 1 top-up per asset (noop answers)", async () => {
  const S = setup();
  const j1 = journey1For(S.t, P, 6100);
  for (let i = 0; i < 3; i += 1) assert.equal((await signedEnter(S, { journey1: j1 })).allowed, true);
  assert.equal(S.A.st.realTopups, 4); assert.equal(S.A.st.balance.get(`${P}|USDC`), 10n ** 8n); // pre-A-959: 2 (MON + USDC)
});
await check("3 two CONCURRENT entries (first grant race) → exactly 1 top-up per asset; balances = one grant", async () => {
  const S = setup();
  const j1 = journey1For(S.t, P, 6200);
  const cs = await Promise.all([0, 1].map(() => S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address })));
  const sigs = await Promise.all(cs.map((c) => PIGGY.signMessage({ message: c.message })));
  const rs = await Promise.all(cs.map((c, i) => S.svc.enter({ inviteToken: TOKEN, nonce: c.nonce, signature: sigs[i], piggyAddress: PIGGY.address, journey1: j1 })));
  assert.deepEqual(rs.map((r) => r.allowed), [true, true]);
  assert.equal(S.A.st.realTopups, 4); assert.equal(S.A.st.balance.get(`${P}|MON`), 5n * 10n ** 18n); assert.equal(S.A.st.balance.get(`${P}|USDC`), 10n ** 8n); // pre-A-959: 2 (MON + USDC)
  assert.equal((await S.store.list("topups")).length, 4); assert.equal((await S.store.list("entries")).length, 1); // pre-A-959: 2 (MON + USDC)
  // two SEPARATE service processes (no shared in-process single flight) racing on one Admin → the Admin key still gives 1 top-up
  const S2 = setup(); const j2 = journey1For(S2.t, P, 6300);
  const svcB = createForkEntryService({ config: { invites: createInviteTable([TOKEN]), appOrigin: APP_ORIGIN, grantVersion: "a956-g1" }, store: createMemoryForkLedgerStore(), challenges: S2.challenges, admin: S2.A.client, testnetRpc: S2.t.rpc });
  const c1 = await S2.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address }); const c2 = await svcB.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
  const [x, y] = await Promise.all([S2.svc.enter({ inviteToken: TOKEN, nonce: c1.nonce, signature: await PIGGY.signMessage({ message: c1.message }), piggyAddress: PIGGY.address, journey1: j2 }), svcB.enter({ inviteToken: TOKEN, nonce: c2.nonce, signature: await PIGGY.signMessage({ message: c2.message }), piggyAddress: PIGGY.address, journey1: j2 })]);
  assert.equal(x.allowed && y.allowed, true); assert.equal(S2.A.st.realTopups, 4); // pre-A-959: 2 (MON + USDC)
});
await check("3 one Piggy per tester per fork instance: the same invite with a second Piggy is refused; a new grantVersion/instance = a new key", async () => {
  const S = setup();
  assert.equal((await signedEnter(S, { journey1: journey1For(S.t, P, 6400) })).allowed, true);
  const r = await signedEnter(S, { account: OTHER, journey1: journey1For(S.t, Q, 6500) });
  assert.equal(r.allowed, false); assert.equal(r.reason, "tester_bound_to_other_piggy");
  assert.equal(S.A.st.realTopups, 4, "the second Piggy got nothing"); // pre-A-959: 2 (MON + USDC)
  const a = topupRecord({ forkInstanceId: FORK_ID, piggyAddress: P, asset: "usdc", grantVersion: "a956-g1", testerId: "t1", amountRaw: "10" });
  const b = topupRecord({ forkInstanceId: FORK_ID_2, piggyAddress: P, asset: "USDC", grantVersion: "a956-g1", testerId: "t1", amountRaw: "10" });
  const c = topupRecord({ forkInstanceId: FORK_ID, piggyAddress: P, asset: "USDC", grantVersion: "a956-g2", testerId: "t1", amountRaw: "10" });
  assert.equal(a.ok && b.ok && c.ok, true); assert.equal(new Set([a.key, b.key, c.key]).size, 3); assert.equal(a.record.asset, "USDC");
  assert.equal(topupRecord({ forkInstanceId: FORK_ID, piggyAddress: P, asset: "ETH", grantVersion: "g", testerId: "t", amountRaw: "1" }).ok, false);
  assert.equal(entryRecord({ forkInstanceId: FORK_ID, testerId: "t", piggyAddress: P, journey1DepositTxHash: h(1), journey1RedeemTxHash: h(1), journey1BlockNumber: 1 }).ok, false, "deposit = redeem refused");
});
await check("3 fork instance changed between challenge and enter → refused, reenter; Admin down → 503, nothing granted", async () => {
  const S = setup();
  const j1 = journey1For(S.t, P, 6600);
  const c = await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
  S.A.st.instance = FORK_ID_2;
  const r = await S.svc.enter({ inviteToken: TOKEN, nonce: c.nonce, signature: await PIGGY.signMessage({ message: c.message }), piggyAddress: PIGGY.address, journey1: j1 });
  assert.equal(r.allowed, false); assert.equal(r.reason, "fork_instance_changed"); assert.equal(r.reenter, true); assert.equal(S.A.st.realTopups, 0);
  const down = createForkEntryService({ config: { invites: createInviteTable([TOKEN]), appOrigin: APP_ORIGIN, grantVersion: "a956-g1" }, store: createMemoryForkLedgerStore(), challenges: createMemoryChallengeStore(), admin: createForkAdminClient({ url: "http://127.0.0.1:47999", token: "admin-token-0123456789abcdef", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } }), testnetRpc: S.t.rpc });
  const d = await down.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address });
  assert.equal(d.ok, false); assert.equal(d.status, 503);
});

// ── 6) re-check ──
await check("6 status (re-entry re-check): entered = allowed; other instance = refused + reenter; no entry / other Piggy / expired = refused", async () => {
  let t = 1_700_000_000_000;
  const S = setup({ now: () => t, config: { entryNotAfter: 1_700_000_500_000 } });
  const st = (over = {}) => S.svc.status({ inviteToken: TOKEN, piggyAddress: PIGGY.address, forkInstanceId: FORK_ID, ...over });
  assert.deepEqual([(await st()).allowed, (await st()).reason], [false, "no_entry"]);
  assert.equal((await signedEnter(S, { journey1: journey1For(S.t, P, 7000) })).allowed, true);
  assert.equal((await st()).allowed, true);
  assert.equal((await st({ piggyAddress: OTHER.address })).reason, "piggy_mismatch");
  assert.equal((await st({ inviteToken: TOKEN2 })).reason, "no_entry");
  assert.equal((await st({ inviteToken: "nope-nope-nope-nope" })).status, 401);
  const old = await st({ forkInstanceId: FORK_ID_2 });
  assert.equal(old.allowed, false); assert.equal(old.reason, "fork_instance_changed"); assert.equal(old.reenter, true);
  S.A.st.instance = FORK_ID_2; // the server restarted the fork: the app's booted instance is stale → re-entry needed
  assert.equal((await st()).reason, "fork_instance_changed");
  assert.equal((await st({ forkInstanceId: FORK_ID_2 })).reason, "no_entry", "a new instance needs a new entry");
  S.A.st.instance = FORK_ID;
  t = 1_700_000_600_000;
  assert.equal((await st()).reason, "entry_expired");
  assert.equal((await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address })).reason, "entry_expired");
});

// ── 7) E MUST: completion slot ──
const JOB_TO = `0x${"9a".repeat(20)}`;
const SEL_A = "0x11111111", SEL_B = "0x22222222";
const REGISTRY = { "j.aave": { journeyVersion: 1, steps: [{ stepId: "deposit", to: JOB_TO, selector: SEL_A }, { stepId: "withdraw", to: JOB_TO, selector: SEL_B }] } };
function forkChain() {
  const txs = new Map();
  const add = (hash, { from, input, block = 110874100, status = "0x1", to = JOB_TO }) => txs.set(hash, { tx: { hash, from, to, input }, rc: { transactionHash: hash, from, to, status, blockNumber: `0x${block.toString(16)}` } });
  const rpc = async (m, p) => { const t = txs.get(String(p[0]).toLowerCase()); if (m === "eth_getTransactionByHash") return t ? t.tx : null; if (m === "eth_getTransactionReceipt") return t ? t.rc : null; throw new Error("x"); };
  return { add, rpc };
}
await check("7 completion slot closed by default (404), even with a valid entry", async () => {
  const S = setup();
  assert.equal((await signedEnter(S, { journey1: journey1For(S.t, P, 8000) })).allowed, true);
  const r = await S.svc.complete({ inviteToken: TOKEN, piggyAddress: PIGGY.address, journeyId: "j.aave", txHashes: [h(1)] });
  assert.equal(r.ok, false); assert.equal(r.status, 404); assert.equal(r.reason, "completion_not_open");
});
await check("A-1263 completion accepts a public no-token Piggy when the slot is explicitly open", async () => {
  const F = forkChain();
  const S = setup({ config: { completionOpen: true, rewardCampaignVersion: "camp-1", journeys: REGISTRY, publicEntry: { enabled: true }, publicBudget: { reserve: async () => ({ ok: true }) } }, forkRpc: F.rpc });
  assert.equal((await signedEnter(S, { token: null, journey1: journey1For(S.t, P, 8050) })).allowed, true);
  F.add(h(0x91), { from: P, input: `${SEL_A}${"00".repeat(32)}` });
  F.add(h(0x92), { from: P, input: `${SEL_B}${"00".repeat(32)}` });
  const done = await S.svc.complete({ inviteToken: null, piggyAddress: PIGGY.address, journeyId: "j.aave", txHashes: [h(0x91), h(0x92)] });
  assert.equal(done.verdict, "COMPLETE"); assert.equal(done.rewarded, true);
});
await check("7 E MUST: steps from the server registry · evidence read from the fork RPC · verdict → stamp → reward (rewardLedgerApply record) in one request · once per tester", async () => {
  const F = forkChain();
  const S = setup({ config: { completionOpen: true, rewardCampaignVersion: "camp-1", journeys: REGISTRY }, forkRpc: F.rpc });
  assert.equal((await signedEnter(S, { journey1: journey1For(S.t, P, 8100) })).allowed, true);
  F.add(h(0xa1), { from: P, input: `${SEL_A}${"00".repeat(32)}` });
  F.add(h(0xa2), { from: P, input: `${SEL_B}${"00".repeat(32)}` });
  F.add(h(0xa3), { from: Q, input: `${SEL_A}` });
  F.add(h(0xa4), { from: P, input: `${SEL_A}`, block: 110874000 }); // at the fork start block = parent history
  F.add(h(0xa5), { from: P, input: "0x33333333" });
  F.add(h(0xa6), { from: P, input: SEL_B, status: "0x0" });
  const done = (txHashes, over = {}) => S.svc.complete({ inviteToken: TOKEN, piggyAddress: PIGGY.address, journeyId: "j.aave", txHashes, ...over });
  assert.equal((await done([h(0xa3)])).reason, "evidence_not_from_piggy");
  assert.equal((await done([h(0xa5)])).reason, "evidence_not_a_step");
  assert.equal((await done([h(0xa6)])).reason, "evidence_tx_failed");
  assert.equal((await done([h(0xdead)])).reason, "evidence_not_found", "a hash the fork does not know (client-made evidence) is refused");
  assert.equal((await done([h(0xa1)], { journeyId: "j.unknown" })).reason, "unknown_journey");
  const half = await done([h(0xa1)]);
  assert.equal(half.verdict, "INCOMPLETE"); assert.deepEqual(half.missing, ["withdraw"]);
  const full = await done([h(0xa1), h(0xa2)]);
  assert.equal(full.verdict, "COMPLETE"); assert.equal(full.rewarded, true); assert.equal(full.payout, "none");
  const rewards = await S.store.list("rewards");
  assert.equal(rewards.length, 1); assert.equal(rewards[0].rewardCampaignVersion, "camp-1", "campaign from server config");
  assert.equal(rewards[0].piggyAddress, P); assert.equal(rewards[0].journeyId, "j.aave"); assert.equal((await S.store.list("stamps")).length, 1);
  const again = await done([h(0xa1), h(0xa2)]);
  assert.equal(again.rewarded, false); assert.equal(again.reason, "duplicate_reward"); assert.equal((await S.store.list("rewards")).length, 1);
  assert.equal((await S.store.list("payouts")).length, 0, "no payout record, nothing paid");
  // pre-fork evidence in the chosen journey → INVALID (A-952 replay floor), even for a new tester who entered
  const S2 = setup({ config: { completionOpen: true, rewardCampaignVersion: "camp-1", journeys: REGISTRY }, forkRpc: F.rpc });
  assert.equal((await signedEnter(S2, { journey1: journey1For(S2.t, P, 8200) })).allowed, true);
  assert.equal((await S2.svc.complete({ inviteToken: TOKEN, piggyAddress: PIGGY.address, journeyId: "j.aave", txHashes: [h(0xa4), h(0xa2)] })).verdict, "INVALID");
  // no entry → nothing judged
  assert.equal((await S2.svc.complete({ inviteToken: TOKEN2, piggyAddress: PIGGY.address, journeyId: "j.aave", txHashes: [h(0xa1)] })).reason, "no_entry");
});
// [A-993] restart reconcile on the server path: evidence rows carry the receipt blockHash; a step the restore lost (orphan marker row,
// as the reconciler writes it) no longer counts; the tester redoes it with a new tx; one reward per tester still holds.
await check("7 [A-993] completion: row records blockHash · orphaned step skipped (INCOMPLETE) · redo completes · one reward · rows kept", async () => {
  const { orphanRecord } = await import("../../api/_lib/fork-ledger-contract.js");
  const F = forkChain();
  const BH = `0x${"bc".repeat(32)}`;
  F.add(h(0xc1), { from: P, input: SEL_A }); F.add(h(0xc2), { from: P, input: SEL_B, block: 110874101 }); F.add(h(0xc4), { from: P, input: SEL_A, block: 110874102 });
  for (const k of [h(0xc1), h(0xc2), h(0xc4)]) (await F.rpc("eth_getTransactionReceipt", [k])).blockHash = BH;
  const run = async (orphanDeposit) => {
    const S = setup({ config: { completionOpen: true, rewardCampaignVersion: "camp-1", journeys: REGISTRY }, forkRpc: F.rpc });
    assert.equal((await signedEnter(S, { journey1: journey1For(S.t, P, orphanDeposit ? 8700 : 8800) })).allowed, true);
    const done = (txHashes) => S.svc.complete({ inviteToken: TOKEN, piggyAddress: PIGGY.address, journeyId: "j.aave", txHashes });
    assert.equal((await done([h(0xc1)])).verdict, "INCOMPLETE");
    const dep = (await S.store.list("evidence"))[0];
    assert.equal(dep.blockHash, BH, "receipt blockHash recorded");
    if (orphanDeposit) { const o = orphanRecord({ evidenceKey: dep.key, reason: "orphaned_by_restore" }); assert.equal((await S.store.putIfAbsent("orphans", o.key, o.record)).ok, true); }
    return { S, done, w: await done([h(0xc2)]) };
  };
  const control = await run(false);
  assert.equal(control.w.verdict, "COMPLETE", "no marker: the deposit counts (the A-981 problem when it was lost)");
  const { S, done, w } = await run(true);
  assert.equal(w.verdict, "INCOMPLETE", "orphaned deposit skipped"); assert.deepEqual(w.missing, ["deposit"]); assert.equal((await S.store.list("rewards")).length, 0);
  const redo = await done([h(0xc4)]);
  assert.equal(redo.verdict, "COMPLETE"); assert.equal(redo.rewarded, true);
  const again = await done([h(0xc4), h(0xc2)]);
  assert.equal(again.rewarded, false); assert.equal(again.reason, "duplicate_reward"); assert.equal((await S.store.list("rewards")).length, 1);
  assert.equal((await S.store.list("evidence")).length, 3, "the orphaned row is kept (no delete)"); assert.equal((await S.store.list("orphans")).length, 1);
  assert.equal((await S.store.list("payouts")).length, 0);
});
await check("7 E MUST (source): rewards written only with rewardLedgerApply's record; verdict + apply in the same function; no payout/send code", () => {
  const s = src("api/_lib/fork-entry.js").replace(/^\s*\/\/.*$/gm, "");
  const puts = [...s.matchAll(/putIfAbsent\("rewards", ([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(puts, ["applied.key, applied.record"]);
  const body = s.slice(s.indexOf("async complete("));
  assert.ok(body.indexOf("journeyVerdict(") > 0 && body.indexOf("rewardLedgerApply(") > body.indexOf("journeyVerdict("));
  assert.doesNotMatch(s, /payoutRecord|sendRawTransaction|eth_sendRawTransaction|signTransaction|privateKey/);
  assert.doesNotMatch(s, /body\.testerId|\.testerId\s*=\s*(req|body)/, "testerId never read from a request");
  assert.doesNotMatch(s, /rewardCampaignVersion:\s*(req|body|input)/);
});

// ── review fix 1: one Piggy = one tester per instance · one Journey 1 tx = one tester ──
await check("fix1 a second tester with the SAME Piggy on the same fork instance is refused (piggy_already_entered); no top-up, status/completion refused", async () => {
  const F = forkChain();
  const S = setup({ config: { completionOpen: true, rewardCampaignVersion: "camp-1", journeys: REGISTRY }, forkRpc: F.rpc });
  const j1 = journey1For(S.t, P, 9500);
  assert.equal((await signedEnter(S, { token: TOKEN, journey1: j1 })).allowed, true);
  const j1b = journey1For(S.t, P, 9600); // even with ANOTHER Journey 1 of the same Piggy
  const r = await signedEnter(S, { token: TOKEN2, journey1: j1b });
  assert.equal(r.allowed, false); assert.equal(r.reason, "piggy_already_entered");
  assert.equal(S.A.st.realTopups, 4, "the Piggy was topped up once (by the first tester)"); // pre-A-959: 2 (MON + USDC)
  const st2 = await S.svc.status({ inviteToken: TOKEN2, piggyAddress: PIGGY.address, forkInstanceId: FORK_ID });
  assert.equal(st2.allowed, false);
  F.add(h(0xb1), { from: P, input: `${SEL_A}` }); F.add(h(0xb2), { from: P, input: `${SEL_B}` });
  assert.equal((await S.svc.complete({ inviteToken: TOKEN2, piggyAddress: PIGGY.address, journeyId: "j.aave", txHashes: [h(0xb1), h(0xb2)] })).reason, "no_entry");
  const ok = await S.svc.complete({ inviteToken: TOKEN, piggyAddress: PIGGY.address, journeyId: "j.aave", txHashes: [h(0xb1), h(0xb2)] });
  assert.equal(ok.rewarded, true); assert.equal((await S.store.list("rewards")).length, 1, "one Piggy's evidence = one reward");
  assert.equal((await S.store.list("entryPiggies")).length, 1);
  // concurrent: two testers, same Piggy, same instance → exactly one allowed
  const S2 = setup(); const jA = journey1For(S2.t, P, 9700); const jB = journey1For(S2.t, P, 9800);
  const [x, y] = await Promise.all([signedEnter(S2, { token: TOKEN, journey1: jA }), signedEnter(S2, { token: TOKEN2, journey1: jB })]);
  assert.equal([x, y].filter((e) => e.allowed).length, 1); assert.equal([x, y].find((e) => !e.allowed).reason, "piggy_already_entered");
  assert.equal(S2.A.st.realTopups, 4); // pre-A-959: 2 (MON + USDC)
  const statuses = await Promise.all([TOKEN, TOKEN2].map((tk) => S2.svc.status({ inviteToken: tk, piggyAddress: PIGGY.address, forkInstanceId: FORK_ID })));
  assert.equal(statuses.filter((q) => q.allowed).length, 1, "only the lock holder is entered");
});
await check("fix1 the same Journey 1 tx under a different tester is refused (journey1_already_used), also on a NEW fork instance; same tester re-enters fine", async () => {
  const S = setup();
  const j1 = journey1For(S.t, P, 9900);
  assert.equal((await signedEnter(S, { token: TOKEN, journey1: j1 })).allowed, true);
  S.A.st.instance = FORK_ID_2; // new instance: the Piggy row is per instance, the Journey 1 rows are not
  const r = await signedEnter(S, { token: TOKEN2, journey1: j1 });
  assert.equal(r.allowed, false); assert.equal(r.reason, "journey1_already_used");
  const half = { depositTxHash: j1.depositTxHash, redeemTxHash: journey1For(S.t, P, 9950).redeemTxHash };
  assert.equal((await signedEnter(S, { token: TOKEN2, journey1: half })).reason, "journey1_already_used", "one reused hash is enough");
  assert.equal((await signedEnter(S, { token: TOKEN, journey1: j1 })).allowed, true, "the same tester on the new instance");
  assert.equal(S.A.st.realTopups, 8, "4 per instance for the one tester"); // pre-A-959: 4 ("2 per instance" — MON + USDC)
});
await check("fix1 store: the new collections keep the canonical-key rule (entryPiggies · journey1Uses)", async () => {
  const L = await import("../../api/_lib/fork-ledger-contract.js");
  const st = createMemoryForkLedgerStore();
  const ep = L.entryPiggyRecord({ forkInstanceId: FORK_ID, piggyAddress: PIGGY.address, testerId: "Tester-1" });
  assert.equal(ep.ok, true); assert.equal(ep.key, `fork-entry-piggy|${FORK_ID}|${P}`); assert.equal(ep.record.testerId, "tester-1");
  assert.deepEqual(await st.putIfAbsent("entryPiggies", ep.key, ep.record), { ok: true, created: true });
  assert.equal((await st.putIfAbsent("entryPiggies", ep.key, { ...ep.record, testerId: "tester-2" })).reason, "exists");
  assert.equal((await st.putIfAbsent("entryPiggies", `${ep.key} `, ep.record)).reason, "bad_value");
  assert.equal((await st.putIfAbsent("entryPiggies", ep.key.toUpperCase(), ep.record)).reason, "bad_key");
  assert.equal((await st.putIfAbsent("entries", ep.key, ep.record)).reason, "bad_key", "an entry-piggy row cannot land among entries");
  const ju = L.journey1UseRecord({ txHash: h(7), testerId: "t1", piggyAddress: P });
  assert.equal(ju.key, `fork-j1|${h(7)}`); assert.deepEqual(await st.putIfAbsent("journey1Uses", ju.key, ju.record), { ok: true, created: true });
  assert.equal((await st.putIfAbsent("journey1Uses", ju.key, { ...ju.record, piggyAddress: P.toUpperCase().replace("0X", "0x") })).reason, "value_not_canonical");
  assert.equal(L.journey1UseRecord({ txHash: "0x12", testerId: "t", piggyAddress: P }).ok, false);
});
await check("fix2 no app origin in server config = closed (503); a bad origin cannot be configured", async () => {
  const S = setup({ config: { appOrigin: undefined } });
  assert.equal((await S.svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address })).status, 503);
  for (const bad of ["http://evil.example", "https://", "javascript:alert(1)", "https://a.example/path", "http://localhost"]) assert.equal((await setup({ config: { appOrigin: bad } }).svc.challenge({ inviteToken: TOKEN, piggyAddress: PIGGY.address })).status, 503, bad);
  const base = { ARASO_FORK_ENTRY_LOCAL: "1", ARASO_FORK_ADMIN_URL: "http://127.0.0.1:47999", ARASO_FORK_ADMIN_TOKEN: "admin-token-0123456789abcdef", ARASO_FORK_INVITE_TOKENS: TOKEN };
  assert.equal(localForkEntryServiceFromEnv(base), null, "ARASO_FORK_APP_ORIGIN required");
  assert.ok(localForkEntryServiceFromEnv({ ...base, ARASO_FORK_APP_ORIGIN: "https://arasoo.vercel.app" }));
});

// ── route + Admin client hygiene ──
const mkRes = () => { const r = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } }; return r; };
const mkReq = (body, headers = {}, method = "POST") => ({ method, headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
await check("route: POST JSON only · unexpected field 400 · cross-site 403 · invite only from the header · answers carry no Admin URL/token", async () => {
  const S = setup();
  const H = createForkEntryHandler({ service: S.svc });
  const call = async (body, headers, method) => { const res = mkRes(); await H(mkReq(body, headers, method), res); return { status: res.statusCode, body: JSON.parse(res.body), raw: res.body, headers: res.headers }; };
  assert.equal((await call({ action: "challenge", piggyAddress: P }, { "x-araso-invite": TOKEN }, "GET")).status, 405);
  assert.equal((await call({ action: "challenge", piggyAddress: P }, { "x-araso-invite": TOKEN, "content-type": "text/plain" })).status, 415);
  assert.equal((await call({ action: "challenge", piggyAddress: P, testerId: "tester-x" }, { "x-araso-invite": TOKEN })).status, 400);
  assert.equal((await call({ action: "challenge", piggyAddress: P, inviteToken: TOKEN })).status, 400, "token in the body is not accepted");
  assert.equal((await call({ action: "nope" }, { "x-araso-invite": TOKEN })).status, 400);
  assert.equal((await call({ action: "challenge", piggyAddress: P }, { "x-araso-invite": TOKEN, origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await call({ action: "challenge", piggyAddress: P })).status, 401);
  const ok = await call({ action: "challenge", piggyAddress: P }, { "x-araso-invite": TOKEN, "sec-fetch-site": "same-origin" });
  assert.equal(ok.status, 200); assert.equal(ok.headers["cache-control"], "no-store");
  const j1 = journey1For(S.t, P, 9000);
  const en = await call({ action: "enter", nonce: ok.body.nonce, signature: await PIGGY.signMessage({ message: ok.body.message }), piggyAddress: P, journey1: j1 }, { "x-araso-invite": TOKEN });
  assert.equal(en.status, 200); assert.equal(en.body.allowed, true);
  for (const leak of ["127.0.0.1", "47999", S.A.token, "Bearer", TOKEN]) assert.equal(en.raw.includes(leak) || ok.raw.includes(leak), false, leak);
  assert.equal((await call("x".repeat(9000), { "x-araso-invite": TOKEN })).status, 413);
  assert.equal(forkEntryOriginProblem({ origin: "http://localhost:5173", "sec-fetch-site": "cross-site" }, ["http://localhost:5173"]), null, "code-listed dev origin");
  assert.equal(forkEntryOriginProblem({ origin: "http://localhost:5173" }), "origin not allowed");
});
await check("Admin client: loopback-only URL; token only in the Authorization header; errors are codes (no URL/token)", async () => {
  for (const bad of ["http://localhost:1", "https://127.0.0.1:1", "http://127.0.0.2:1", "http://127.0.0.1:1/admin", "http://user@127.0.0.1:1", "http://127.0.0.1", "http://127.0.0.1:0", "http://127.0.0.1:70000", "http://10.0.0.1:1", " ", null]) assert.equal(adminOrigin(bad), null, String(bad));
  assert.equal(adminOrigin("http://127.0.0.1:65235"), "http://127.0.0.1:65235");
  assert.equal(createForkAdminClient({ url: "http://127.0.0.1:1", token: "short" }), null, "short token refused");
  assert.equal(forkAdminClientFromEnv({}), null); assert.equal(forkAdminClientFromEnv(Object.create({ ARASO_FORK_ADMIN_URL: "http://127.0.0.1:1", ARASO_FORK_ADMIN_TOKEN: "x".repeat(20) })), null, "inherited env ignored");
  const A = fakeAdmin();
  const wrong = createForkAdminClient({ url: "http://127.0.0.1:47999", token: "wrong-token-0123456789", fetchImpl: A.fetchImpl });
  const r = await wrong.topup({ piggyAddress: PIGGY.address, asset: "MON", grantVersion: "g" });
  assert.deepEqual(r, { ok: false, reason: "admin_unauthorized" });
  await A.client.instance();
  assert.ok(A.st.calls.every((c) => c.url.startsWith("http://127.0.0.1:47999/admin/") && c.url.includes(A.token) === false));
  const files = ["api/fork-entry.js", "api/_lib/fork-entry.js", "api/_lib/fork-auth.js", "api/_lib/fork-grant-client.js"].map(src).join("\n").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(files, /console\.(log|error|warn|info)/, "no logging in the entry server code");
  assert.doesNotMatch(files, /\bVITE_ARASO_FORK_ADMIN|\bVITE_[A-Z_]*TOKEN/, "no VITE_ admin/token name");
});
await check("default export: closed (503) unless ARASO_FORK_ENTRY_LOCAL=1 with Admin + invites, and never with a production marker", async () => {
  const base = { ARASO_FORK_ENTRY_LOCAL: "1", ARASO_FORK_ADMIN_URL: "http://127.0.0.1:47999", ARASO_FORK_ADMIN_TOKEN: "admin-token-0123456789abcdef", ARASO_FORK_INVITE_TOKENS: TOKEN, ARASO_FORK_APP_ORIGIN: APP_ORIGIN };
  assert.ok(localForkEntryServiceFromEnv(base));
  for (const env of [{ ...base, ARASO_FORK_ENTRY_LOCAL: "0" }, { ...base, VERCEL: "1" }, { ...base, NODE_ENV: "production" }, { ...base, ARASO_FORK_ADMIN_URL: "https://admin.example" }, { ...base, ARASO_FORK_INVITE_TOKENS: "" }]) assert.equal(localForkEntryServiceFromEnv(env), null, JSON.stringify(Object.keys(env)));
  const res = mkRes(); await createForkEntryHandler({ service: null })(mkReq({ action: "challenge" }), res); assert.equal(res.statusCode, 503);
  assert.equal(isForkLedgerStore(createMemoryForkLedgerStore()), true);
});
await check("api/grant.js untouched by this card (behaviour file byte-equal to the pre-fork baseline de8c9c8, sha256)", async () => {
  // [A-983 re-pin] HEAD text → its sha256 at de8c9c8 ("baseline: before fork track (A-942)"; A-983 receipt HEAD_PINS_de8c9c8.json): a HEAD compare
  // fails once HEAD holds A-960's grant.js (after the release commit / in a clone). pre-A-983: head = git show HEAD:api/grant.js; skip when no git.
  const BASE_GRANT_SHA256 = "3d8334ce18edf632d0354d23c23ec1a7441de5d775dc16d0cb158c7751f10f11";
  // [A-960 re-pin] api/grant.js was changed later by A-960; A-956's claim is checked on A-960's pre-card copy. pre-A-960: src("api/grant.js").
  const preA960 = privatePath("wt/a960d/pre/api_grant.js");
  if (!existsSync(preA960)) { console.log("      (A-960 pre copy absent — skipped)"); return; }
  assert.equal(createHash("sha256").update(readFileSync(preA960, "utf8")).digest("hex"), BASE_GRANT_SHA256); // pre-A-983: assert.equal(readFileSync(preA960, "utf8"), head)
});
// ── [A-1385] refuse log: one fixed-word line per refusal (action · reason · asset · adminStatus · forkInstance first 8), nothing else ──
const LEAK_RE = [/0x[0-9a-fA-F]{40}/, /[0-9a-fA-F]{64}/, /Bearer/, /127\.0\.0\.1/, /local-test-invite/, /admin-token/, /test-vector-secret/];
const noLeak = (lines) => { for (const l of lines) for (const re of LEAK_RE) assert.doesNotMatch(l, re, l); };
// admin whose top-up answers `topupAnswer` (status, body); instance stays healthy
function failingAdmin(topupAnswer) {
  const A = fakeAdmin();
  const fetchImpl = async (url, init = {}) => {
    if (new URL(url).pathname === "/admin/topup") { const [status, body] = topupAnswer(); return { status, json: async () => body }; }
    return A.fetchImpl(url, init);
  };
  return createForkAdminClient({ url: "http://127.0.0.1:47999", token: A.token, fetchImpl });
}
async function refusedEnter(admin, base) {
  const lines = [];
  const S = setup();
  const svc = createForkEntryService({ config: { invites: createInviteTable([TOKEN]), appOrigin: APP_ORIGIN, grantVersion: "a956-g1" }, store: S.store, challenges: S.challenges, admin, testnetRpc: S.t.rpc, log: (f) => lines.push(f) });
  const out = await signedEnter({ ...S, svc }, { journey1: journey1For(S.t, P, base) });
  return { out, lines };
}
await check("A-1385 refuse log · top-up 500 / 200 without record / signing null = one line each: enter · topup_failed · asset · adminStatus · forkInstance (answer unchanged)", async () => {
  const { createSignedForkAdminClient } = await import("../../api/_lib/fork-grant-client.js");
  const { FORK_GUARD_NAME } = await import("../src/chain-profile.js");
  const guardFetch = async (url, init = {}) => {
    if (new URL(url).pathname === "/") return { status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: { guard: FORK_GUARD_NAME, chainId: 31337143, forkInstanceId: FORK_ID, forkStartBlock: 110874000 } }) };
    return { status: 200, json: async () => ({ record: { forkInstanceId: FORK_ID, amountRaw: "1" } }) };
  };
  const signNull = createSignedForkAdminClient({ guardUrl: "https://fork-guard.example.test", secret: "test-vector-secret-not-real-0123456789", fetchImpl: guardFetch, nowMs: () => NaN });
  const cases = [[failingAdmin(() => [500, { error: "historical state not available" }]), 500], [failingAdmin(() => [200, { ok: true }]), 200], [signNull, "sign"]];
  let base = 12000;
  for (const [admin, adminStatus] of cases) {
    const { out, lines } = await refusedEnter(admin, base); base += 10;
    assert.deepEqual(out, { ok: true, allowed: false, reason: "topup_failed" }, "client answer shape unchanged");
    assert.equal(lines.length, 1, JSON.stringify(lines));
    assert.deepEqual(lines[0], { action: "enter", reason: "topup_failed", asset: "MON", adminStatus, forkInstanceId: FORK_ID });
  }
});
await check("A-1385 refuse log module: console.warn(\"fork_entry refuse\", JSON) · only the allowed fields · forkInstance = first 8 · no address/hash/nonce/signature/token", async () => {
  const { forkEntryRefuseLine, createForkEntryLog } = await import("../../api/_lib/fork-entry-log.js");
  const line = forkEntryRefuseLine({ action: "enter", reason: "topup_failed", asset: "MON", adminStatus: 500, forkInstanceId: FORK_ID, piggyAddress: P, nonce: "ab".repeat(16), signature: `0x${"cd".repeat(65)}`, inviteToken: TOKEN, txHash: h(1) });
  assert.deepEqual(JSON.parse(line), { action: "enter", reason: "topup_failed", asset: "MON", adminStatus: 500, forkInstance: FORK_ID.slice(0, 8) });
  // values that are not the expected word shape are dropped (an address can never ride in as a reason / asset / status)
  assert.deepEqual(JSON.parse(forkEntryRefuseLine({ action: "steal", reason: P, asset: P, adminStatus: P, forkInstanceId: P })), { action: "other", reason: "other" });
  assert.deepEqual(JSON.parse(forkEntryRefuseLine({ action: "status", reason: "no_entry", adminStatus: "sign" })), { action: "status", reason: "no_entry", adminStatus: "sign" });
  const said = [];
  createForkEntryLog({ sink: (...a) => said.push(a) })({ action: "enter", reason: "topup_failed", asset: "USDC", adminStatus: 0, forkInstanceId: FORK_ID, piggyAddress: P });
  assert.equal(said.length, 1); assert.equal(said[0][0], "fork_entry refuse"); assert.equal(said[0].length, 2);
  noLeak([line, said[0][1]]);
  const quiet = createForkEntryLog({ sink: () => { throw new Error("sink down"); } });
  assert.doesNotThrow(() => quiet({ action: "enter", reason: "topup_failed" }), "a broken sink never breaks an answer");
});
await check("A-1385 wiring · env-built entry service warns `fork_entry refuse` once on a failed top-up (real console.warn), no address/token in the line", async () => {
  const S = setup();
  const j1 = journey1For(S.t, P, 13000);
  const admin = fakeAdmin();
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === "127.0.0.1") return u.pathname === "/admin/topup" ? { status: 500, json: async () => ({}) } : admin.fetchImpl(url, init);
    const b = JSON.parse(init.body);
    return { json: async () => ({ jsonrpc: "2.0", id: b.id, result: await S.t.rpc(b.method, b.params) }) };
  };
  const env = { ARASO_FORK_ENTRY_LOCAL: "1", ARASO_FORK_ADMIN_URL: "http://127.0.0.1:47999", ARASO_FORK_ADMIN_TOKEN: admin.token, ARASO_FORK_INVITE_TOKENS: TOKEN, ARASO_FORK_APP_ORIGIN: APP_ORIGIN };
  const svc = localForkEntryServiceFromEnv(env, { fetchImpl });
  const warned = []; const orig = console.warn; console.warn = (...a) => warned.push(a.map(String));
  let out;
  try { out = await signedEnter({ ...S, svc }, { journey1: j1 }); } finally { console.warn = orig; }
  assert.deepEqual(out, { ok: true, allowed: false, reason: "topup_failed" });
  const refuses = warned.filter((a) => a[0] === "fork_entry refuse");
  assert.equal(refuses.length, 1, JSON.stringify(warned));
  assert.deepEqual(JSON.parse(refuses[0][1]), { action: "enter", reason: "topup_failed", asset: "MON", adminStatus: 500, forkInstance: FORK_ID.slice(0, 8) });
  noLeak(refuses.map((a) => a.join(" ")));
});
await check("A-1385 every refusal logs (challenge expired · enter bad proof · status no_entry); allowed answers log nothing", async () => {
  const lines = [];
  let t = 1_700_000_000_000;
  const S = setup();
  const mk = (config = {}) => createForkEntryService({ config: { invites: createInviteTable([TOKEN]), appOrigin: APP_ORIGIN, grantVersion: "a956-g1", ...config }, store: S.store, challenges: S.challenges, admin: S.A.client, testnetRpc: S.t.rpc, now: () => t, log: (f) => lines.push(f) });
  const svc = mk();
  assert.equal((await svc.status({ inviteToken: TOKEN, piggyAddress: P, forkInstanceId: FORK_ID })).reason, "no_entry");
  assert.deepEqual(lines.pop(), { action: "status", reason: "no_entry", forkInstanceId: FORK_ID });
  const ok = await signedEnter({ ...S, svc }, { journey1: journey1For(S.t, P, 14000) });
  assert.equal(ok.allowed, true); assert.equal(lines.length, 0, "allowed = no line");
  assert.equal((await svc.status({ inviteToken: TOKEN, piggyAddress: P, forkInstanceId: FORK_ID })).allowed, true); assert.equal(lines.length, 0);
  const c = await svc.challenge({ inviteToken: TOKEN, piggyAddress: P });
  assert.equal((await svc.enter({ inviteToken: TOKEN, nonce: c.nonce, signature: await OTHER.signMessage({ message: c.message }), piggyAddress: P, journey1: {} })).allowed, false);
  assert.equal(lines.pop().action, "enter");
  const late = mk({ entryNotAfter: t - 1 });
  assert.equal((await late.challenge({ inviteToken: TOKEN, piggyAddress: P })).reason, "entry_expired");
  assert.deepEqual(lines.pop(), { action: "challenge", reason: "entry_expired" });
  assert.equal(lines.length, 0);
});
await check("network 0", () => { assert.equal(netCalls, 0); });
console.log(`\nA-956 entry server: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
