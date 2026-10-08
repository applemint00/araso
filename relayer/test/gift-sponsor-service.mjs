// [A-906] Gift sponsor service: node only, no network, no RPC, no env, no keys (throwaway in-memory viem keys).
// node relayer/test/gift-sponsor-service.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import { keccak256, encodeAbiParameters, encodePacked, encodeFunctionData, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { GIFT_SPONSOR_PIN_TABLE, createGiftSponsorPolicy, createGiftSponsorService, openGiftSponsorLedger, validateGiftSponsorRequest } from "../src/gift-sponsor-service.mjs";
import { createRelayServer } from "../src/server.mjs";

const CHAIN = 143;
const A = (n) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const ESCROW = A(0xe5), DM = A(0xd1), IMPL = A(0x1a), EXACT = A(0xe1), LIMIT = A(0xe2), TS = A(0xe3);
const CODES = { [IMPL.toLowerCase()]: "0x6001", [DM.toLowerCase()]: "0x6002", [EXACT.toLowerCase()]: "0x6003", [LIMIT.toLowerCase()]: "0x6004", [TS.toLowerCase()]: "0x6005" };
const H = (c) => keccak256(c);
const FEE = 100n;
const ZERO_A = "0x0000000000000000000000000000000000000000";
const depHash = (i) => keccak256(`0xdd${i.toString(16).padStart(2, "0")}`);
const sponsorAcct = privateKeyToAccount(generatePrivateKey());
const piggy = privateKeyToAccount(generatePrivateKey());
const SENDER = A(0xc3);
const MAXEXP = 300;
const MIN_DEP = ((46429n + 174887n + 46382n + 100000n) * FEE * 11000n + 9999n) / 10000n;
const NOW = 1_800_000_000n;
const PRE = "0x" + "ab".repeat(32);
const SALT = "0x" + "cd".repeat(32);
const gid = (i) => `0x${i.toString(16).padStart(64, "0")}`;
const CFG = { escrow: ESCROW, delegationManager: DM, delegateImpl: IMPL, sponsorAddress: sponsorAcct.address, exactExecutionEnforcer: EXACT, limitedCallsEnforcer: LIMIT, timestampEnforcer: TS,
  implCodeHash: H("0x6001"), delegationManagerCodeHash: H("0x6002"), exactExecutionCodeHash: H("0x6003"), limitedCallsCodeHash: H("0x6004"), timestampCodeHash: H("0x6005"), chainId: CHAIN, maxExpirySeconds: MAXEXP, gasUnits: { install: 46429n, commit: 174887n, revoke: 46382n, claim: 100000n }, gasBufferBps: 1000 };
const lcs = (a) => a.toLowerCase();
const TEST_PINS = { addresses: { delegationManager: lcs(DM), delegateImpl: lcs(IMPL), exactExecutionEnforcer: lcs(EXACT), limitedCallsEnforcer: lcs(LIMIT), timestampEnforcer: lcs(TS) },
  hashes: { 143: { delegationManagerCodeHash: CFG.delegationManagerCodeHash, implCodeHash: CFG.implCodeHash, exactExecutionCodeHash: CFG.exactExecutionCodeHash, limitedCallsCodeHash: CFG.limitedCallsCodeHash, timestampCodeHash: CFG.timestampCodeHash } } };
const POLICY = createGiftSponsorPolicy(CFG, TEST_PINS);
const TOKEN_HASH = `0x${createHash("sha256").update(Buffer.from(PRE.slice(2), "hex")).digest("hex")}`;
let pass = 0;
const test = async (label, fn) => { await fn(); console.log(`PASS  ${label}`); pass += 1; };

function fakeChain() {
  const c = { gifts: new Map(), codes: { ...CODES }, nonce: 0n, ts: NOW, sims: [], reads: 0, simFail: false, txs: new Map(), balance: 10n ** 18n, fee: FEE, commits: new Map(), confirm: true,
    async getTimestamp() { c.reads++; return c.ts; },
    async getGift(id) { c.reads++; return c.gifts.get(id) ?? { exists: false }; },
    async getCode(a) { c.reads++; return c.codes[a.toLowerCase()] ?? "0x"; },
    async getNonce() { c.reads++; return c.nonce; },
    async simulate(x) { c.sims.push(x); if (c.simFail) throw new Error("revert"); },
    async getGasDepositTx(h) { return c.txs.get(h) ?? null; },
    async getFeePerGasWei() { if (c.fee === "throw") throw new Error("rpc"); return c.fee; },
    async confirmCommit() { return c.confirm; },
    async getSponsorBalance() { return c.balance; },
    async getSponsorNonces() { return { latest: 0n, pending: 0n }; },
    async getCommit(id) { return c.commits.get(id) ?? null; },
    async getReceipt() { return null; },
    async waitBlockAfter() {},
    addGift(i, over = {}) { c.gifts.set(gid(i), { exists: true, claimed: false, sender: SENDER, expiry: NOW + 100000n, claimTokenHash: TOKEN_HASH, ...over }); c.addDeposit(i); },
    addDeposit(i, over = {}) { c.txs.set(depHash(i), { from: SENDER, to: sponsorAcct.address, value: MIN_DEP, status: "success", data: gid(i), ...over }); } };
  return c;
}
function fakeSponsor() {
  const s = { address: sponsorAcct.address, sent: [], failKind: null,
    async send(x) { s.sent.push(x); if (s.failKind === x.kind) return { status: "reverted" }; return { txHash: keccak256(`0x${s.sent.length.toString(16).padStart(2, "0")}`), blockNumber: 10n + BigInt(s.sent.length), status: "success" }; } };
  return s;
}

const commitExec = (giftId, over = {}) => {
  const recipient = over.recipient ?? piggy.address;
  const commitHash = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes" }, { type: "bytes32" }], [recipient, PRE, SALT]));
  const data = encodeFunctionData({ abi: [{ type: "function", name: "commitClaim", inputs: [{ type: "bytes32" }, { type: "bytes32" }], outputs: [], stateMutability: "nonpayable" }], functionName: "commitClaim", args: [over.giftId ?? giftId, over.commitHash ?? commitHash] });
  return encodePacked(["address", "uint256", "bytes"], [over.target ?? ESCROW, over.value ?? 0n, data]);
};
const TYPES = { Delegation: [{ name: "delegate", type: "address" }, { name: "delegator", type: "address" }, { name: "authority", type: "bytes32" }, { name: "caveats", type: "Caveat[]" }, { name: "salt", type: "uint256" }],
  Caveat: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }] };
const tsTerms = (after, before) => encodePacked(["uint128", "uint128"], [after, before]);

/** Build a fully valid request; `o` mutates fields BEFORE signing (so signatures stay valid unless a case breaks them). */
async function build(i, o = {}) {
  const giftId = gid(i);
  const delegator = o.signer ?? piggy;
  const caveats = o.caveats ?? [
    { enforcer: EXACT, terms: o.exec ?? commitExec(giftId), args: "0x" },
    { enforcer: LIMIT, terms: encodeAbiParameters([{ type: "uint256" }], [o.limit ?? 1n]), args: "0x" },
    ...(o.noExpiry ? [] : [{ enforcer: TS, terms: o.tsTerms ?? tsTerms(0n, NOW + 300n), args: "0x" }]),
  ];
  const d = { delegate: o.delegate ?? sponsorAcct.address, delegator: o.delegator ?? delegator.address, authority: o.authority ?? "0x" + "f".repeat(64), caveats, salt: 7n, signature: "0x" };
  d.signature = await delegator.signTypedData({ domain: { name: "DelegationManager", version: "1", chainId: CHAIN, verifyingContract: DM }, types: TYPES, primaryType: "Delegation",
    message: { delegate: d.delegate, delegator: d.delegator, authority: d.authority, caveats: caveats.map(({ enforcer, terms }) => ({ enforcer, terms })), salt: d.salt } });
  const auth = await (o.authSigner ?? delegator).signAuthorization({ contractAddress: o.authAddress ?? IMPL, chainId: o.authChainId ?? CHAIN, nonce: o.authNonce ?? 0 });
  const rev = await (o.revSigner ?? o.authSigner ?? delegator).signAuthorization({ contractAddress: o.revAddress ?? ZERO_A, chainId: o.revChainId ?? CHAIN, nonce: o.revNonce ?? ((o.authNonce ?? 0) + 1) });
  return {
    giftId, gasTx: o.gasTx ?? depHash(i),
    revokeAuthorization: { chainId: Number(rev.chainId), address: rev.address ?? rev.contractAddress, nonce: Number(rev.nonce), r: rev.r, s: rev.s, yParity: rev.yParity },
    authorization: { chainId: Number(auth.chainId), address: auth.address ?? auth.contractAddress, nonce: Number(auth.nonce), r: auth.r, s: auth.s, yParity: auth.yParity },
    delegation: { delegate: d.delegate, delegator: d.delegator, authority: d.authority, caveats: d.caveats, salt: d.salt.toString(), signature: d.signature },
    claim: { recipient: o.recipient ?? piggy.address, preimage: PRE, salt: SALT, deadline: String(o.deadline ?? NOW + 400n) },
  };
}
function rig(over = {}) {
  const chain = fakeChain(); const sponsor = fakeSponsor(); const logs = [];
  const ledger = openGiftSponsorLedger();
  const og = chain.addGift; chain.addGift = (i, o) => { og(i, o); if (!over.noRegister) ledger.registerGasTx(gid(i), depHash(i)); };   // the sender registers giftId -> gasTx right after create
  const orig = sponsor.send; sponsor.send = async (x, o) => { const r = await orig(x, o); if (x.kind === "revoke" && r.status === "success" && !over.revokeNoEffect) chain.codes[piggy.address.toLowerCase()] = "0x"; if (x.kind === "install" && r.status === "success") chain.codes[piggy.address.toLowerCase()] = `0xef0100${IMPL.slice(2).toLowerCase()}`; return r; };
  let pf = true; const preflight = async () => pf;
  const svc = createGiftSponsorService({ ledger, policy: over.policy === undefined ? POLICY : over.policy, chain, sponsor, preflight, log: (m) => logs.push(m) });
  return { chain, sponsor, logs, ledger, svc, setPreflight: (v) => { pf = v; } };
}
const refusedWith = (r, code) => r.logs.some((l) => l.includes(`refused(${code})`));

await test("policy fails closed on any missing pin / injected expiry", () => {
  assert.ok(POLICY);
  for (const k of Object.keys(CFG)) { const c = { ...CFG }; delete c[k]; assert.equal(createGiftSponsorPolicy(c, TEST_PINS), null, k); }
  assert.equal(createGiftSponsorPolicy({ ...CFG, maxExpirySeconds: 0 }), null);
  assert.equal(createGiftSponsorPolicy({ ...CFG, chainId: 0 }), null);
  assert.equal(createGiftSponsorPolicy(null), null);
});

await test("policy pins: only chains {143,10143}, real table enforced, TimestampEnforcer hash pinned on 143", () => {
  const T = GIFT_SPONSOR_PIN_TABLE; const h = T.hashes[143];
  const real = { ...CFG, chainId: 143, ...T.addresses, ...h };
  assert.ok(createGiftSponsorPolicy(real));
  assert.equal(h.timestampCodeHash, "0x1da353833766081398664c131a50988f6f7190d6a1a974f497607b974705900c");
  for (const chainId of [0, 1, 10144, 8453]) assert.equal(createGiftSponsorPolicy({ ...real, chainId }), null, String(chainId));
  assert.equal(createGiftSponsorPolicy({ ...real, delegateImpl: A(0x99) }), null);        // foreign delegate pin
  assert.equal(createGiftSponsorPolicy({ ...real, timestampCodeHash: "0x" + "11".repeat(32) }), null);
  assert.equal(createGiftSponsorPolicy({ ...real, implCodeHash: h.delegationManagerCodeHash }), null);
  assert.equal(createGiftSponsorPolicy(CFG), null); // fake test pins are not in the real table
});

await test("happy path: simulate -> install -> redeem -> claim, all value 0, never to-Piggy with value", async () => {
  const r = rig(); r.chain.addGift(1);
  const out = await r.svc.handle(await build(1));
  assert.equal(out.status, 200, JSON.stringify(out)); assert.equal(out.body.state, "CLAIMED");
  const hh = /^0x[0-9a-f]{64}$/;
  assert.ok(hh.test(out.body.installTxHash) && hh.test(out.body.commitTxHash) && hh.test(out.body.claimTxHash));
  assert.notEqual(out.body.commitTxHash, out.body.claimTxHash); assert.notEqual(out.body.installTxHash, out.body.commitTxHash);
  assert.deepEqual(r.sponsor.sent.map((s) => s.kind), ["install", "redeem", "revoke", "claim"]);
  assert.deepEqual(r.sponsor.sent.map((s) => s.to.toLowerCase()), [piggy.address, DM, piggy.address, ESCROW].map((x) => x.toLowerCase()));
  for (const s of r.sponsor.sent) assert.equal(s.value, 0n);
  assert.ok(r.sponsor.sent[0].authorizationList.length === 1 && r.sponsor.sent[1].authorizationList === undefined);
  assert.ok(r.chain.sims.length === 3 && r.chain.sims.every((s) => s.value === 0n)); // redeem sim (pre-install), redeem sim (in commit), claim sim: the signed authorizations never go to a simulation
  assert.equal(r.ledger.get(gid(1)).state, "CLAIMED"); assert.equal(out.body.revoke, "done"); assert.equal(r.ledger.get(gid(1)).revokeStatus, "done");
});

await test("replay of the same giftId refused before any send (also after success)", async () => {
  const r = rig(); r.chain.addGift(2);
  await r.svc.handle(await build(2));
  const n = r.sponsor.sent.length;
  const again = await r.svc.handle(await build(2));
  assert.equal(again.status, 409); assert.equal(r.sponsor.sent.length, n); assert.ok(r.logs.some((l) => l.includes("refused_dup")));
});

await test("concurrent same giftId: exactly one sponsored", async () => {
  const r = rig(); r.chain.addGift(3);
  const [a, b] = await Promise.all([r.svc.handle(await build(3)), r.svc.handle(await build(3, { }))]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(r.sponsor.sent.filter((s) => s.kind === "claim").length, 1);
});

const stranger = privateKeyToAccount(generatePrivateKey());
const wrongSel = encodeFunctionData({ abi: [{ type: "function", name: "claim", inputs: [{ type: "bytes32" }, { type: "bytes32" }], outputs: [], stateMutability: "nonpayable" }], functionName: "claim", args: [gid(10), gid(11)] });
const swapCaveats = (g) => { const base = [{ enforcer: EXACT, terms: commitExec(g), args: "0x" }, { enforcer: LIMIT, terms: encodeAbiParameters([{ type: "uint256" }], [1n]), args: "0x" }, { enforcer: TS, terms: tsTerms(0n, NOW + 300n), args: "0x" }]; return [base[1], base[0], base[2]]; };
const CASES = [
  ["caveat order swapped", () => build(10, { caveats: swapCaveats(gid(10)) }), "caveats"],
  ["Timestamp after != 0", () => build(10, { tsTerms: tsTerms(1n, NOW + 300n) }), "expiry"],
  ["chainId 0", () => build(10, { authChainId: 0 }), "chainId"],
  ["chainId other chain", () => build(10, { authChainId: 10143 }), "chainId"],
  ["delegate (7702 address) foreign", () => build(10, { authAddress: A(0x99) }), "delegate"],
  ["authorization signed by someone else", () => build(10, { authSigner: stranger }), "auth_signer"],
  ["redeemer is not our sponsor", () => build(10, { delegate: A(0x77) }), "redeemer"],
  ["authority not root", () => build(10, { authority: "0x" + "1".repeat(64) }), "authority"],
  ["target not escrow", () => build(10, { exec: commitExec(gid(10), { target: A(0x55) }) }), "exact_execution"],
  ["value in execution", () => build(10, { exec: commitExec(gid(10), { value: 1n }) }), "exact_execution"],
  ["calldata for another giftId", () => build(10, { exec: commitExec(gid(10), { giftId: gid(99) }) }), "exact_execution"],
  ["calldata other commit hash", () => build(10, { exec: commitExec(gid(10), { commitHash: gid(5) }) }), "exact_execution"],
  ["calldata other method", () => build(10, { exec: encodePacked(["address", "uint256", "bytes"], [ESCROW, 0n, wrongSel]) }), "exact_execution"],
  ["recipient != delegator", () => build(10, { recipient: A(0x42) }), "recipient"],
  ["LimitedCalls = 2", () => build(10, { limit: 2n }), "limited_calls"],
  ["expiry caveat missing", () => build(10, { noExpiry: true }), "caveats"],
  ["expiry in the past", () => build(10, { tsTerms: tsTerms(0n, NOW - 1n) }), "expiry"],
  ["expiry beyond injected max", () => build(10, { tsTerms: tsTerms(0n, NOW + BigInt(MAXEXP) + 1n) }), "expiry"],
  ["expiry zero (unbounded)", () => build(10, { tsTerms: tsTerms(0n, 0n) }), "expiry"],
  ["extra caveat", () => build(10, { caveats: [{ enforcer: EXACT, terms: commitExec(gid(10)), args: "0x" }, { enforcer: LIMIT, terms: encodeAbiParameters([{ type: "uint256" }], [1n]), args: "0x" }, { enforcer: TS, terms: tsTerms(0n, NOW + 300n), args: "0x" }, { enforcer: A(0x66), terms: "0x", args: "0x" }] }), "caveats"],
  ["duplicate enforcer", () => build(10, { caveats: [{ enforcer: EXACT, terms: commitExec(gid(10)), args: "0x" }, { enforcer: EXACT, terms: commitExec(gid(10)), args: "0x" }, { enforcer: TS, terms: tsTerms(0n, NOW + 300n), args: "0x" }] }), "caveats"],
  ["claim deadline already passed", () => build(10, { deadline: NOW }), "claim_deadline"],
  ["delegator is the sponsor", () => build(10, { signer: sponsorAcct }), "delegator"],
];
for (const [label, mk, code] of CASES) {
  await test(`tamper: ${label} -> refused(${code}), 0 sends, ledger untouched`, async () => {
    const r = rig(); r.chain.addGift(10);
    const out = await r.svc.handle(await mk());
    assert.ok(out.status === 409 || out.status === 400, JSON.stringify(out));
    assert.ok(refusedWith(r, code), `${code} not in ${JSON.stringify(r.logs)}`);
    assert.equal(r.sponsor.sent.length, 0); assert.equal(r.chain.sims.length, 0); assert.equal(r.ledger.get(gid(10)), null);
  });
}

await test("tamper after signing: terms edited / signature swapped / salt changed -> refused", async () => {
  for (const edit of [
    (q) => { q.delegation.caveats[1].terms = encodeAbiParameters([{ type: "uint256" }], [1n]).replace(/1$/, "2"); },
    (q) => { q.delegation.salt = "8"; },
    (q) => { q.delegation.signature = "0x" + "11".repeat(65); },
    (q) => { q.delegation.caveats[2].terms = tsTerms(0n, NOW + 301n); },
    (q) => { q.authorization.nonce = 5; },
  ]) {
    const r = rig(); r.chain.addGift(10); const q = await build(10); edit(q);
    const out = await r.svc.handle(q);
    assert.notEqual(out.status, 200); assert.equal(r.sponsor.sent.length, 0); assert.equal(r.chain.sims.length, 0);
  }
});

await test("pinned code hash mismatch (impl / DM / enforcer) -> refused", async () => {
  for (const addr of [IMPL, DM, EXACT, LIMIT, TS]) {
    const r = rig(); r.chain.addGift(10); r.chain.codes[addr.toLowerCase()] = "0x60ff";
    const out = await r.svc.handle(await build(10));
    assert.equal(out.status, 409); assert.ok(refusedWith(r, "code_hash")); assert.equal(r.sponsor.sent.length, 0);
  }
});

await test("delegator with foreign code / wrong auth nonce refused; already-installed still sends the (harmless) install so the revoke nonce lines up", async () => {
  let r = rig(); r.chain.addGift(10); r.chain.codes[piggy.address.toLowerCase()] = "0x6009";
  assert.equal((await r.svc.handle(await build(10))).status, 409); assert.ok(refusedWith(r, "delegator_code"));
  r = rig(); r.chain.addGift(10); r.chain.nonce = 3n;
  assert.equal((await r.svc.handle(await build(10))).status, 409); assert.ok(refusedWith(r, "auth_nonce"));
  r = rig(); r.chain.addGift(10); r.chain.codes[piggy.address.toLowerCase()] = `0xef0100${IMPL.slice(2).toLowerCase()}`;
  assert.equal((await r.svc.handle(await build(10))).status, 200);
  assert.deepEqual(r.sponsor.sent.map((s) => s.kind), ["install", "redeem", "revoke", "claim"]);
});

await test("escrow state: unknown / claimed / expired / wrong preimage / sender==recipient -> refused, 0 sends", async () => {
  const cases = [
    () => {}, // unknown gift (never added)
    (c) => c.addGift(10, { claimed: true }),
    (c) => c.addGift(10, { expiry: NOW - 1n }),
    (c) => c.addGift(10, { claimTokenHash: "0x" + "00".repeat(32) }),
    (c) => c.addGift(10, { sender: piggy.address }),
    (c) => c.addGift(10, { expiry: NOW + 399n }), // claim deadline beyond gift expiry
  ];
  for (const setup of cases) {
    const r = rig(); setup(r.chain);
    const out = await r.svc.handle(await build(10));
    assert.equal(out.status, 409); assert.ok(refusedWith(r, "gift"), JSON.stringify(r.logs)); assert.equal(r.sponsor.sent.length, 0); assert.equal(r.ledger.get(gid(10)), null);
  }
});

await test("strict shape: extra / missing keys (value, to, amount) -> 400, 0 chain reads", async () => {
  const r = rig(); r.chain.addGift(10); const base = await build(10);
  for (const mut of [(q) => { q.value = "1"; }, (q) => { q.to = piggy.address; }, (q) => { delete q.claim; }, (q) => { q.authorization.extra = 1; }, (q) => { q.giftId = q.giftId.toUpperCase().replace("0X", "0x"); }]) {
    const q = structuredClone(base); mut(q);
    assert.equal((await r.svc.handle(q)).status, 400);
  }
  assert.equal(validateGiftSponsorRequest(null), null); assert.equal(r.chain.reads, 0); assert.equal(r.sponsor.sent.length, 0);
});

await test("simulation failure -> nothing sent, gift not burned (retry possible)", async () => {
  const r = rig(); r.chain.addGift(10); r.chain.simFail = true;
  const out = await r.svc.handle(await build(10));
  assert.equal(out.body.error, "unavailable_not_sent"); assert.equal(r.sponsor.sent.length, 0); assert.equal(r.ledger.get(gid(10)), null);
  r.chain.simFail = false;
  assert.equal((await r.svc.handle(await build(10))).status, 200);
});

await test("failure after a send -> UNKNOWN, no auto retry, replay refused", async () => {
  const r = rig(); r.chain.addGift(10); r.sponsor.failKind = "redeem";
  const out = await r.svc.handle(await build(10));
  assert.equal(out.status, 503); assert.equal(r.ledger.get(gid(10)).state, "UNKNOWN");
  const n = r.sponsor.sent.length; r.sponsor.failKind = null;
  assert.equal((await r.svc.handle(await build(10))).status, 409); assert.equal(r.sponsor.sent.length, n);
});

await test("no MON to the Piggy in any path: a sponsor asked to send value is refused by the service", async () => {
  const r = rig(); r.chain.addGift(10);
  await r.svc.handle(await build(10));
  assert.ok(r.sponsor.sent.every((s) => s.value === 0n && (s.to.toLowerCase() !== piggy.address.toLowerCase() || s.kind === "install" || s.kind === "revoke")));
  assert.ok(r.sponsor.sent.filter((s) => s.to.toLowerCase() === piggy.address.toLowerCase()).every((s) => s.value === 0n && s.data === "0x" && (s.kind === "install" || s.kind === "revoke")));
});

// ---- route: default OFF ----
function call(server, { method = "POST", headers = {}, body = "" } = {}) {
  return new Promise((resolve) => {
    const req = new PassThrough(); req.method = method; req.url = "/gift-sponsor"; req.headers = { "content-type": "application/json", ...headers };
    const res = { statusCode: 0, headersSent: false, writableEnded: false, writeHead(s) { this.statusCode = s; this.headersSent = true; }, end(b) { this.writableEnded = true; resolve({ status: this.statusCode, body: b ? JSON.parse(b) : null }); } };
    server.listeners("request")[0](req, res); req.end(body);
  });
}
const noSubmitter = { getBalance: async () => 0n, send: async () => { throw new Error("must not send"); } };

await test("bounded queue: when full, 503 unavailable_not_sent and 0 work", async () => {
  const chain = fakeChain(); chain.addGift(20); const sponsor = fakeSponsor(); let release; const gate = new Promise((r) => { release = r; });
  chain.getTimestamp = async () => { await gate; return NOW; };
  const lg = openGiftSponsorLedger(); lg.registerGasTx(gid(20), depHash(20)); lg.registerGasTx(gid(21), depHash(21));
  const svc = createGiftSponsorService({ ledger: lg, policy: POLICY, chain, sponsor, preflight: async () => true, maxQueue: 1 });
  const first = svc.handle(await build(20));
  const second = await svc.handle(await build(21));
  assert.equal(second.status, 503); assert.equal(second.body.error, "unavailable_not_sent");
  release(); assert.equal((await first).status, 200); assert.equal(sponsor.sent.length, 3); // install, redeem, claim (this bare fake never shows the designator, so the Piggy already reads clean: no revoke tx)
});

await test("route is OFF by default (giftSponsor null / partial) -> 503, even with allow-all auth", async () => {
  const s1 = createRelayServer({ submitter: noSubmitter, ledger: null });
  assert.equal((await call(s1, { body: "{}" })).status, 503);
  const s2 = createRelayServer({ submitter: noSubmitter, ledger: null, giftSponsor: { authorize: () => true, policy: POLICY } });
  assert.equal((await call(s2, { body: "{}" })).status, 503);
  assert.equal((await call(s1, { method: "GET" })).status, 405);
});

await test("route configured: auth default deny (401), bad origin 403, then service", async () => {
  const chain = fakeChain(); chain.addGift(1); const sponsor = fakeSponsor();
  const lg1 = openGiftSponsorLedger(); lg1.registerGasTx(gid(1), depHash(1));
  const cfg = { ledger: lg1, policy: POLICY, chain, sponsor, preflight: async () => true };
  assert.equal((await call(createRelayServer({ submitter: noSubmitter, ledger: null, giftSponsor: cfg }), { body: "{}" })).status, 401);
  const s = createRelayServer({ submitter: noSubmitter, ledger: null, giftSponsor: { ...cfg, authorize: () => true, allowedOrigins: ["https://ok.example"] } });
  assert.equal((await call(s, { headers: { origin: "https://evil.example" }, body: "{}" })).status, 403);
  assert.equal(sponsor.sent.length, 0);
  const out = await call(s, { headers: { origin: "https://ok.example" }, body: JSON.stringify(await build(1)) });
  assert.equal(out.status, 200, JSON.stringify(out)); assert.equal(sponsor.sent.length, 3);
});

// ───────────────────────────── [A-913] ─────────────────────────────
import { mkdtempSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GIFT_SPONSOR_MAX_EXPIRY_SECONDS } from "../src/gift-sponsor-service.mjs";

await test("A-913 C: expiry cap = 300 (A-556), larger / missing cap refused, unknown gas units / buffer refused", () => {
  assert.equal(GIFT_SPONSOR_MAX_EXPIRY_SECONDS, 300);
  assert.ok(createGiftSponsorPolicy({ ...CFG, maxExpirySeconds: 300 }, TEST_PINS));
  assert.equal(createGiftSponsorPolicy({ ...CFG, maxExpirySeconds: 301 }, TEST_PINS), null);
  assert.equal(createGiftSponsorPolicy({ ...CFG, maxExpirySeconds: 600 }, TEST_PINS), null);
  assert.equal(createGiftSponsorPolicy({ ...CFG, gasUnits: undefined }, TEST_PINS), null);
  assert.equal(createGiftSponsorPolicy({ ...CFG, gasUnits: { ...CFG.gasUnits, claim: 0n } }, TEST_PINS), null);
  assert.equal(createGiftSponsorPolicy({ ...CFG, gasBufferBps: 5001 }, TEST_PINS), null);
  assert.equal(createGiftSponsorPolicy({ ...CFG, gasBufferBps: undefined }, TEST_PINS), null);
});

await test("A-913 C: delegation window beyond the Gift's own expiry refused (min(5 min, Gift deadline))", async () => {
  const r = rig(); r.chain.addGift(30, { expiry: NOW + 250n });         // claim deadline NOW+400 > expiry -> gift; use deadline within expiry:
  const out = await r.svc.handle(await build(30, { deadline: NOW + 240n }));
  assert.equal(out.status, 409); assert.ok(refusedWith(r, "expiry")); assert.equal(r.sponsor.sent.length, 0);
});

const DEP_CASES = [
  ["no such deposit tx on chain", (c) => c.txs.delete(depHash(31))],
  ["deposit from someone else", (c) => c.addDeposit(31, { from: A(0x99) })],
  ["deposit to a different wallet", (c) => c.addDeposit(31, { to: A(0x98) })],
  ["deposit value one wei below the computed minimum", (c) => c.addDeposit(31, { value: MIN_DEP - 1n })],
  ["deposit tx reverted", (c) => c.addDeposit(31, { status: "reverted" })],
];
for (const [label, mut] of DEP_CASES) {
  await test(`A-913 G10: ${label} -> refused(gas_deposit), 0 sends, ledger untouched`, async () => {
    const r = rig(); r.chain.addGift(31); mut(r.chain);
    const out = await r.svc.handle(await build(31));
    assert.equal(out.status, 409); assert.ok(refusedWith(r, "gas_deposit")); assert.equal(r.sponsor.sent.length, 0); assert.equal(r.ledger.get(gid(31)), null);
  });
}
await test("A-913 G10: minimum is COMPUTED per Gift (units x current fee x buffer): fee up => same deposit now too small; exact minimum passes; no fee input => refuse (503 not sent)", async () => {
  const r = rig(); r.chain.addGift(35); r.chain.fee = FEE * 2n;
  assert.equal((await r.svc.handle(await build(35))).status, 409); assert.ok(refusedWith(r, "gas_deposit"));
  const r2 = rig(); r2.chain.addGift(36); // MIN_DEP is exactly the minimum at FEE
  assert.equal((await r2.svc.handle(await build(36))).status, 200);
  for (const bad of [0n, "throw"]) { const r3 = rig(); r3.chain.addGift(37); r3.chain.fee = bad; const o = await r3.svc.handle(await build(37)); assert.equal(o.body.error, "unavailable_not_sent"); assert.equal(r3.sponsor.sent.length, 0); }
});
await test("A-913 G10: one deposit tx funds one giftId (registration refuses a hash already registered for another gift); deposit read failure is a 503 not-sent", async () => {
  const r = rig(); r.chain.addGift(32); r.chain.addGift(33, {}); r.ledger.registerGasTx; 
  const r1 = await r.svc.register({ action: "register_gas_tx", giftId: gid(33), gasTx: depHash(32) });
  assert.equal(r1.status, 409);
  const r2 = rig(); r2.chain.addGift(34); r2.chain.getGasDepositTx = async () => { throw new Error("rpc"); };
  const o2 = await r2.svc.handle(await build(34)); assert.equal(o2.body.error, "unavailable_not_sent"); assert.equal(r2.sponsor.sent.length, 0);
});

await test("A-913 G10(c): claim without a registered gas tx -> refused(gas_deposit_tx_missing), 0 sends; request gasTx that differs from the registered one -> refused; 5-key form and matching 6-key form both claim", async () => {
  const r = rig({ noRegister: true }); r.chain.addGift(80);
  const b = await build(80); const five = { ...b }; delete five.gasTx;
  assert.equal((await r.svc.handle(five)).status, 409); assert.ok(refusedWith(r, "gas_deposit_tx_missing")); assert.equal(r.sponsor.sent.length, 0);
  r.ledger.registerGasTx(gid(80), depHash(80));
  const bad = await build(80, { gasTx: depHash(1) }); assert.equal((await r.svc.handle(bad)).status, 409); assert.ok(refusedWith(r, "gas_deposit_tx_mismatch")); assert.equal(r.sponsor.sent.length, 0);
  assert.equal((await r.svc.handle(five)).status, 200);
  const r2 = rig(); r2.chain.addGift(81); assert.equal((await r2.svc.handle(await build(81))).status, 200);
});
const REG = (i, h = depHash(i)) => ({ action: "register_gas_tx", giftId: gid(i), gasTx: h });
await test("A-913 G10(c): register = record-and-read only: created / same hash is a no-op / different hash refused; 0 sends, no signing", async () => {
  const r = rig({ noRegister: true }); r.chain.addGift(82);
  const a = await r.svc.register(REG(82)); assert.equal(a.status, 200); assert.equal(a.body.already, false); assert.equal(r.ledger.gasTxOf(gid(82)), depHash(82));
  const b = await r.svc.register(REG(82)); assert.equal(b.status, 200); assert.equal(b.body.already, true);
  r.chain.addDeposit(82, {}); const c = await r.svc.register(REG(82, depHash(5))); assert.equal(c.status, 409); assert.equal(r.ledger.gasTxOf(gid(82)), depHash(82));
  assert.equal(r.sponsor.sent.length, 0); assert.equal(r.ledger.get(gid(82)), null);
});
const REG_CASES = [
  ["tx not found", (c, i) => c.txs.delete(depHash(i))], ["tx reverted", (c, i) => c.addDeposit(i, { status: "reverted" })], ["from someone else", (c, i) => c.addDeposit(i, { from: A(0x99) })],
  ["to another wallet", (c, i) => c.addDeposit(i, { to: A(0x98) })], ["data is not the giftId", (c, i) => c.addDeposit(i, { data: gid(i + 500) })], ["data empty", (c, i) => c.addDeposit(i, { data: "0x" })],
  ["value one wei below the computed minimum", (c, i) => c.addDeposit(i, { value: MIN_DEP - 1n })],
];
for (const [label, mut] of REG_CASES) await test(`A-913 G10(c): register refuses: ${label}`, async () => {
  const r = rig({ noRegister: true }); r.chain.addGift(83); mut(r.chain, 83);
  assert.equal((await r.svc.register(REG(83))).status, 409); assert.equal(r.ledger.gasTxOf(gid(83)), null);
});
await test("A-913 G10(c): register: gift missing/claimed -> 409; no fee input / rpc failure -> 503 not sent; hash registered for another gift -> 409; strict shape -> 400", async () => {
  const r = rig({ noRegister: true }); assert.equal((await r.svc.register(REG(84))).status, 409);              // unknown gift
  r.chain.addGift(85, { claimed: true }); assert.equal((await r.svc.register(REG(85))).status, 409);
  r.chain.addGift(86); r.chain.fee = 0n; assert.equal((await r.svc.register(REG(86))).body.error, "unavailable_not_sent"); r.chain.fee = FEE;
  r.chain.addGift(87); assert.equal((await r.svc.register(REG(87))).status, 200);
  r.chain.addGift(88); r.chain.addDeposit(88, { txHash: undefined }); assert.equal((await r.svc.register(REG(88, depHash(87)))).status, 409);
  for (const bad of [{}, { ...REG(87), extra: 1 }, { action: "other", giftId: gid(87), gasTx: depHash(87) }, { action: "register_gas_tx", giftId: "0x12", gasTx: depHash(87) }, { action: "register_gas_tx", giftId: gid(87) }]) assert.equal((await r.svc.register(bad)).status, 400);
});
await test("A-913 F: preflight is checked BEFORE the guards: code mismatch with the real gate => 503 unavailable_not_sent (not a 409 refusal), 0 sends", async () => {
  const { createPreflightGate } = await import("../src/gift-sponsor-preflight.mjs");
  const chain = fakeChain(); chain.addGift(89); const sponsor = fakeSponsor(); const ledger = openGiftSponsorLedger(); ledger.registerGasTx(gid(89), depHash(89));
  chain.codes[TS.toLowerCase()] = "0x60ff";
  const svc = createGiftSponsorService({ ledger, policy: POLICY, chain, sponsor, preflight: createPreflightGate({ policy: POLICY, getCode: (a) => chain.getCode(a) }) });
  const out = await svc.handle(await build(89)); assert.equal(out.status, 503); assert.equal(out.body.error, "unavailable_not_sent"); assert.equal(sponsor.sent.length, 0);
});

const REV_CASES = [
  ["revoke nonce is not install nonce + 1", { revNonce: 5 }, "revoke_nonce"],
  ["revoke authorization points at the impl, not 0x0", { revAddress: IMPL }, "revoke_address"],
  ["revoke authorization on another chain", { revChainId: 10143 }, "revoke_chainId"],
  ["revoke authorization signed by someone else", { revSigner: privateKeyToAccount(generatePrivateKey()) }, "revoke_signer"],
];
for (const [label, o, code] of REV_CASES) {
  await test(`A-913 D: ${label} -> refused(${code}), 0 sends`, async () => {
    const r = rig(); r.chain.addGift(38); const out = await r.svc.handle(await build(38, o));
    assert.equal(out.status, 409); assert.ok(refusedWith(r, code), JSON.stringify(r.logs)); assert.equal(r.sponsor.sent.length, 0); assert.equal(r.ledger.get(gid(38)), null);
  });
}
await test("A-913 D: the request is strict (5 keys + optional gasTx): the old 4-key form, a missing revokeAuthorization, extra keys, a non-bytes32 gasTx -> 400", async () => {
  const r = rig(); r.chain.addGift(39); const b = await build(39);
  const four = { giftId: b.giftId, authorization: b.authorization, delegation: b.delegation, claim: b.claim };
  const noRev = { ...b }; delete noRev.revokeAuthorization; const noTx = { ...b }; delete noTx.gasTx;
  for (const q of [four, noRev, { ...b, extra: 1 }, { ...b, gasTx: "0x12" }]) assert.equal((await r.svc.handle(q)).status, 400);
  assert.equal(r.sponsor.sent.length, 0);
});

await test("A-913 D: timeline install -> commit -> REVOKE -> claim; ledger INSTALLED -> COMMITTED -> REVOKED -> CLAIMED", async () => {
  const r = rig(); r.chain.addGift(40);
  const seen = []; const upd = r.ledger.update.bind(r.ledger); r.ledger.update = (id, st, p) => { seen.push(st); return upd(id, st, p); };
  const out = await r.svc.handle(await build(40));
  assert.equal(out.status, 200);
  assert.deepEqual(seen, ["INSTALLED", "COMMITTED", "REVOKED", "CLAIMED"]);
  const kinds = r.sponsor.sent.map((x) => x.kind);
  assert.ok(kinds.indexOf("revoke") > kinds.indexOf("redeem") && kinds.indexOf("revoke") < kinds.indexOf("claim"));
  assert.ok(/^0x[0-9a-f]{64}$/.test(out.body.revokeTxHash ?? ""));
  const e = r.ledger.get(gid(40)); assert.ok(e.commitTx && e.revokeTx && e.claimTx && e.inflight === null);
});

await test("A-913 D: revoke tx reverts -> claim still goes through (revoke never blocks claim)", async () => {
  const r = rig(); r.chain.addGift(42); r.sponsor.failKind = "revoke";
  const out = await r.svc.handle(await build(42));
  assert.equal(out.status, 200); assert.equal(r.sponsor.sent.at(-1).kind, "claim"); assert.notEqual(r.ledger.get(gid(42)).revokeStatus, "done");
  assert.equal(r.ledger.get(gid(42)).state, "CLAIMED");
});

await test("A-913 D: commit not confirmed (no log / hash mismatch) -> UNKNOWN, no revoke, no claim, no resend", async () => {
  const r = rig(); r.chain.addGift(43); r.chain.confirm = false;
  const out = await r.svc.handle(await build(43));
  assert.equal(out.status, 503); assert.deepEqual(r.sponsor.sent.map((x) => x.kind), ["install", "redeem"]);
  const e = r.ledger.get(gid(43)); assert.equal(e.state, "UNKNOWN"); assert.equal(e.inflight.kind, "redeem");
  assert.equal((await r.svc.handle(await build(43))).status, 409);
});

await test("A-913 D: inflight marker is durable BEFORE the broadcast", async () => {
  const r = rig(); r.chain.addGift(44); let atSend = null;
  const orig = r.sponsor.send; r.sponsor.send = async (x, o) => { if (x.kind === "redeem") atSend = r.ledger.get(gid(44)).inflight; return orig(x, o); };
  await r.svc.handle(await build(44));
  assert.equal(atSend.kind, "redeem"); assert.equal(typeof atSend.at, "number");
});

await test("A-913 F: preflight failing before the first send -> 503 unavailable_not_sent, 0 sends, gift not burned", async () => {
  const r = rig(); r.chain.addGift(45); r.setPreflight(false);
  const out = await r.svc.handle(await build(45));
  assert.equal(out.body.error, "unavailable_not_sent"); assert.equal(r.sponsor.sent.length, 0); assert.equal(r.ledger.get(gid(45)), null);
  r.setPreflight(true); assert.equal((await r.svc.handle(await build(45))).status, 200);
});

await test("A-913 F: preflight failing BETWEEN sends -> halts, no UNKNOWN, no further send, ledger keeps the last good state", async () => {
  const r = rig(); r.chain.addGift(46);
  const orig = r.sponsor.send; r.sponsor.send = async (x, o) => { const v = await orig(x, o); if (x.kind === "install") r.setPreflight(false); return v; };
  const out = await r.svc.handle(await build(46));
  assert.equal(out.status, 503); assert.deepEqual(r.sponsor.sent.map((x) => x.kind), ["install"]);
  const e = r.ledger.get(gid(46)); assert.equal(e.state, "INSTALLED"); assert.equal(e.inflight, null);
});

await test("A-913 G: health = sponsor balance vs floor 2 x claim gas x fee; below floor / no fee input -> ok:false and NEW requests refused", async () => {
  const r = rig(); r.chain.addGift(47);
  const FLOOR = 2n * 100000n * FEE; const h0 = await r.svc.health(); assert.equal(h0.ok, true); assert.equal(h0.floorWei, FLOOR.toString());
  r.chain.balance = FLOOR - 1n;
  const h1 = await r.svc.health(); assert.equal(h1.ok, false); assert.ok(h1.reasons.includes("below_floor"));
  const out = await r.svc.handle(await build(47)); assert.equal(out.body.error, "unavailable_not_sent"); assert.equal(r.sponsor.sent.length, 0);
  r.chain.balance = FLOOR; assert.equal((await r.svc.health()).ok, true);
  r.chain.fee = 0n; const h2 = await r.svc.health(); assert.equal(h2.ok, false); assert.ok(h2.reasons.includes("fee_unknown"));
});

await test("A-913 ledger: file mode 0600/0700, single writer lock, plan persisted, forward-only transitions, archive frees the giftId", () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "a913-")), "ledger"); const f = path.join(dir, "l.json");
  const L = openGiftSponsorLedger(f);
  assert.throws(() => openGiftSponsorLedger(f), /LEDGER_LOCKED/);
  L.reserve(gid(50), { depositTx: gid(900), commitHash: gid(1) });
  assert.throws(() => L.reserve(gid(50), {}), /ALREADY_RESERVED/);
  assert.throws(() => L.reserve(gid(51), { depositTx: gid(900) }), /DEPOSIT_ALREADY_USED/);
  L.update(gid(50), "INSTALLED"); L.update(gid(50), "COMMITTED");
  assert.throws(() => L.update(gid(50), "INSTALLED"), /BAD_TRANSITION/);
  L.update(gid(50), "UNKNOWN"); assert.throws(() => L.update(gid(50), "INSTALLED"), /BAD_TRANSITION/); L.update(gid(50), "REVOKED"); L.update(gid(50), "CLAIMED");
  assert.throws(() => L.update(gid(50), "UNKNOWN"), /BAD_TRANSITION/);
  assert.equal(statSync(f).mode & 0o777, 0o600); assert.equal(statSync(dir).mode & 0o777, 0o700);
  L.close(); const L2 = openGiftSponsorLedger(f); assert.equal(L2.get(gid(50)).state, "CLAIMED"); assert.equal(L2.get(gid(50)).plan.commitHash, gid(1));
  L2.reserve(gid(52), {}); L2.archive(gid(52), "test"); assert.equal(L2.get(gid(52)), null); L2.reserve(gid(52), {}); L2.close();
});

console.log(`\nPASS ${pass}  FAIL 0`);
