// A-897 P1 [RELEASE 2 ENTRY · SAME #1 PROMOTION · identity/binding] — node only, network 0 (every testnet read is an injected stub), keys 0, tx 0.
//   node app/test/a897-release2-promotion.mjs
// Part U: gift-claim-entry.js (evidence ladder C4 -> C5 weak fallback, same-#1 binding), piggy-index.js / piggy-registry.js (promotion admit).
// Part M: node:vm over the ACTUAL main.js [A-897] block: branches (has / unknown / none), fresh device, #2/#3, case 3, Name-it.
// Part S: static - the block is the only main.js change vs the pre-A-897 copy, // comments only, no fetch call, wrappers keep originals.
import { restorePreA920 } from "./helpers/a920-restore.mjs";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as GE from "../src/gift-claim-entry.js";
import * as PI from "../src/piggy-index.js";
import * as PR from "../src/piggy-registry.js";
import { modelASaltHex } from "../src/piggy-session.js";
// [A-1023 RE-PIN] (Owner 10-11 14:1x: only the approved post-ee4fa91 hunks are cut; no whole-card exclusion) receipts/A1023_pin_attribution/ATTRIBUTION.md.
// The delimited [A-979 ④] badge block is cut by its markers; every other approved hunk (A-979 ④ import · A-995 ①②③ · A-995-b) is restored to its
// exact ee4fa91 text and only when it occurs exactly once — anything else stays in place, so any other main.js change still fails this pin.
const A1023_RESTORES = [["A-995 ②③ / A-995-b imports","import { registerA995InlineFace, syncA995GiftEyes } from \"./a995-eye-look.js\";\nimport { mountA995bLoadingPiggy } from \"./a995b-loading-piggy.js\";\n",""],["A-979 ④ import","import { mountForkVirtualMoneyBadge } from \"./fork-virtual-money-badge.js\";\n",""],["A-995 ① breath comment","// [A-995 ①] persistent breath: Owner-selected Sleep strength (x .0091 / y .026) on the existing 4.4 s loop, scaled about the\n","// [A-841 UI-27] persistent subtle breath: the first-arrival values (HOME_T_BREATHE sx 1-.008, sy 1+.014) on a slow loop, scaled about the\n"],["A-995 ① breath coefficients","  el.style.transform = `scale(${(1 - 0.0091 * b).toFixed(5)}, ${(1 + 0.026 * b).toFixed(5)})`;\n","  el.style.transform = `scale(${(1 - 0.008 * b).toFixed(5)}, ${(1 + 0.014 * b).toFixed(5)})`;\n"],["A-995 ② gift eyes (unchanged render)","  if (root && s.html === html) { a911Layout(); void syncA995GiftEyes(root); return; } // nothing changed: leave the DOM (focus, scroll, running transitions) alone\n","  if (root && s.html === html) { a911Layout(); return; } // nothing changed: leave the DOM (focus, scroll, running transitions) alone\n"],["A-995 ② gift eyes (sync)","  void syncA995GiftEyes(a911Root() || document);\n",""],["A-995 ③ tester intro face","  const face = el.querySelector(\".testerIntro__face\");\n  registerA995InlineFace(face);\n",""],["A-995 ③ tester intro blink","    setTimeout(() => el.classList.remove(\"is-closed\"), TESTER_INTRO_BLINK_MS - 120),\n",""],["A-995-b loading bridge","// [A-995-b] Same-turn PWA splash -> loading bridge. The browser cannot paint the first render\n// before this module task ends, so the approved 3.6 s overlay remains the first visible surface.\nmountA995bLoadingPiggy();\n",""]];
const A1023_CUT = (s) => { s = s.replace(/^\/\/ ── \[A-979 ④\] Fork virtual-money badge\.[\s\S]*?^\/\/ ── \[A-979 ④\] end ──\n/m, ""); for (const [, from, to] of A1023_RESTORES) if (s.split(from).length === 2) s = s.replace(from, () => to); return s; };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const BEFORE_PATH = path.join(REPO, "_private/ops/receipts/A897_release2_promotion/before/main.js");
const BEFORE = existsSync(BEFORE_PATH) ? readFileSync(BEFORE_PATH, "utf8") : null;
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) {
    if (e && e.publicSkip) { console.log(`SKIP  ${label} \u2014 ${e.publicSkip}`); return; }   // [A-921 B0] recorded skip reason, never a silent pass
    console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").slice(0, 8).join("\n      ")}`); fail += 1;
  }
}
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const SHMON = "0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9";
const CRED = "Y3JlZC1h";
const TESTNET = "monad-testnet";
const MAINNET = "monad-mainnet";
const NOW = "2026-10-08T00:00:00.000Z";
const mem = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
const seed = (st, chain, address, extra = {}) => PI.registerControlledPiggy(st, chain, { id: `legacy-${address.toLowerCase()}`, address, signerAddress: address, locator: { credentialId: CRED }, at: NOW, ...extra });
const hex = (n) => "0x" + BigInt(n).toString(16);

// injected testnet reader: { nonce, shmon, chain } deterministic stub; records calls; any method outside the whitelist throws.
function reader({ chain = 10143, nonce = 2n, bal = 0n, finalized = 1000, fail = null, tx = {}, receipts = {} } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push([method, params]);
    if (fail && (fail === true || fail === method)) throw new Error("down");
    switch (method) {
      case "eth_chainId": return hex(chain);
      case "eth_getBlockByNumber": return params[0] === "finalized" ? { number: hex(finalized), hash: "0x" + "ab".repeat(32) } : { number: params[0], hash: receiptsHashFor(params[0]) };
      case "eth_getTransactionCount": assert.equal(params[1], "finalized"); return hex(nonce);
      case "eth_call": assert.equal(params[1], "finalized"); return "0x" + bal.toString(16).padStart(64, "0");
      case "eth_getTransactionReceipt": return receipts[params[0]] ?? null;
      case "eth_getTransactionByHash": return tx[params[0]] ?? null;
      default: throw new Error(`method not whitelisted: ${method}`);
    }
  };
  return { rpc, calls };
}
function mainnetRpc({ chain = 143, nonce = 0n, mon = 0n, usdc = 0n, fail = null } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push([method, params]);
    if (fail && (fail === true || fail === method)) throw new Error("down");
    switch (method) {
      case "eth_chainId": return hex(chain);
      case "eth_getTransactionCount": assert.equal(params[1], "finalized"); return hex(nonce);
      case "eth_getBalance": assert.equal(params[1], "finalized"); return hex(mon);
      case "eth_call": assert.equal(params[1], "finalized"); return "0x" + usdc.toString(16).padStart(64, "0");
      default: throw new Error(`method not whitelisted: ${method}`);
    }
  };
  return { rpc, calls };
}
const receiptsHashFor = () => "0x" + "cd".repeat(32);

// ═══ Part U — modules ═══════════════════════════════════════════════════════════════════════════
await check("U1 C5 weak fallback (finalized only): N>=2 & S==0 -> has · N==0 -> none_confirmed · N==1 / S>0 -> none · flagged weakFallback", async () => {
  const E = GE.FIRST_JOURNEY_EVIDENCE;
  const run = async (o) => GE.readFirstJourneyEvidence({ rpc: reader(o).rpc, address: A, shmon: SHMON });
  assert.deepEqual(await run({ nonce: 2n }), { verdict: E.HAS, reason: "nonce_ge2_shmon_zero", via: "c5", weakFallback: true });
  assert.equal((await run({ nonce: 7n })).verdict, E.HAS);
  assert.equal((await run({ nonce: 0n })).verdict, E.NONE);
  assert.equal((await run({ nonce: 1n })).verdict, E.NONE);
  assert.equal((await run({ nonce: 3n, bal: 5n })).verdict, E.NONE);
});
await check("U2 every unreadable state is UNKNOWN (never none): null reader · throw · wrong chain · garbage hex · unreadable finality", async () => {
  const E = GE.FIRST_JOURNEY_EVIDENCE;
  assert.equal((await GE.readFirstJourneyEvidence({ rpc: null, address: A, shmon: SHMON })).verdict, E.UNKNOWN);
  assert.equal((await GE.readFirstJourneyEvidence({ rpc: reader({ fail: true }).rpc, address: A, shmon: SHMON })).verdict, E.UNKNOWN);
  assert.equal((await GE.readFirstJourneyEvidence({ rpc: reader({ fail: "eth_getTransactionCount" }).rpc, address: A, shmon: SHMON })).verdict, E.UNKNOWN);
  assert.equal((await GE.readFirstJourneyEvidence({ rpc: reader({ fail: "eth_call" }).rpc, address: A, shmon: SHMON })).verdict, E.UNKNOWN);
  assert.equal((await GE.readFirstJourneyEvidence({ rpc: reader({ chain: 143 }).rpc, address: A, shmon: SHMON })).reason, "chain_mismatch");
  assert.equal((await GE.readFirstJourneyEvidence({ rpc: async (m) => (m === "eth_chainId" ? hex(10143) : "zz"), address: A, shmon: SHMON })).verdict, E.UNKNOWN);
  assert.equal((await GE.readFirstJourneyEvidence({ rpc: reader().rpc, address: "nope", shmon: SHMON })).verdict, E.UNKNOWN);
});
await check("U3 C4: local D/R hashes verified on chain (from/to/selector/args/value/status/nonce+1/event/finalized/canonical) -> has via c4, not weak; any mismatch falls to C5", async () => {
  const { encodeFunctionData } = await import("viem");
  const ABI = [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }] }];
  const D = "0x" + "d1".repeat(32); const R = "0x" + "e2".repeat(32);
  const pad = (a) => "0x" + "0".repeat(24) + a.slice(2).toLowerCase();
  const mk = ({ rFrom = A, rOwner = A, rNonce = 5, status = "0x1", block = 900, ev = true } = {}) => {
    const mkRc = (h, topic, ownerIdx) => ({ transactionHash: h, status, blockNumber: hex(block), blockHash: "0x" + "cd".repeat(32), logs: ev ? [{ address: SHMON, topics: ["x", "x", "x", "x"].map((_, i) => (i === 0 ? topic : i === ownerIdx ? pad(A) : "0x" + "00".repeat(32))) }] : [] });
    return reader({
      nonce: 0n, // C5 would say none: proves the verdict comes from C4
      receipts: { [D]: mkRc(D, GE.SHMON_DEPOSIT_TOPIC0, 2), [R]: mkRc(R, GE.SHMON_WITHDRAW_TOPIC0, 3) },
      tx: {
        [D]: { hash: D, from: A, to: SHMON, nonce: hex(4), value: hex(10n ** 15n), input: encodeFunctionData({ abi: ABI, functionName: "deposit", args: [10n ** 15n, A] }) },
        [R]: { hash: R, from: rFrom, to: SHMON, nonce: hex(rNonce), value: "0x0", input: encodeFunctionData({ abi: ABI, functionName: "redeem", args: [1n, A, rOwner] }) },
      },
    });
  };
  const go = (r) => GE.readFirstJourneyEvidence({ rpc: r.rpc, address: A, shmon: SHMON, depositWei: 10n ** 15n, localHashes: [{ depositTxHash: D, redeemTxHash: R }] });
  const ok = await go(mk());
  assert.deepEqual([ok.verdict, ok.via, ok.weakFallback], ["has", "c4", false]);
  for (const bad of [{ rFrom: B }, { rOwner: B }, { rNonce: 9 }, { status: "0x0" }, { ev: false }]) {
    const out = await go(mk(bad));
    assert.notEqual(out.via === "c4" && out.verdict === "has", true, JSON.stringify(bad));
    assert.equal(out.verdict, "none_confirmed", `falls to C5 (N=0): ${JSON.stringify(bad)}`);
  }
  assert.equal((await go(mk({ block: 5000 }))).verdict, "unknown", "receipt newer than the finalized block -> not final yet -> retry");
});
await check("U4 same-#1 binding: promoted first only, signer must be the #1, one intent once; bindGiftToNewPiggy still refuses a known address", async () => {
  const intent = { giftId: "g1", token: "t" };
  assert.equal(GE.bindGiftToPromotedFirstPiggy({ intent, piggy: { address: A, id: "p" }, signerAddress: A }).reason, "not_promoted_first");
  assert.equal(GE.bindGiftToPromotedFirstPiggy({ intent, piggy: { address: A, promotedAt: NOW, sequence: 2 }, signerAddress: A }).reason, "not_promoted_first");
  assert.equal(GE.bindGiftToPromotedFirstPiggy({ intent, piggy: { address: A, promotedAt: NOW }, signerAddress: B }).reason, "signer_not_new_piggy");
  const ok = GE.bindGiftToPromotedFirstPiggy({ intent, piggy: { address: A, id: "p", promotedAt: NOW }, signerAddress: A });
  assert.equal(ok.ok, true); assert.equal(GE.isGiftBinding(ok.binding), true);
  assert.deepEqual([ok.binding.recipientAddress, ok.binding.sequence, ok.binding.promotedFirst], [A, null, true]);
  assert.equal(GE.bindGiftToPromotedFirstPiggy({ intent, piggy: { address: A, promotedAt: NOW }, signerAddress: A }).reason, "intent_already_bound");
  assert.equal(GE.bindGiftToNewPiggy({ intent: { giftId: "g2" }, piggy: { address: A }, preExistingAddresses: new Set([A.toLowerCase()]), signerAddress: A }).reason, "not_newly_created_piggy");
});
await check("U5 promoteFirstPiggyToScope: same #1 row (no sequence, issuedThrough 0), name carried from testnet, provenance carried only for the same passkey, #2/#3 stay in testnet", async () => {
  const st = mem();
  seed(st, TESTNET, A, { name: "Honeybun" }); PI.markBornPiggyIssuance(st, TESTNET, { address: A });
  assert.equal(PI.firstPiggyPromotionStatus(st, MAINNET, A).status, "candidate");
  const out = PI.promoteFirstPiggyToScope(st, { fromChainId: TESTNET, toChainId: MAINNET, address: A, signerAddress: A, locator: { credentialId: CRED }, id: `legacy-${A}`, at: NOW });
  assert.equal(out.ok, true, out.reason);
  const m = PI.loadMyPiggiesIndex(st, MAINNET).index;
  assert.equal(m.piggies.length, 1); assert.equal(m.issuedThrough, 0);
  assert.deepEqual([m.piggies[0].address, m.piggies[0].name, m.piggies[0].promotedAt, m.piggies[0].provenance, m.piggies[0].sequence], [A, "Honeybun", NOW, "birth", undefined]);
  assert.equal(PI.firstPiggyPromotionStatus(st, MAINNET, A).status, "promoted");
  assert.equal(PI.promoteFirstPiggyToScope(st, { fromChainId: TESTNET, toChainId: MAINNET, address: A, signerAddress: A, locator: { credentialId: CRED }, at: "2027-01-01T00:00:00.000Z" }).alreadyPromoted, true, "idempotent");
  // different passkey on the source row: no provenance carry
  const st2 = mem(); seed(st2, TESTNET, A); PI.markBornPiggyIssuance(st2, TESTNET, { address: A });
  PI.promoteFirstPiggyToScope(st2, { fromChainId: TESTNET, toChainId: MAINNET, address: A, signerAddress: A, locator: { credentialId: "b3RoZXI" }, at: NOW });
  assert.equal(PI.loadMyPiggiesIndex(st2, MAINNET).index.piggies[0].provenance, undefined);
});
await check("U6 promotion refusals write nothing: wrong signer · no proof · born in target scope (case 3) · another Piggy already in target · unreadable target · same scope", async () => {
  const st = mem();
  const args = { fromChainId: TESTNET, toChainId: MAINNET, address: A, locator: { credentialId: CRED }, at: NOW };
  assert.equal(PI.promoteFirstPiggyToScope(st, { ...args, signerAddress: B }).reason, "control_proof_mismatch");
  assert.equal(PI.promoteFirstPiggyToScope(st, { ...args, signerAddress: "" }).reason, "no_control_proof");
  assert.equal(PI.promoteFirstPiggyToScope(st, { ...args, toChainId: TESTNET, signerAddress: A }).reason, "invalid_chain");
  assert.equal(st.m.size, 0);
  seed(st, MAINNET, A); PI.markBornPiggyIssuance(st, MAINNET, { address: A });
  assert.equal(PI.firstPiggyPromotionStatus(st, MAINNET, A).status, "not_candidate");
  assert.equal(PI.promoteFirstPiggyToScope(st, { ...args, signerAddress: A }).reason, "not_promotable_born_here");
  const st3 = mem(); seed(st3, MAINNET, B);
  assert.equal(PI.promoteFirstPiggyToScope(st3, { ...args, signerAddress: A }).reason, "not_promotable_target_has_other_piggy");
  const st4 = mem(); st4.setItem(PI.myPiggiesIndexKey(MAINNET), "{corrupt");
  assert.equal(PI.firstPiggyPromotionStatus(st4, MAINNET, A).status, "unreadable");
  assert.equal(PI.promoteFirstPiggyToScope(st4, { ...args, signerAddress: A }).ok, false);
  assert.equal(st4.getItem(PI.myPiggiesIndexKey(MAINNET)), "{corrupt", "unreadable index is never overwritten");
});
await check("U7 registry: same #1 projection with name carry, no $0 claim, refuses when another Piggy is there", async () => {
  const st = mem();
  PR.saveRegistry(st, { accountId: A, chainId: TESTNET }, { piggies: [PR.normalizePiggy({ id: `legacy-${A}`, name: "Honeybun", address: A }).piggy] });
  const out = PR.promoteFirstPiggyRegistry(st, { fromScope: { accountId: A, chainId: TESTNET }, toScope: { accountId: A, chainId: MAINNET }, address: A, locator: { credentialId: CRED }, at: NOW });
  assert.equal(out.ok, true);
  const reg = PR.loadRegistry(st, { accountId: A, chainId: MAINNET }).registry;
  assert.deepEqual([reg.piggies.length, reg.piggies[0].name, reg.piggies[0].valuation], [1, "Honeybun", null]);
  const st2 = mem();
  PR.saveRegistry(st2, { accountId: A, chainId: MAINNET }, { piggies: [PR.normalizePiggy({ id: "x", address: B }).piggy] });
  assert.equal(PR.promoteFirstPiggyRegistry(st2, { fromScope: { accountId: A, chainId: TESTNET }, toScope: { accountId: A, chainId: MAINNET }, address: A, at: NOW }).reason, "target_has_other_piggy");
});

// ═══ Part M — node:vm over the REAL [A-897] block of main.js ═════════════════════════════════════════
function blockSrc() {
  const i = MAIN.indexOf("// ── [A-897] P1 Release-2");
  const w = MAIN.indexOf("// Wiring without touching the original bodies");
  const n = MAIN.indexOf("let a897PromotionRunning");
  assert.ok(i > 0 && w > i && n > i);
  return MAIN.slice(MAIN.indexOf("const A897_HOME_MESSAGE", i), w).replace(/^import .*$/gm, "");
}
function fnBodyOf(src, name) {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", src.indexOf(")", m.index)); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1; else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`end missing ${name}`);
}
const KEYS = { name: "araso.piggyName", salt: "araso.prfSalt", receipts: "araso.receipts" };

function device({ scope = MAINNET, testnetRows = [[A, "Honeybun"]], mainnetRows = [], name = "", gift = { giftId: "g-1", token: "TOK" }, reader: rd = reader(), cred = true, prf = A, claim = { result: "ok", valueSubmission: { status: "value_transferred" } }, mrd = null, preflight = { status: "ready" }, stamp = true, receipts = null } = {}) {
  const st = mem();
  const mainnetReader = mrd || mainnetRpc();
  if (name) st.setItem(KEYS.name, name);
  st.setItem(KEYS.salt, "00".repeat(32));
  if (receipts) st.setItem(KEYS.receipts, JSON.stringify(receipts));
  for (const [addr, nm] of testnetRows) seed(st, TESTNET, addr, nm ? { name: nm } : {});
  if (testnetRows.length) PI.markBornPiggyIssuance(st, TESTNET, { address: testnetRows[0][0] });
  for (const [addr, extra] of mainnetRows) seed(st, MAINNET, addr, extra || {});
  const calls = { scenes: [], settle: [], beginGift: 0, bindNew: 0, prf: 0, stamp: 0, sessionEnd: 0, fetch: 0 };
  const ctx = {
    console, Promise, Error, JSON, String, Uint8Array, Date, Array, Object,
    fetch: () => { calls.fetch += 1; throw new Error("network forbidden in test"); },
    RUNTIME_CHAIN_SCOPE: scope, CHAIN_PROFILE: { usdc: { address: USDC }, numericChainId: 143 },
    PROMOTION_TARGET_SCOPE: "monad-mainnet", // [A-946 RE-PIN] the promotion target constant now comes from boot-profile.js (= CHAIN_PROFILE_ID.MAINNET). pre-A-946: not needed
    readMainnetActivity: GE.readMainnetActivity, MAINNET_ACTIVITY: GE.MAINNET_ACTIVITY, GIFT_CLAIM_SUBMIT_STATUS: GE.GIFT_CLAIM_SUBMIT_STATUS,
    myPiggiesIndexKey: PI.myPiggiesIndexKey, piggyRegistryKey: PR.piggyRegistryKey, SHMON_ADDRESS: SHMON, SEND_AMOUNT: 10n ** 15n, RECEIPTS_KEY: KEYS.receipts, PIGGY_NAME_KEY: KEYS.name,
    GIFT_ENTRY_STATUS: GE.GIFT_ENTRY_STATUS, GIFT_RECORD_SOURCE: null, CLAIM_RESULT: { OK: "ok", ALREADY_CLAIMED_BY_OTHER: "already_claimed_by_other", ALREADY_CLAIMED_BY_SAME: "already_claimed_by_same" },
    localStorage: st,
    state: { scene: "received", address: cred ? A : "", credential: cred ? { credentialId: CRED } : null, activeSignerAddress: "", message: "", detail: "" },
    safeLocalStorage: () => st,
    secondJourneyScope: () => ({ accountId: cred ? A : "", chainId: scope }),
    modelARootCredential: () => (cred ? { credential: { credentialId: CRED }, reason: null } : { credential: null, reason: "missing_root_credential" }),
    storedPrfSalt: () => null,
    requestPrf: async () => { calls.prf += 1; return { prfOutput: new Uint8Array(32) }; },
    activateSigningSession: () => { ctx.state.activeSignerAddress = prf; return { address: prf }; },
    endActiveSession: () => { calls.sessionEnd += 1; ctx.state.activeSignerAddress = ""; },
    isCancelledAuthError: () => false,
    indexedPiggyId: (a) => `legacy-${String(a).toLowerCase()}`,
    readPiggyName: () => st.getItem(KEYS.name) || "",
    beginGiftClaim: async () => preflight,
    bindGiftToPromotedFirstPiggy: GE.bindGiftToPromotedFirstPiggy, bindGiftToNewPiggy: () => { calls.bindNew += 1; return { ok: false }; },
    readFirstJourneyEvidence: GE.readFirstJourneyEvidence, FIRST_JOURNEY_EVIDENCE: GE.FIRST_JOURNEY_EVIDENCE,
    firstPiggyPromotionStatus: PI.firstPiggyPromotionStatus, PROMOTION_STATUS: PI.PROMOTION_STATUS, promoteFirstPiggyToScope: PI.promoteFirstPiggyToScope,
    promoteFirstPiggyRegistry: PR.promoteFirstPiggyRegistry, loadMyPiggiesIndex: PI.loadMyPiggiesIndex,
    settleBoundGiftClaim: async (binding, intent) => { calls.settle.push({ to: binding.recipientAddress, giftId: intent.giftId, promotedFirst: binding.promotedFirst }); return claim; },
    beginGiftPiggy: () => { calls.beginGift += 1; },
    setScene: (s, message = "", detail = "") => { calls.scenes.push([s, message, detail]); Object.assign(ctx.state, { scene: s, message, detail }); },
    ...(stamp ? { playPromotionStampScene: () => { calls.stamp += 1; return { played: true }; } } : {}),
  };
  vm.createContext(ctx);
  const take = `${fnBodyOf(MAIN, "takePendingGiftClaim")}\n${fnBodyOf(MAIN, "restorePendingGiftClaim")}`;
  vm.runInContext(`let pendingGiftClaim = null; let lastGiftClaimSettlement = null; let giftPaperOffered = false;
const A897_TESTNET_READ_RPC_REAL = null;
${take}
${fnBodyOf(MAIN, "computeInitialScene")}
${fnBodyOf(MAIN, "displayPiggyName")}
${blockSrc().replace("const A897_TESTNET_READ_RPC = null;", "const A897_TESTNET_READ_RPC = globalThis.__rpc;").replace(/const A897_MAINNET_READ_RPC = .*;\n/, "const A897_MAINNET_READ_RPC = globalThis.__mrpc;\n")}
this.api = { initial: computeInitialScene, display: displayPiggyName, run: a897GiftOpenPromotion, keep: a897KeepOutOfNameIt, verdict: a897PromotionVerdict, indexedName: a897IndexedFirstName, hashes: a897LocalFirstHashes, setGift: (g) => { pendingGiftClaim = g; }, gift: () => pendingGiftClaim, offered: () => giftPaperOffered, last: () => lastGiftClaimSettlement };`, Object.assign(ctx, { __rpc: rd.rpc, __mrpc: mainnetReader.rpc }));
  ctx.api.setGift(gift ? { ...gift } : null);
  const mainnet = () => PI.loadMyPiggiesIndex(st, MAINNET).index;
  return { ctx, st, calls, rd, mrd: mainnetReader, api: ctx.api, state: ctx.state, mainnet };
}
const last = (d) => d.calls.scenes.at(-1);
const noForbidden = (d) => { assert.equal(d.calls.beginGift, 0); assert.equal(d.calls.bindNew, 0); assert.equal(d.calls.scenes.some((s) => ["hatch", "name"].includes(s[0])), false); assert.equal(d.mainnet().issuedThrough, 0); assert.equal(d.calls.fetch, 0); };

await check("M1 evidence HAS (C5 weak, N=2 S=0): Face ID once -> claim bound to the SAME #1 -> same #1 admitted with name carried -> Home -> stamp once; no sequence/beginGiftPiggy/Hatch/Name-it", async () => {
  const d = device({ reader: reader({ nonce: 2n }) });
  const out = await d.api.run();
  assert.deepEqual([out.started, out.evidence, out.promotion], [true, "has", true]);
  assert.deepEqual(d.calls.settle, [{ to: A, giftId: "g-1", promotedFirst: true }]);
  const row = d.mainnet().piggies;
  assert.deepEqual([row.length, row[0].address, row[0].name, !!row[0].promotedAt], [1, A, "Honeybun", true]);
  assert.equal(d.st.getItem(KEYS.name), "Honeybun", "name carried into the display source");
  assert.deepEqual([d.calls.prf, d.calls.stamp, last(d)[0], d.api.gift(), d.api.offered()], [1, 1, "sendstay", null, false]);
  assert.equal(d.api.last().promotion.weakFallback, true);
  noForbidden(d);
});
await check("M2 read failure (reader throws / null reader): NOTHING written or claimed, Gift stays unopened (intent kept, paper offered, scene received), no stamp; then a working retry succeeds", async () => {
  for (const rd of [reader({ fail: true }), { rpc: null, calls: [] }]) {
    const d = device({ reader: rd });
    const out = await d.api.run();
    assert.deepEqual([out.started, out.reason], [false, "first_journey_unreadable"]);
    assert.deepEqual([d.mainnet().piggies.length, d.calls.settle.length, d.calls.stamp, last(d)[0]], [0, 0, 0, "received"]);
    assert.deepEqual([d.api.gift()?.giftId, d.api.offered()], ["g-1", true]);
    noForbidden(d);
  }
  const d = device({ reader: reader({ fail: true }) });
  await d.api.run();
  d.ctx.__rpc = null;
  const retry = device({ reader: reader({ nonce: 2n }) });
  assert.equal((await retry.api.run()).started, true);
});
await check("M3 confirmed none (N=0, and N=1): same #1 admitted, claim to #1, NO stamp, Home (First Journey)", async () => {
  for (const nonce of [0n, 1n]) {
    const d = device({ reader: reader({ nonce }) });
    const out = await d.api.run();
    assert.deepEqual([out.started, out.evidence, d.calls.stamp, last(d)[0], d.mainnet().piggies.length, d.calls.settle.length], [true, "none_confirmed", 0, "sendstay", 1, 1]);
    noForbidden(d);
  }
});
await check("M4 the stamp is optional (hook absent -> no throw) and only on HAS", async () => {
  const d = device({ reader: reader({ nonce: 2n }), stamp: false });
  assert.equal((await d.api.run()).started, true);
  assert.equal(d.calls.stamp, 0);
});
await check("M5 testnet #2/#3 are not admitted: only the #1 row exists in mainnet; no issuedThrough movement", async () => {
  const d = device({ testnetRows: [[A, "Honeybun"], [B, "Two"], [C, "Three"]], reader: reader({ nonce: 2n }) });
  await d.api.run();
  assert.deepEqual(d.mainnet().piggies.map((p) => p.address), [A]);
  assert.equal(d.mainnet().issuedThrough, 0);
});
await check("M6 case 3 untouched: a mainnet-born Piggy / an already promoted #1 / another mainnet Piggy -> null (original startGiftOpen -> A-567 new Gift Piggy); no Face ID, no read", async () => {
  const born = device({ testnetRows: [], mainnetRows: [[A, {}]] }); PI.markBornPiggyIssuance(born.st, MAINNET, { address: A });
  const other = device({ testnetRows: [], mainnetRows: [[B, {}]] });
  const done = device({ reader: reader({ nonce: 2n }) });
  await done.api.run(); done.api.setGift({ giftId: "g-2", token: "T2" });
  for (const d of [born, other, done]) {
    const before = d.calls.prf; const n = d.rd.calls.length;
    assert.equal(await d.api.run(), null);
    assert.deepEqual([d.calls.prf, d.rd.calls.length], [before, n]);
  }
});
await check("M7 not case 2 -> null: no pending Gift · no Piggy on this device (fresh device keeps A-726/A-734 find-first) · testnet profile", async () => {
  assert.equal(await device({ gift: null }).api.run(), null);
  assert.equal(await device({ cred: false }).api.run(), null);
  assert.equal(await device({ scope: TESTNET }).api.run(), null);
});
await check("M8 identity: Face ID that recomputes a DIFFERENT address writes/claims nothing and offers the paper again", async () => {
  const d = device({ prf: B, reader: reader({ nonce: 2n }) });
  const out = await d.api.run();
  assert.deepEqual([out.started, out.reason, d.mainnet().piggies.length, d.calls.settle.length, d.rd.calls.length, d.api.gift()?.giftId], [false, "identity_mismatch", 0, 0, 0, "g-1"]);
});
await check("M9 claim refused/failed after binding: nothing admitted (retry re-derives from the chain), no stamp", async () => {
  const d = device({ reader: reader({ nonce: 2n }), claim: { status: "refused", reason: "expired" } });
  const out = await d.api.run();
  assert.deepEqual([out.started, d.mainnet().piggies.length, d.calls.stamp, last(d)[0]], [false, 0, 0, "sendstay"]);
  const same = device({ reader: reader({ nonce: 2n }), claim: { status: "refused", reason: "already_claimed_by_same" } });
  assert.equal((await same.api.run()).started, true, "already claimed by this same #1 still admits the same #1");
});
await check("M10 record cannot open (product default record source): 0 Face ID, 0 read, Home", async () => {
  const d = device({ preflight: { status: "record_source_unavailable", giftId: "g-1" } });
  const out = await d.api.run();
  assert.deepEqual([out.started, out.reason, d.calls.prf, d.rd.calls.length, last(d)[0]], [false, "record_source_unavailable", 0, 0, "sendstay"]);
});
await check("M11 [P2 Q1] Name-it re-entry: computeInitialScene keeps a promoted #1 / a recovered registered Piggy with an empty name on Home; only a Piggy just born here (birth, not promoted), no row, a named-elsewhere case, or the testnet profile follows the old rule", async () => {
  const init = (d) => d.api.initial(true, false, true);
  const promoted = device({ reader: reader({ nonce: 2n }), testnetRows: [[A, null]] });
  await promoted.api.run();
  assert.equal(promoted.st.getItem(KEYS.name), null, "unnamed stays unnamed (nothing invented)");
  assert.deepEqual([init(promoted), promoted.api.keep(), promoted.api.verdict()], ["sendstay", true, "has"]);
  const recovered = device({ testnetRows: [], mainnetRows: [[A, {}]] });                       // checkPiggy row: no provenance, never promoted
  assert.deepEqual([init(recovered), recovered.api.keep()], ["sendstay", true]);
  const born = device({ testnetRows: [], mainnetRows: [[A, {}]] }); PI.markBornPiggyIssuance(born.st, MAINNET, { address: A });
  assert.deepEqual([init(born), born.api.keep()], ["name", false], "just-born, first name not saved: the existing Name-it flow");
  assert.equal(init(device({ testnetRows: [] })), "name", "no row at all: unchanged");
  assert.equal(device({ testnetRows: [], mainnetRows: [[A, {}]], name: "Zed" }).api.initial(true, false, true), "sendstay", "named: unchanged");
  const tn = device({ scope: TESTNET, testnetRows: [], mainnetRows: [] }); seed(tn.st, TESTNET, A);
  assert.deepEqual([init(tn), tn.api.keep()], ["name", false], "testnet profile unchanged");
});
await check("M11b [P2 Q5] the name source is the chain-scoped index: an indexed name shows (and is not 'unnamed'); empty -> 'Piggy'", async () => {
  const named = device({ testnetRows: [], mainnetRows: [[A, { name: "Honeybun" }]] });
  assert.deepEqual([named.api.display(), named.api.indexedName(), named.api.keep(), named.api.initial(true, false, true)], ["Honeybun", "Honeybun", true, "sendstay"]);
  const empty = device({ testnetRows: [], mainnetRows: [[A, {}]] });
  assert.deepEqual([empty.api.display(), empty.api.indexedName()], ["Piggy", ""]);
  const dev = device({ testnetRows: [], mainnetRows: [[A, { name: "Honeybun" }]], name: "Local" });
  assert.equal(dev.api.display(), "Local", "the device-level name still wins when present");
});
await check("M13 [C1] stamp only after a CONFIRMED transfer: claim ok but value pending/failed -> admitted, Home, NO stamp; claim refused/failed -> the admit is undone (retry converges), NO stamp", async () => {
  for (const vs of [{ status: "claim_transport_unavailable" }, { status: "claim_submit_failed" }, undefined]) {
    const d = device({ reader: reader({ nonce: 2n }), claim: { result: "ok", ...(vs ? { valueSubmission: vs } : {}) } });
    const out = await d.api.run();
    assert.deepEqual([out.started, out.stamped, d.calls.stamp, d.mainnet().piggies.length, last(d)[0], d.api.last().promotion.transferConfirmed], [true, false, 0, 1, "sendstay", false], JSON.stringify(vs));
  }
  const done = device({ reader: reader({ nonce: 2n }) });
  const o = await done.api.run();
  assert.deepEqual([o.stamped, done.calls.stamp, done.api.last().promotion.transferConfirmed], [true, 1, true]);
  // refused -> nothing admitted afterwards, state restored byte for byte
  const d = device({ reader: reader({ nonce: 2n }), claim: { status: "refused", reason: "expired" }, testnetRows: [[A, "Honeybun"]] });
  const key = PI.myPiggiesIndexKey(MAINNET);
  const before = d.st.getItem(key);
  const out = await d.api.run();
  assert.deepEqual([out.started, d.calls.stamp, d.st.getItem(key), PI.firstPiggyPromotionStatus(d.st, MAINNET, A).status], [false, 0, before, "candidate"]);
  // a recovered (unpromoted) mainnet row is restored exactly
  const r = device({ reader: reader({ nonce: 2n }), claim: { status: "claim_settle_failed" }, mainnetRows: [[A, {}]] });
  const rb = r.st.getItem(key);
  await r.api.run();
  assert.equal(r.st.getItem(key), rb);
});
await check("M14 [C2] case 2 vs 3 by the live chain: local #1 -> case 3 (null) · else finalized nonce>0 / MON>0 / USDC>0 -> case 3 (null, no Face ID) · no activity -> case 2 + ladder · any read failure -> unopened/retry", async () => {
  for (const o of [{ nonce: 1n }, { mon: 5n }, { usdc: 7n }]) {
    const d = device({ reader: reader({ nonce: 2n }), mrd: mainnetRpc(o) });
    assert.equal(await d.api.run(), null, JSON.stringify(o, (k, v) => (typeof v === "bigint" ? String(v) : v)));
    assert.deepEqual([d.calls.prf, d.rd.calls.length, d.mainnet().piggies.length, d.calls.settle.length], [0, 0, 0, 0], "no Face ID, no testnet read, nothing written");
  }
  for (const f of [{ fail: true }, { fail: "eth_getBalance" }, { fail: "eth_call" }, { chain: 10143 }]) {
    const d = device({ reader: reader({ nonce: 2n }), mrd: mainnetRpc(f) });
    const out = await d.api.run();
    assert.deepEqual([out.started, out.reason, d.calls.prf, d.rd.calls.length, d.mainnet().piggies.length, last(d)[0], d.api.gift()?.giftId], [false, "mainnet_activity_unreadable", 0, 0, 0, "received", "g-1"], JSON.stringify(f));
  }
  const noReader = device({ reader: reader({ nonce: 2n }), mrd: { rpc: null, calls: [] } });
  assert.equal((await noReader.api.run()).reason, "mainnet_activity_unreadable");
  const unused = device({ reader: reader({ nonce: 2n }), mrd: mainnetRpc() });
  assert.equal((await unused.api.run()).started, true);
  assert.deepEqual(unused.mrd.calls.map((c) => c[0]), ["eth_chainId", "eth_getTransactionCount", "eth_getBalance", "eth_call"]);
});
await check("M15 [C3] the HAS/NONE verdict is persisted on the chain-scoped promoted row and survives a reload (index re-read)", async () => {
  const has = device({ reader: reader({ nonce: 2n }) }); await has.api.run();
  const none = device({ reader: reader({ nonce: 0n }) }); await none.api.run();
  assert.deepEqual([has.mainnet().piggies[0].firstJourney, none.mainnet().piggies[0].firstJourney], ["has", "none"]);
  assert.deepEqual([has.api.verdict(), none.api.verdict(), has.state.promotionVerdict, none.state.promotionVerdict], ["has", "none", "has", "none"]);
  assert.equal(device({ testnetRows: [], mainnetRows: [[A, {}]] }).api.verdict(), null, "not promoted -> null");
  const st = mem(); seed(st, MAINNET, A);
  assert.equal(PI.promoteFirstPiggyToScope(st, { fromChainId: TESTNET, toChainId: MAINNET, address: A, signerAddress: A, locator: { credentialId: CRED }, at: NOW, firstJourney: "maybe" }).reason, "invalid_first_journey");
  st.setItem(PI.myPiggiesIndexKey(MAINNET), JSON.stringify({ version: 1, chainId: MAINNET, issuedThrough: 0, piggies: [{ id: "legacy-x", address: A, locator: { credentialId: CRED }, createdAt: NOW, lastControlProofAt: NOW, firstJourney: "has" }] }));
  assert.equal(PI.loadMyPiggiesIndex(st, MAINNET).index.piggies.length, 0, "a verdict without a promotion stamp is not a row");
});
await check("M12 local hashes: read from the legacy receipt store as confirm-only input, malformed rows ignored", async () => {
  const D = "0x" + "d1".repeat(32); const R = "0x" + "e2".repeat(32);
  const d = device({ receipts: [{ depositTxHash: D, redeemTxHash: R }, { txHash: "x" }, null, { depositTxHash: 5 }] });
  assert.deepEqual(JSON.parse(JSON.stringify(d.api.hashes())), [{ depositTxHash: D, redeemTxHash: R }]);
  assert.deepEqual(JSON.parse(JSON.stringify(device({}).api.hashes())), []);
});

// ═══ Part S — static ═══════════════════════════════════════════════════════════════════════════
await check("S1 main.js differs from the pre-A-897 copy ONLY by the [A-897] P1/P2 blocks and the two P1-fix one-line edits (computeInitialScene Name-it guard · displayPiggyName index fallback)", async () => {
  // [A-897 P1-fix · pre-A-897 P1-fix baseline: blocks only] P2 Q1 / Q5 made Cowork-approved edits inside computeInitialScene and displayPiggyName; they are reverted here to compare the rest.
  // [A-921 B0] the pre-A-897 main.js baseline is a private-workspace snapshot; a public checkout has no _private/, so this comparison is SKIPPED there (reason printed). With _private/ present it still FAILS when the baseline is missing.
  if (!BEFORE && !existsSync(path.join(REPO, "_private"))) { const sk = new Error("skip"); sk.publicSkip = "pre-A-897 main.js baseline exists only in the private workspace (public checkout)"; throw sk; }
  assert.ok(BEFORE, "before/main.js missing");
  const cut = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); let j = src.indexOf(b, i); assert.ok(j >= 0, b); j = src.indexOf("\n", j) + 1; return [src.slice(0, i), src.slice(j)]; };
  let [h, t] = cut(restorePreA920(A1023_CUT(MAIN)) /* [A-1023 RE-PIN] pre-A-1023: restorePreA920(MAIN) */, "// ── [A-897] P1 Release-2", "// ── [A-897] end P1"); // [A-920 RE-PIN] pre-A-920 baseline: cut(MAIN, ...) (A-920 edits four main.js functions + eight const lines, pinned by a920-main-js-scope.mjs)
  assert.equal(MAIN.indexOf("// ── [A-897] P1 Release-2", MAIN.indexOf("// ── [A-897] P1 Release-2") + 1), -1, "one P1 block");
  let rest = h + t.slice(1);
  // pre-A-912 baseline: main.js == the pre-A-897 copy plus the A-897 blocks. [A-912 re-pin, Cowork-approved] strip the A-912 additions first: the A912_PRODUCT_BUILD const, the
  // delimited comment-only [A-912] block, the two DEV-gated preview-tag expressions (restored to the plain tag), and restore the removed mobile Invite copy line.
  { const [x, y] = cut(rest, "// ── [A-912] small fixes", "// ── [/A-912]"); rest = x + y; }
  { const c = rest.indexOf("// [A-912] true in the product build"); assert.ok(c >= 0, "A-912 const"); const e = rest.indexOf("\n", rest.indexOf("const A912_PRODUCT_BUILD", c)) + 1; rest = rest.slice(0, c) + rest.slice(e); }
  { const re = /\$\{\/\* \[A-912\] preview tag[^*]*\*\/ \(typeof A912_PRODUCT_BUILD !== "undefined" && A912_PRODUCT_BUILD\) \? "" : (`<p class="secondJourney__mockTag">UI preview — no transaction<\/p>`)\}/g; assert.equal((rest.match(re) || []).length, 2, "two preview-tag gates"); rest = rest.replace(re, (m, tag) => tag.slice(1, -1)); }
  { const k = "          ${chogInviteMarkup()}\n        </div>\n        <div class=\"invite__corner\" aria-hidden=\"true\"></div>\n"; assert.equal(rest.split(k).length, 2, "mobile Invite corner anchor"); rest = rest.replace(k, "          ${chogInviteMarkup()}\n        </div>\n        <p class=\"invite__copy\">it's safe. only you can open it.</p>\n        <div class=\"invite__corner\" aria-hidden=\"true\"></div>\n"); }
  for (const [a, b] of [["// ── [A-897] P2 imports", "// ── [A-897] end P2 imports"], ["// ── [A-897 P2] 승격", "// ── [A-897 P2] end"]]) { const [x, y] = cut(rest, a, b); rest = x + y; }
  const g1 = '  // [A-897 P1-fix · P2 Q1] a promoted #1 / an already registered Piggy (chain-scoped index record) is never sent back to Name-it for an empty name.\n  if (!readPiggyName() && !(typeof a897RegisteredUnnamedHome === "function" && a897RegisteredUnnamedHome())) return "name";\n';
  assert.ok(rest.includes(g1), "computeInitialScene guard present");
  rest = rest.replace(g1, '  if (!readPiggyName()) return "name";\n');
  const g2 = '  // [A-897 P1-fix · P2 Q5] the name source is the chain-scoped index: an indexed name shows when the device-level name is empty.\n  const name = readPiggyName().trim() || (typeof a897IndexedFirstName === "function" ? a897IndexedFirstName() : "");\n';
  assert.ok(rest.includes(g2), "displayPiggyName fallback present");
  rest = rest.replace(g2, '  const name = readPiggyName().trim();\n');
  // [A-893b F1 hooks · pre-A-893b-F1 baseline] the idle-lock-unlock open count (declarations + armAwayOpenLine head + the renderAppLock note) is not part of A-897; reverted to compare the rest.
  for (const hook of ["// [A-893b F1 \u00b7 Owner via Cowork 2026-10-08 OUTBOX answer] an idle-lock unlock inside the same Away is the next open too. Hooked from OUTSIDE the pinned\n// functions: renderAppLock() notes the lock (unpinned), and the Away mount that follows the unlock (armAwayOpenLine) counts it once. `var` on purpose:\n// renderAppLock() can run before this line during boot (no TDZ). A boot lock is not counted (no Away has mounted yet in this page life).\nvar awayMountedOnce = false;\nvar awayLockedInAway = false;\nfunction noteAwayLocked() {\n  if (awayMountedOnce && state.scene === \"away\") awayLockedInAway = true;\n}\n\n", "  awayMountedOnce = true;\n  if (state.departureArrival) { awayOpenCount = 1; awayLockedInAway = false; }   // a new departure = a new Away\n  if (awayLockedInAway && !state.appLock) {         // the mount right after an unlock: one open, counted once, no timer\n    awayLockedInAway = false;\n    awayOpenCount += 1;\n    if (state.awayRestore === \"pending\") showAwayRestore(\"pending\");\n  }\n", "  if (typeof noteAwayLocked === \"function\") noteAwayLocked(); // [A-893b F1] lock seen while an Away is mounted\n"]) { assert.ok(rest.includes(hook), "A-893b F1 hook present"); rest = rest.replace(hook, hook === "  awayMountedOnce = true;\n  if (state.departureArrival) { awayOpenCount = 1; awayLockedInAway = false; }   // a new departure = a new Away\n  if (awayLockedInAway && !state.appLock) {         // the mount right after an unlock: one open, counted once, no timer\n    awayLockedInAway = false;\n    awayOpenCount += 1;\n    if (state.awayRestore === \"pending\") showAwayRestore(\"pending\");\n  }\n" ? "  if (state.departureArrival) awayOpenCount = 1;   // a new departure = a new Away\n" : ""); }
  // [A-902 re-pin, named · Cowork answer "질문 · A-902"] pre-A-902 baseline: main.js minus the delimited [A-902] block and its two one-line
  // `a902WatchReturn(returnView, valid); // [A-902] bell + toss sounds` hooks (mountReturn · mountSecondReturn) == the pre-A-902 main.js. No other assertion changes.
  { const [x, y] = cut(rest, "// ── [A-902] Sound set wiring", "// ── [A-902] end"); rest = x + y; }
  // pre-A-904 baseline: main.js minus the delimited [A-904] jar-guide block == the pre-A-904 main.js (re-pin only, no other assertion changes).
  { const [x, y] = cut(rest, "// ── [A-904] One-time guide", "// ── [/A-904]"); rest = x + y; }
  rest = rest.split("  a902WatchReturn(returnView, valid); // [A-902] bell + toss sounds\n").join("");
  // pre-A-898 baseline: main.js minus the [A-898] blocks and the four small A-898 hooks (openAddMoney single branch · homeMoneyBodyMarkup slot ·
  // homePadMarkup close · click delegation) == the pre-A-898 (post-A-897) main.js. Re-pin only; no other assertion here changes.
  for (const [a, b] of [["// ── [A-898] imports", "// ── [A-898] end imports"], ["// ── [A-898] Funding Paper", "// ── [A-898] end"]]) { const [x, y] = cut(rest, a, b); rest = x + y; }
  for (const hook of [
    "    // [A-898] one Piggy: Add money opens the Funding Paper (three rows) for that Piggy.\n    if (a898OpenFundingPaper(only, null)) return;\n",
    "  // [A-898] Funding Paper / Send a Piggy occupy the same slot while open.\n  if (a898Active() && addMoneyEntryAllowed()) {\n    return homeMoneyMarkup({ title: \"MY MONEY\", time, rows: [], afterRowsMarkup: a898BodyMarkup() });\n  }\n",
    "  if (mode !== \"money\") a898Close(); // [A-898]\n",
  ]) { assert.ok(rest.includes(hook), "A-898 hook present"); rest = rest.replace(hook, ""); }
  { const i = rest.indexOf("  // [A-898] Funding Paper / Send a Piggy actions"); assert.ok(i >= 0, "A-898 click hook"); const j = rest.indexOf("  // [A-646] Add money — 열기", i); rest = rest.slice(0, i) + rest.slice(j); }
  // pre-A-905 baseline: main.js minus the [A-905] import/wiring block pairs and the five A-905 hooks (homePaperEffectiveMode base · homeMoneyBodyMarkup a905Body ·
  // homePadMarkup a905Reset · click delegation a905HandleClick · a898FundingArrival a905OfferArrival) == the pre-A-905 main.js. Re-pin only (Cowork ratified).
  for (const [a, b] of [["// ── [A-905] imports", "// ── [A-905] end imports"], ["// ── [A-905] Honey jar", "// ── [A-905] end"]]) { const [x, y] = cut(rest, a, b); rest = x + y; }
  for (const [hook, orig] of [
    ['  const base = scene === "sendstay" ? state.homePaperMode : "home";\n  return typeof a905EffectiveMode === "function" ? a905EffectiveMode(scene, base) : base; // [A-905] the Money tab on an Away Home scene\n', '  return scene === "sendstay" ? state.homePaperMode : "home";\n'],
    ['  const a905Body = typeof a905BodyMarkup === "function" ? a905BodyMarkup(time) : null; // [A-905] the Money tab (opened by the honey jar)\n  if (a905Body !== null) return a905Body;\n', ""],
    ['      methodsMarkup: typeof a905PlanFundingMarkup === "function" ? a905PlanFundingMarkup(methodsMarkup) : methodsMarkup, // [A-905] the Funding rows instead of the methods list\n', "      methodsMarkup,\n"],
    ['  const addMoneyEntry = ""; // [A-905] the Add money entry moved to the honey jar -> Money tab. pre-A-905: addMoneyEntryAllowed() ? addMoneyEntryMarkup() : ""\n', '  const addMoneyEntry = addMoneyEntryAllowed() ? addMoneyEntryMarkup() : "";\n'],
    ['  if (mode !== "money" && typeof a905Reset === "function") a905Reset(); // [A-905]\n', ""],
    ['  if (typeof a905HandleClick === "function" && a905HandleClick(event)) return; // [A-905] Money tab actions (also on an Away Home scene)\n', ""],
  ]) { assert.ok(rest.includes(hook), "A-905 hook present"); rest = rest.replace(hook, orig); }
  // (the a898FundingArrival a905OfferArrival hook lives inside the [A-898] block already stripped above)
  // pre-A-898-fit baseline: the two one-line A-898 fit hooks in refreshHomePaperMount (scroll snapshot before the rebuild, restore after it) are reverted to compare the rest;
  // their functions live inside the delimited [A-898] block already stripped above. Named re-pin only (A-898/A-905 layout fit pass); no other assertion changes.
  for (const hook of ['  const a898Scroll = typeof a898ScrollSnapshot === "function" ? a898ScrollSnapshot(mount) : null; // [A-898 fit] keep the Gift / Funding scroll position\n', '  if (a898Scroll) a898ScrollRestore(mount, a898Scroll); // [A-898 fit]\n']) { assert.ok(rest.includes(hook), "A-898 fit hook present"); rest = rest.replace(hook, ""); }
  // pre-A-803-fix baseline: the [A-803 fix · A-831 slots] companion sleepFit block (comments + paperInk/clear + `obstacles: clear`) is reverted to the old single fitWideSlot line to compare the rest. Re-pin only (standing permission).
  { const i = rest.indexOf("    // [A-803 fix · A-831 slots]"); assert.ok(i >= 0, "A-803 fix block present"); const k = "    const clear = "; const a = rest.indexOf(k, i); const j = rest.indexOf("\n", a) + 1; rest = rest.slice(0, i) + rest.slice(j); assert.ok(rest.includes("obstacles: clear,"), "A-803 fix call"); rest = rest.replace("obstacles: clear,", "obstacles: [...obstacles, ...extra],"); }
  // pre-A-803-fix baseline (debug hook round): __arasoSleepPlan hook = sleepWhy() + the dbg loop in planHomeSleepers + the mount `entries` line; all LOCAL_DEV_ENTRY-gated, no behaviour. Reverted here to compare the rest.
  { const cutBlock = (a, b, repl) => { const i = rest.indexOf(a); assert.ok(i >= 0, a); const j = rest.indexOf(b, i); assert.ok(j >= 0, b); rest = rest.slice(0, i) + repl + rest.slice(j + b.length); };
    cutBlock("  // [A-803 fix \u00b7 A-831 slots] debug only (read by planHomeSleepers", "  return { order, placed, slotOf, assignment, wide, fitAt, sleepFit, sleepWhy };", "  return { order, placed, slotOf, assignment, wide, fitAt, sleepFit };");
    cutBlock("  const dbg = [];\n", "  return sleepers;", "  for (const { id, slot } of set.placed) {\n    if (slot.seat || !homeSleepEligible(assignment.get(id)?.state)) continue;\n    const fit = set.sleepFit(id, taken);\n    if (!fit) continue;\n    sleepers.set(id, fit.dx);\n    taken.push(fit.rect);\n  }\n  return sleepers;");
    cutBlock("  // [A-803 fix \u00b7 A-831 slots] dev/test builds only: what the mount received", "e.sleepShiftPx }));\n", ""); }
  // pre-A-911 baseline: main.js minus the [A-911] imports block and the [A-911] own-screens wiring block == the pre-A-911 (post-A-912) main.js. Re-pin only.
  for (const [a, b] of [["// ── [A-911] imports", "// ── [A-911] end imports"], ["// ── [A-911] Own screens", "// ── [A-911] end"]]) { const [x, y] = cut(rest, a, b); rest = x + y; }
  // pre-A-915 baseline: main.js minus the [A-915] imports block and the [A-915] Gift create wiring block == the pre-A-915 main.js. Re-pin only (standing permission, INBOX :74201);
  // no other assertion changes. (The three typeof-guarded [A-915] hooks live inside a898FaceId, i.e. inside the [A-898] block already stripped above.)
  for (const [a, b] of [["// ── [A-915] imports", "// ── [A-915] end imports"], ["// ── [A-915] Gift create on Monad mainnet", "// ── [A-915] end"]]) { const [x, y] = cut(rest, a, b); rest = x + y; }
  // [A-966 re-pin] pre-A-966 baseline: no [A-966] block. main.js minus the one delimited [A-966] fork Gift block == the pre-A-966 main.js. Re-pin only.
  { const [x, y] = cut(rest, "// ── [A-966] Gift on the shared fork", "// ── [A-966] end Gift on the shared fork"); rest = x + y; }
  // [A-966 re-pin · gap left by A-960] the [A-960] invite block was never cut here (S1 failed on the tree before A-966); cut the same way. pre: no cut.
  { const [x, y] = cut(rest, "// ── [A-960] invite link → first grant.", "// ── [A-960] end invite link"); rest = x + y; }
  // [A-974 re-pin] pre-A-974 baseline: no [A-974] block. main.js minus the one delimited [A-974] fork entry block == the pre-A-974 main.js. Re-pin only.
  { const [x, y] = cut(rest, "// ── [A-974] Fork app entry", "// ── [A-974] end fork app entry"); rest = x + y; }
  // [A-977 re-pin] pre-A-977 baseline: no [A-977] block. Cut the one delimited [A-977] Job 10 fork block too. Re-pin only.
  { const [x, y] = cut(rest, "// ── [A-977] Job 10 on the shared fork", "// ── [A-977] end Job 10 on the shared fork"); rest = x + y; }
  assert.equal(rest.replace(/\n{2,}/g, "\n"), BEFORE.replace(/\n{2,}/g, "\n"));
});
await check("S2block hygiene: // comments only (the stray /* in main.js), the only fetch is inside a897FetchRpc, testnet reader default null, no storage key invented", async () => {
  const i = MAIN.indexOf("// ── [A-897] P1 Release-2"); const j = MAIN.indexOf("// ── [A-897] end P1");
  const b = MAIN.slice(i, j);
  assert.equal(b.includes("/*"), false);
  assert.match(b, /const A897_TESTNET_READ_RPC = null;/);
  assert.equal((b.match(/\bfetch\(/g) || []).length, 1);
  assert.equal(b.indexOf("fetch(") > b.indexOf("function a897FetchRpc") && b.indexOf("fetch(") < b.indexOf("function a897LocalFirstHashes"), true);
  assert.equal((b.replace(/\/\/.*$/gm, "").match(/a897FetchRpc\(/g) || []).length, 2, "definition + the single live-scope reader construction (reuses RETURN_EVIDENCE_READ_CONFIG); the testnet reader stays null");
  assert.equal(/localStorage\.setItem\(/.test(b), true);
  assert.deepEqual([...b.matchAll(/localStorage\.setItem\(([^,]+),/g)].map((m) => m[1]), ["PIGGY_NAME_KEY"], "the only direct storage write = the carried name");
  assert.equal(/beginGiftPiggy\(|bindGiftToNewPiggy\(|setScene\("(hatch|name)"/.test(b.replace(/\/\/.*$/gm, "")), false);
});
await check("S3 wrappers keep the originals and nothing else changes: startGiftOpen / lockAppAfterIdle / checkPiggy are each wrapped once", async () => {
  for (const n of ["startGiftOpen", "lockAppAfterIdle", "checkPiggy"]) {
    assert.equal((MAIN.match(new RegExp(`(?:async )?function ${n}\\(`, "g")) || []).length, 1, n);
    assert.equal((MAIN.match(new RegExp(`\\n  ${n} = `, "g")) || []).length, 1, `${n} wrapped once`);
  }
  assert.equal(MAIN.includes("typeof playPromotionStampScene === \"function\""), true);
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
