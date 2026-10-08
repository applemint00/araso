// [A-913] Shared offline fixtures for the reconcile / crash tests: throwaway in-memory viem keys, a STATEFUL fake chain ("world") and a scriptable sponsor.
// No network, no env, no real key. Not a test file by itself (underscore prefix).
import { createHash } from "node:crypto";
import { keccak256, encodeAbiParameters, encodePacked, encodeFunctionData, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createGiftSponsorPolicy, createGiftSponsorService, openGiftSponsorLedger } from "../src/gift-sponsor-service.mjs";
import { createGiftSponsorReconciler } from "../src/gift-sponsor-reconcile.mjs";

export const CHAIN = 143;
export const A = (n) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
export const ESCROW = A(0xe5), DM = A(0xd1), IMPL = A(0x1a), EXACT = A(0xe1), LIMIT = A(0xe2), TS = A(0xe3);
export const CODES = { [IMPL.toLowerCase()]: "0x6001", [DM.toLowerCase()]: "0x6002", [EXACT.toLowerCase()]: "0x6003", [LIMIT.toLowerCase()]: "0x6004", [TS.toLowerCase()]: "0x6005" };
export const sponsorAcct = privateKeyToAccount(generatePrivateKey());
export const piggy = privateKeyToAccount(generatePrivateKey());
export const SENDER = A(0xc3);
export const NOW = 1_800_000_000n;
export const FEE = 100n; // fee-per-gas fixture (wei)
export const gasTxOf = (giftId) => keccak256(giftId);
export const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
export const PRE = "0x" + "ab".repeat(32);
export const SALT = "0x" + "cd".repeat(32);
export const gid = (i) => `0x${i.toString(16).padStart(64, "0")}`;
const H = (c) => keccak256(c);
export const MIN_DEP = ((46429n + 174887n + 46382n + 100000n) * FEE * 11000n + 9999n) / 10000n; // = (units x fee) x (1 + 10%), ceiling (== minGasDepositWei)
export const CFG = { escrow: ESCROW, delegationManager: DM, delegateImpl: IMPL, sponsorAddress: sponsorAcct.address, exactExecutionEnforcer: EXACT, limitedCallsEnforcer: LIMIT, timestampEnforcer: TS,
  implCodeHash: H("0x6001"), delegationManagerCodeHash: H("0x6002"), exactExecutionCodeHash: H("0x6003"), limitedCallsCodeHash: H("0x6004"), timestampCodeHash: H("0x6005"), chainId: CHAIN, maxExpirySeconds: 300, gasUnits: { install: 46429n, commit: 174887n, revoke: 46382n, claim: 100000n }, gasBufferBps: 1000 };
const lcs = (a) => a.toLowerCase();
export const TEST_PINS = { addresses: { delegationManager: lcs(DM), delegateImpl: lcs(IMPL), exactExecutionEnforcer: lcs(EXACT), limitedCallsEnforcer: lcs(LIMIT), timestampEnforcer: lcs(TS) },
  hashes: { 143: { delegationManagerCodeHash: CFG.delegationManagerCodeHash, implCodeHash: CFG.implCodeHash, exactExecutionCodeHash: CFG.exactExecutionCodeHash, limitedCallsCodeHash: CFG.limitedCallsCodeHash, timestampCodeHash: CFG.timestampCodeHash } } };
export const POLICY = createGiftSponsorPolicy(CFG, TEST_PINS);
export const TOKEN_HASH = `0x${createHash("sha256").update(Buffer.from(PRE.slice(2), "hex")).digest("hex")}`;
export const DESIGNATOR = `0xef0100${IMPL.slice(2).toLowerCase()}`;
const TYPES = { Delegation: [{ name: "delegate", type: "address" }, { name: "delegator", type: "address" }, { name: "authority", type: "bytes32" }, { name: "caveats", type: "Caveat[]" }, { name: "salt", type: "uint256" }],
  Caveat: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }] };

export async function build(i) {
  const giftId = gid(i);
  const commitHash = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes" }, { type: "bytes32" }], [piggy.address, PRE, SALT]));
  const data = encodeFunctionData({ abi: [{ type: "function", name: "commitClaim", inputs: [{ type: "bytes32" }, { type: "bytes32" }], outputs: [], stateMutability: "nonpayable" }], functionName: "commitClaim", args: [giftId, commitHash] });
  const caveats = [
    { enforcer: EXACT, terms: encodePacked(["address", "uint256", "bytes"], [ESCROW, 0n, data]), args: "0x" },
    { enforcer: LIMIT, terms: encodeAbiParameters([{ type: "uint256" }], [1n]), args: "0x" },
    { enforcer: TS, terms: encodePacked(["uint128", "uint128"], [0n, NOW + 300n]), args: "0x" },
  ];
  const d = { delegate: sponsorAcct.address, delegator: piggy.address, authority: "0x" + "f".repeat(64), caveats, salt: 7n };
  const signature = await piggy.signTypedData({ domain: { name: "DelegationManager", version: "1", chainId: CHAIN, verifyingContract: DM }, types: TYPES, primaryType: "Delegation",
    message: { ...d, caveats: caveats.map(({ enforcer, terms }) => ({ enforcer, terms })) } });
  const auth = await piggy.signAuthorization({ contractAddress: IMPL, chainId: CHAIN, nonce: 0 });
  const rev = await piggy.signAuthorization({ contractAddress: ZERO_ADDR, chainId: CHAIN, nonce: 1 });
  return { giftId, commitHash, gasTx: gasTxOf(giftId),
    authorization: { chainId: Number(auth.chainId), address: auth.address ?? auth.contractAddress, nonce: Number(auth.nonce), r: auth.r, s: auth.s, yParity: auth.yParity },
    revokeAuthorization: { chainId: Number(rev.chainId), address: rev.address ?? rev.contractAddress, nonce: Number(rev.nonce), r: rev.r, s: rev.s, yParity: rev.yParity },
    delegation: { ...d, salt: d.salt.toString(), signature },
    claim: { recipient: piggy.address, preimage: PRE, salt: SALT, deadline: String(NOW + 400n) } };
}
export const wire = (b) => ({ giftId: b.giftId, authorization: b.authorization, revokeAuthorization: b.revokeAuthorization, delegation: b.delegation, claim: b.claim, gasTx: b.gasTx });

/** Stateful fake world: chain + scriptable sponsor. `script` = { kind, mode: "applied_then_throw" | "throw_before" | "applied_reverted_receipt" } fires once. */
export function makeWorld(i) {
  const id = gid(i);
  const w = {
    id, ts: NOW, codes: { ...CODES }, commits: new Map(), claimed: false, fee: FEE, depositTx: null, balance: 10n ** 18n, claimGasWei: 10n ** 15n,
    nonceLatest: 0n, noncePending: 0n, script: null, sends: [], receipts: new Map(), effects: { install: 0, redeem: 0, revoke: 0, claim: 0 },
    gift: { exists: true, sender: SENDER, expiry: NOW + 100000n, claimTokenHash: TOKEN_HASH },
    commitHash: null,
    async getTimestamp() { return w.ts; },
    async getGift() { return { ...w.gift, claimed: w.claimed }; },
    async getCode(a) { return w.codes[a.toLowerCase()] ?? "0x"; },
    async getNonce() { return 0n; },
    async simulate(x) { if (w.claimed && x.to.toLowerCase() === ESCROW.toLowerCase()) throw new Error("claimed"); },
    async waitBlockAfter() {},
    async getGasDepositTx(h) { return h === gasTxOf(id) ? (w.depositTx ?? { from: SENDER, to: sponsorAcct.address, value: MIN_DEP, status: "success", data: id }) : null; },
    async getFeePerGasWei() { return w.fee; },
    async confirmCommit({ commitHash }) { return w.commits.get(id)?.hash === commitHash; },
    async getCommit() { return w.commits.get(id) ?? null; },
    async getSponsorBalance() { return w.balance; },
    async getSponsorNonces() { return { latest: w.nonceLatest, pending: w.noncePending }; },
    async getReceipt(h) { return w.receipts.get(h) ?? null; },
  };
  w.sponsor = {
    address: sponsorAcct.address,
    async send(x, o) {
      w.sends.push({ kind: x.kind, to: x.to, value: x.value, authorizationList: x.authorizationList });
      const sc = w.script && w.script.kind === x.kind ? w.script : null;
      if (sc) w.script = null;
      if (sc?.mode === "throw_before") throw new Error("rpc down before broadcast");
      if (sc?.mode === "reverted") { w.noncePending += 1n; w.nonceLatest += 1n; return { txHash: keccak256(`0x${(w.sends.length + 0x80).toString(16)}`), blockNumber: 99n, status: "reverted" }; }
      w.noncePending += 1n;
      const hash = keccak256(`0x${(w.sends.length + 0x40).toString(16).padStart(2, "0")}`);
      try { await o?.onBroadcast?.(hash); } catch { /* ignore */ }
      w.nonceLatest += 1n;
      w.effects[x.kind] += 1;
      if (x.kind === "install") w.codes[piggy.address.toLowerCase()] = DESIGNATOR;
      if (x.kind === "redeem") w.commits.set(id, { hash: w.commitHash, blockNumber: 11n });
      if (x.kind === "revoke") w.codes[piggy.address.toLowerCase()] = "0x";
      if (x.kind === "claim") w.claimed = true;
      w.receipts.set(hash, { status: "success" });
      if (sc?.mode === "applied_then_throw") throw new Error("connection lost after broadcast");
      return { txHash: hash, blockNumber: 10n + BigInt(w.sends.length), status: "success" };
    },
  };
  return w;
}

/** Service + reconciler over a shared ledger and world. */
export function rigWorld(i, { graceSeconds = 60, nowMs = () => Date.now(), preflight = async () => true, ledger = openGiftSponsorLedger(), policy = POLICY, register = true, revokeMaxFailures = null, revokeBackoffSeconds = null } = {}) {
  const world = makeWorld(i);
  if (register) ledger.registerGasTx(world.id, gasTxOf(world.id));   // the sender registered giftId -> gasTx right after create
  const logs = [];
  const service = createGiftSponsorService({ ledger, policy, chain: world, sponsor: world.sponsor, preflight, log: (m) => logs.push(m), nowMs, revokeMaxFailures, revokeBackoffSeconds });
  const reconciler = createGiftSponsorReconciler({ ledger, policy, chain: world, steps: service.steps, runExclusive: service.runExclusive, log: (m) => logs.push(m), nowMs, inflightGraceSeconds: graceSeconds, revokeBackoffSeconds });
  return { world, ledger, service, reconciler, logs };
}
