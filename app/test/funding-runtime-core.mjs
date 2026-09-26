// [A-553 PHASE S2] Add Money runtime core — chain-explicit FundingContext, typed receipt codec,
// authoritative-balance reconcile. Network 0 · browser 0 · real tx 0.
//   node app/test/funding-runtime-core.mjs
//
// Technique (same as h-multi-piggy-reopen.mjs / receipt-storage.mjs, A-048): the functions under
// test that live inside main.js (readReceipts/rememberReceipt/receiptRows/receiptCheck/
// beginFundingForPiggy/settleFunding/settleConfirmedFundingEvidence) are cut as **real source
// text** and run in an isolated node:vm context. The real exports of funding-context.js,
// receipt-codec.js, funding-reconcile.js, funding-entry.js, funding-intent-bridge.js,
// piggy-registry.js are injected into that context — nothing is reimplemented by hand.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { recoverMessageAddress } from "viem";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";

import { buildFundingContext, validateFundingContext, scopeForChainId } from "../src/funding-context.js";
import { fundingTargetChallenge, verifyFundingTargetProof } from "../src/piggy-session.js";
import { decodeReceiptRow, encodeReceiptRow, receiptIdentityKey as codecReceiptIdentityKey, RECEIPT_KIND } from "../src/receipt-codec.js";
import {
  reconcileConfirmedFunding, readErc20Balance, assertReconcileBinding, measuredHoldingRow, reconcileEvidenceKey,
} from "../src/funding-reconcile.js";
import { listFundingMethods, applyFundingResult, startFunding, FUNDING_STATE } from "../src/funding-entry.js";
import { checkIntentFunding, fundingRequestForShortfall, resumeAfterFunding } from "../src/funding-intent-bridge.js";
import { loadRegistry, saveRegistry, PIGGY_LOCATION } from "../src/piggy-registry.js";
import { filterHistory } from "../src/history-filter.js";
import { receiptPaperFields } from "../src/receipt-paper.js";
import { makeQuote } from "../src/valuation-source.js";

const MAIN_SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = MAIN_SRC.indexOf(startMarker);
  if (start < 0) throw new Error(`main.js 에서 못 찾음: ${startMarker}`);
  const end = MAIN_SRC.indexOf(endMarker, start);
  if (end < 0) throw new Error(`main.js 에서 못 찾음(끝): ${endMarker}`);
  return MAIN_SRC.slice(start, end);
}

const SCOPE_SRC = cut("function secondJourneyScope() {", "// [A-475]");
const RECEIPT_SRC = cut("function readReceipts() {", "\nfunction writeCredential(credential) {");
const ROWS_SRC = cut("function escapeHtml(value) {", "// --- character art");
const FUNDING_SRC = cut("// [A-495 Lane B] 지금 실제로 쓸 수 있는 충전 어댑터.", "const consumedPermissionNonces = new Set();");

for (const [name, src] of [
  ["secondJourneyScope", SCOPE_SRC], ["readReceipts", RECEIPT_SRC], ["rememberReceipt", RECEIPT_SRC],
  ["receiptIdentityKey", RECEIPT_SRC], ["receiptRows", ROWS_SRC], ["receiptCheck", ROWS_SRC],
  ["beginFundingForPiggy", FUNDING_SRC], ["settleFunding", FUNDING_SRC], ["settleConfirmedFundingEvidence", FUNDING_SRC],
]) {
  if (!src.includes(`function ${name}`) && !src.includes(`async function ${name}`)) {
    throw new Error(`잘라낸 소스에 ${name} 없음 — 마커가 main.js 구조와 어긋남`);
  }
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

// 실제 viem publicClient 를 흉내 낸 최소 주입 client. readContract/getBlockNumber 만 있다 —
// 서명·전송은 이 파일 어디에도 없다.
function fakeClient({ chainId = 10143, balance = 0n, blockNumber = 999n, readFails = false } = {}) {
  return {
    chain: { id: chainId },
    async readContract() {
      if (readFails) throw new Error("rpc down");
      return balance;
    },
    async getBlockNumber() {
      return blockNumber;
    },
  };
}

function openApp({ address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } = {}) {
  const localStorage = memoryStorage();
  const state = { address, receipts: [], receiptIndex: 0, funding: null };
  const RECEIPTS_KEY = "araso.receipts";
  const ctx = {
    state, localStorage, RECEIPTS_KEY, console, JSON, String, BigInt, Array, Number, Date,
    // receipt-codec.js — 실제 export
    decodeReceiptRow, encodeReceiptRow, codecReceiptIdentityKey, RECEIPT_KIND,
    // funding-entry.js / funding-intent-bridge.js — 실제 export
    listFundingMethods, applyFundingResult, FUNDING_STATE,
    checkIntentFunding, fundingRequestForShortfall, resumeAfterFunding,
    // funding-context.js / funding-reconcile.js — 실제 export
    buildFundingContext, validateFundingContext, scopeForChainId, reconcileConfirmedFunding,
    // piggy-session.js / viem — 실제 export ([A-555 S2] beginFundingForPiggy 의 controlProof 게이트)
    verifyFundingTargetProof, recoverMessageAddress,
    // piggy-registry.js — 실제 export
    loadRegistry, saveRegistry,
    // 프로덕션 디버그 훅이 아니라 테스트 주입 자리 — settleFunding 은 이 값을 기본으로만 쓰고
    // 모든 테스트가 client/storage 를 명시적으로 넘긴다.
    publicClient: undefined,
    safeLocalStorage: () => localStorage,
  };
  vm.createContext(ctx);
  vm.runInContext(
    `${SCOPE_SRC}\n${RECEIPT_SRC}\n${ROWS_SRC}\n${FUNDING_SRC}\n` +
      `globalThis.__scope = secondJourneyScope;` +
      `globalThis.__readReceipts = readReceipts;` +
      `globalThis.__rememberReceipt = rememberReceipt;` +
      `globalThis.__receiptIdentityKey = receiptIdentityKey;` +
      `globalThis.__receiptRows = receiptRows;` +
      `globalThis.__receiptCheck = receiptCheck;` +
      `globalThis.__beginFundingForPiggy = beginFundingForPiggy;` +
      `globalThis.__settleFunding = settleFunding;`,
    ctx,
  );
  return {
    state, localStorage,
    scope: ctx.__scope,
    readReceipts: ctx.__readReceipts,
    rememberReceipt: ctx.__rememberReceipt,
    receiptIdentityKey: ctx.__receiptIdentityKey,
    receiptRows: ctx.__receiptRows,
    receiptCheck: ctx.__receiptCheck,
    beginFundingForPiggy: ctx.__beginFundingForPiggy,
    settleFunding: ctx.__settleFunding,
  };
}

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label}`); fail += 1; }
}
function checkEq(label, got, want) {
  check(`${label} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
}

const TS = "2026-09-23T00:00:00.000Z";
const RUNTIME_CHAIN = "monad-testnet"; // secondJourneyScope()의 고정값(main.js:1612) — 여기서만 진짜 열린다.
const OTHER_ADDR = "0xfeedfacefeedfacefeedfacefeedfacefeedface";
const TESTNET_USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const MAINNET_USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

// ── [A-555 S2] 진짜 Mera 서명 세션 하나 — gate-c-signer.mjs:150-176 과 같은 패턴(결정적 가짜
// WebAuthn PRF → 실제 createSecp256k1SigningSession/getEvmAddress/toViemAccount). 이 파일은
// main.js 의 requestPrf/activateSigningSession 전체 배선을 새로 흉내내지 않는다 — beginFundingForPiggy
// 가 실제로 검사하는 것은 verifyFundingTargetProof(진짜 export) 뿐이므로, 그 계약이 요구하는
// {chainId, piggyId, address, issuedAt, nonce, signature} 를 이 진짜 서명자로 만든다.
async function fundingSigner(label) {
  const secret = crypto.randomBytes(32); // 이 프로세스에서만 산다
  const client = {
    async createCredential() { throw new Error("not used"); },
    async getCredential(req) {
      const salt = req?.prfSalt instanceof Uint8Array ? req.prfSalt : Buffer.alloc(32);
      return { credentialId: new Uint8Array(Buffer.from(label)), prfOutput: new Uint8Array(crypto.createHmac("sha256", secret).update(label).update(Buffer.from(salt)).digest()) };
    },
  };
  const { prfOutput } = await getPasskeyPrfOutput({ rpId: "araso-harness.local.test", webAuthnClient: client });
  const session = createSecp256k1SigningSession({ privateKey: prfOutput });
  const account = toViemAccount(session);
  const address = getEvmAddress(session.publicKey);
  return {
    address,
    // 실제 목적지 challenge(fundingTargetChallenge, 진짜 export)에 실제 서명(activeAccount.signMessage
    // 와 같은 EIP-191 경로) — main.js 의 proveFundingTargetControl 이 만드는 것과 같은 모양.
    async proveFor({ piggyId, chainId = RUNTIME_CHAIN, issuedAt = Date.now(), nonce = crypto.randomBytes(8).toString("hex"), signAddress = address, signChainId = chainId, signPiggyId = piggyId }) {
      const { challenge, error } = fundingTargetChallenge({ chainId: signChainId, piggyId: signPiggyId, address: signAddress, issuedAt, nonce });
      assert.equal(error, null, `fundingTargetChallenge error: ${error}`);
      const signature = await account.signMessage({ message: challenge });
      return { chainId, piggyId, address: signAddress, issuedAt, nonce, signature };
    },
  };
}
const primarySigner = await fundingSigner("araso-funding-target-primary");
const otherSigner = await fundingSigner("araso-funding-target-other");
const TARGET_ADDR = primarySigner.address; // 실제 파생 주소 — 더 이상 임의 리터럴이 아니다

// 완전한 충전 흐름을 실제 코드로 몰아간다: beginFundingForPiggy(제품 코드) -> startFunding(제품
// 코드) -> state.funding.intent 채우기(아직 없는 UI 훅이 할 일을 여기서 대신한다, 두 번째 구현이
// 아니라 이미 있는 startFunding() 을 그대로 부른 결과일 뿐이다) -> settleFunding(제품 코드).
async function driveConfirmedFunding(app, { piggy, amount, txHash, arrivedAmount, client, priceQuote, now, controlProof }) {
  const proof = controlProof ?? (await primarySigner.proveFor({ piggyId: piggy.id }));
  const opened = await app.beginFundingForPiggy(piggy, { action: "work", amount, controlProof: proof });
  assert.equal(opened.opened, true, `beginFundingForPiggy 열림 실패: ${opened.reason}`);
  const f = app.state.funding;
  const started = startFunding({
    method: "from_another_wallet",
    amount: f.request.amount,
    arrival: f.request.arrival,
    target: f.request.target,
    targetPiggyId: f.request.targetPiggyId,
    adapters: [{ method: "from_another_wallet", railId: "direct_wallet_transfer", available: true }],
    expectedChain: f.context.chainId,
  });
  assert.equal(started.ok, true, `startFunding 실패: ${started.reason}`);
  app.state.funding.intent = started.intent;
  const result = {
    status: FUNDING_STATE.CONFIRMED,
    chain: f.context.chainId,
    asset: f.context.assetSymbol,
    target: piggy.address,
    amount: arrivedAmount ?? f.request.amount,
    txHash,
    at: TS,
  };
  return app.settleFunding(result, { available: "0", client, storage: app.localStorage, priceQuote, now: () => TS });
}

function testnetPiggy(overrides = {}) {
  return { id: "honeybun", name: "Honeybun", location: PIGGY_LOCATION.HOME, address: TARGET_ADDR, assets: [], ...overrides };
}

// ── 1. explicit testnet context vs mainnet default drift fails closed ──────────────────────────
{
  const bad = buildFundingContext({ chainId: "monad-mainnet", runtimeChainId: "monad-testnet", assetSymbol: "USDC", targetPiggyId: "p", targetAddress: TARGET_ADDR });
  check("1. chain != runtime -> chain_scope_mismatch, not ack-able", bad.error === "chain_scope_mismatch" && bad.context === null);

  const app = openApp();
  const proof1 = await primarySigner.proveFor({ piggyId: "honeybun" });
  const opened = await app.beginFundingForPiggy(testnetPiggy(), { action: "work", amount: "10", controlProof: proof1 });
  check("1. beginFundingForPiggy on the real (testnet) runtime opens with a matching context", opened.opened === true && app.state.funding.context.chainId === "monad-testnet");
  check("1. that context carries the testnet USDC identity, not the mainnet one", app.state.funding.context.assetId === TESTNET_USDC);

  const stale = { chainId: "monad-mainnet", assetSymbol: "USDC", assetId: MAINNET_USDC, decimals: 6, targetPiggyId: "honeybun", targetAddress: TARGET_ADDR };
  const revalidated = validateFundingContext(stale, { runtimeChainId: "monad-testnet" });
  check("1. a stale mainnet context is rejected when re-validated against the testnet runtime", revalidated.ok === false && revalidated.error === "chain_scope_mismatch");
}

// ── 2. exact Piggy id/address/token binding ─────────────────────────────────────────────────────
{
  const evidence = { chainId: "monad-testnet", tokenAddress: TESTNET_USDC, targetAddress: TARGET_ADDR, targetPiggyId: "honeybun", txHash: "0xabc", decimals: 6, assetSymbol: "USDC" };
  const rightPiggy = { id: "honeybun", address: TARGET_ADDR };
  const wrongAddrPiggy = { id: "honeybun", address: OTHER_ADDR };
  check("2. matching id+address+chain+token binds", assertReconcileBinding({ evidence, piggy: rightPiggy, runtimeChainId: "monad-testnet" }).ok === true);
  check("2. address mismatch is rejected even with the right id", assertReconcileBinding({ evidence, piggy: wrongAddrPiggy, runtimeChainId: "monad-testnet" }).error === "piggy_address_mismatch");
  check("2. missing piggy is rejected", assertReconcileBinding({ evidence, piggy: null, runtimeChainId: "monad-testnet" }).error === "missing_piggy");
  check("2. chain mismatch (evidence vs runtime) is rejected", assertReconcileBinding({ evidence, piggy: rightPiggy, runtimeChainId: "monad-mainnet" }).error === "chain_mismatch");
}

// ── 3. confirmed tx + measured absolute balance updates only the target Piggy ──────────────────
{
  const other = { id: "mochi", address: OTHER_ADDR, location: PIGGY_LOCATION.AWAY, assets: [{ assetId: TESTNET_USDC, symbol: "USDC", quantity: "80", decimals: 6, sourceTimestamp: TS }] };
  const target = testnetPiggy();
  const client = fakeClient({ chainId: 10143, balance: 12500000n }); // 12.5 USDC (6 decimals)
  const out = await reconcileConfirmedFunding({
    evidence: { chainId: "monad-testnet", tokenAddress: TESTNET_USDC, targetAddress: TARGET_ADDR, targetPiggyId: "honeybun", txHash: "0xdeadbeef", decimals: 6, assetSymbol: "USDC" },
    piggies: [target, other], client, runtimeChainId: "monad-testnet", now: TS,
  });
  check("3. reconcile ok", out.ok === true);
  const updated = out.piggies.find((p) => p.id === "honeybun");
  const untouched = out.piggies.find((p) => p.id === "mochi");
  check("3. target Piggy shows the measured absolute quantity", updated.assets.find((a) => a.assetId === TESTNET_USDC)?.quantity === "12.5");
  checkEq("3. the other Piggy's assets are byte-for-byte untouched", untouched.assets, other.assets);
}

// ── 4. same tx replay does not double-credit or duplicate the receipt ──────────────────────────
{
  const app = openApp();
  const registry = { version: 1, accountId: app.state.address, chainId: "monad-testnet", piggies: [testnetPiggy()] };
  saveRegistry(app.localStorage, app.scope(), registry);
  const client = fakeClient({ chainId: 10143, balance: 5000000n }); // 5.0 USDC

  const first = await driveConfirmedFunding(app, { piggy: testnetPiggy(), amount: "5", txHash: "0xreplay", client });
  check("4. first settle resumes the intent", first.funded === true);
  check("4. first settle -> exactly one receipt", app.state.receipts.length === 1);
  const afterFirst = loadRegistry(app.localStorage, app.scope()).registry;
  const qtyAfterFirst = afterFirst.piggies.find((p) => p.id === "honeybun").assets.find((a) => a.assetId === TESTNET_USDC)?.quantity;
  check("4. first settle measures 5.0 (not additive)", qtyAfterFirst === "5");

  // 정확히 같은 결과(같은 txHash)가 다시 온다 — beginFundingForPiggy 부터 다시 열 필요 없이
  // 같은 intent/context 로 settleFunding 만 재호출(진짜 재생 상황).
  const replayed = await app.settleFunding(
    { status: FUNDING_STATE.CONFIRMED, chain: "monad-testnet", asset: "USDC", target: TARGET_ADDR, amount: "5", txHash: "0xreplay", at: TS },
    { available: "0", client, storage: app.localStorage, now: () => TS },
  );
  check("4. replay does not throw and still resumes", replayed.funded === true);
  check("4. replay -> still exactly one receipt (dedup by identity)", app.state.receipts.length === 1);
  const afterReplay = loadRegistry(app.localStorage, app.scope()).registry;
  const qtyAfterReplay = afterReplay.piggies.find((p) => p.id === "honeybun").assets.find((a) => a.assetId === TESTNET_USDC)?.quantity;
  check("4. replay -> quantity still 5.0, not doubled to 10", qtyAfterReplay === "5");
}

// ── 5. balance-read failure preserves receipt/evidence but does not fabricate balance/valuation ─
{
  const app = openApp();
  saveRegistry(app.localStorage, app.scope(), { version: 1, accountId: app.state.address, chainId: "monad-testnet", piggies: [testnetPiggy()] });
  const before = loadRegistry(app.localStorage, app.scope()).registry;
  const failingClient = fakeClient({ chainId: 10143, readFails: true });

  const resumed = await driveConfirmedFunding(app, { piggy: testnetPiggy(), amount: "7", txHash: "0xfails", client: failingClient });
  check("5. resumeAfterFunding still resumes off the confirmed evidence", resumed.funded === true);
  check("5. the add_money receipt is still persisted even though the balance read failed", app.state.receipts.length === 1 && app.state.receipts[0].kind === RECEIPT_KIND.ADD_MONEY);
  const after = loadRegistry(app.localStorage, app.scope()).registry;
  checkEq("5. registry piggies are left exactly as they were (no fabricated balance)", after.piggies, before.piggies);
  check("5. readErc20Balance itself never throws on a failing client", (await readErc20Balance({ client: failingClient, tokenAddress: TESTNET_USDC, holderAddress: TARGET_ADDR })).error === "read_failed");
}

// ── 6. birth_unfunded $0 is not retained as a false valuation after measured funds appear ──────
{
  const withBirth = testnetPiggy({ valuation: { usd: "0", source: "birth_unfunded", at: TS } });
  const client = fakeClient({ chainId: 10143, balance: 10000000n }); // 10.0 USDC
  const evidence = { chainId: "monad-testnet", tokenAddress: TESTNET_USDC, targetAddress: TARGET_ADDR, targetPiggyId: "honeybun", txHash: "0xval1", decimals: 6, assetSymbol: "USDC" };

  const noQuote = await reconcileConfirmedFunding({ evidence, piggies: [withBirth], client, runtimeChainId: "monad-testnet", now: TS });
  const noQuotePiggy = noQuote.piggies.find((p) => p.id === "honeybun");
  check("6. without a fresh quote, birth_unfunded $0 becomes null (not retained as a false $0)", noQuotePiggy.valuation === null);
  check("6. valuationKnown is explicitly false, not silently true", noQuote.valuationKnown === false);

  // rawPrice 은 실제 오라클 값이 아니라 "10.0 USDC != $1/unit" 을 또렷하게 보이려고 고른
  // $0.90 짜리 fixture 다(현실 오라클 실측은 lane_a/AUDIT.md 의 $0.99988155 참조).
  const quote = makeQuote({ assetId: TESTNET_USDC, symbol: "USDC", rawPrice: "90000000", observedAt: TS });
  const withQuote = await reconcileConfirmedFunding({ evidence: { ...evidence, txHash: "0xval2" }, piggies: [withBirth], client, runtimeChainId: "monad-testnet", priceQuote: quote, now: new Date(TS).getTime() });
  const pricedPiggy = withQuote.piggies.find((p) => p.id === "honeybun");
  check("6. with a fresh quote, valuation is priced off the oracle, not stable=$1 (10.0 qty @ $0.90 -> $9.00, not $10.00)", pricedPiggy.valuation !== null && pricedPiggy.valuation.usd === "9.00" && pricedPiggy.valuation.source === "aave-v3-monad-oracle");
  check("6. valuationKnown true when priced", withQuote.valuationKnown === true);
}

// ── 7. funding confirmation never grants Job/send permission ───────────────────────────────────
{
  const app = openApp();
  saveRegistry(app.localStorage, app.scope(), { version: 1, accountId: app.state.address, chainId: "monad-testnet", piggies: [testnetPiggy()] });
  const client = fakeClient({ chainId: 10143, balance: 3000000n });
  const resumed = await driveConfirmedFunding(app, { piggy: testnetPiggy(), amount: "3", txHash: "0xperm", client });
  check("7. resumeAfterFunding.permissionGranted is always false", resumed.permissionGranted === false);
  check("7. the sliced funding source never references issuePermission/authorize", !/issuePermission|permission-envelope/.test(FUNDING_SRC));
}

// ── 8. legacy shMON receipt round-trip is unchanged ─────────────────────────────────────────────
{
  const app = openApp();
  const legacy = {
    before: 1000n, after: 900n, gas: 21000n, sent: 100n, txHash: "0xtx0", depositTxHash: "0xd0",
    redeemTxHash: "0xr0", grantTxHash: "0xg0", depositBlockNumber: 10n, redeemBlockNumber: 11n,
    depositGasUsed: 21000n, redeemGasUsed: 22000n, shmonReceived: 5n, shmonAfterRedeem: 4n,
    status: "success", at: 1700000000000,
  };
  app.rememberReceipt(legacy);
  const reread = app.readReceipts();
  check("8. legacy round-trip -> no kind field", !("kind" in reread[0]));
  check("8. legacy round-trip -> BigInt fields preserved", reread[0].before === 1000n && reread[0].gas === 21000n);
  check("8. legacy round-trip -> stored JSON never contains a kind field for this row", !JSON.parse(app.localStorage.getItem("araso.receipts"))[0].kind);
}

// ── 9. add_money round-trip + piggyId filter + ownerless stays ownerless + cross-chain not merged
{
  const app = openApp();
  const addMoney = { kind: "add_money", chainId: "monad-testnet", token: TESTNET_USDC, amount: "12.5", txHash: "0xam1", at: TS, piggyId: "honeybun" };
  const ownerlessLegacy = { before: 1n, after: 1n, gas: 1n, sent: 1n, txHash: "0xlegacy1", status: "success", at: 1 };
  app.rememberReceipt(addMoney);
  app.rememberReceipt(ownerlessLegacy);
  const reread = app.readReceipts();
  check("9. add_money round-trip -> amount stays the exact raw string", reread.find((r) => r.txHash === "0xam1")?.amount === "12.5");
  check("9. add_money round-trip -> piggyId preserved", reread.find((r) => r.txHash === "0xam1")?.piggyId === "honeybun");
  check("9. ownerless legacy row -> no piggyId field at all", !("piggyId" in reread.find((r) => r.txHash === "0xlegacy1")));

  const filtered = filterHistory(reread, "honeybun");
  check("9. piggyId filter -> only the add_money row for that Piggy", filtered.rows.length === 1 && filtered.rows[0].receipt.txHash === "0xam1");
  const all = filterHistory(reread, null);
  check("9. ownerless stays visible on the global/legacy path", all.rows.some((r) => r.receipt.txHash === "0xlegacy1"));

  const sameTxOtherChain = { kind: "add_money", chainId: "monad-mainnet", token: MAINNET_USDC, amount: "12.5", txHash: "0xam1", at: TS };
  check("9. same txHash on a different chain gets a different identity key (not merged)", app.receiptIdentityKey(addMoney) !== app.receiptIdentityKey(sameTxOtherChain));
  app.rememberReceipt(sameTxOtherChain);
  check("9. cross-chain same-tx row is kept as a separate receipt, not merged into the first", app.state.receipts.length === 3);

  // 한 add_money 줄이 깨져도 legacy 이력 전체를 지우지 않는다(§lane_b/AUDIT.md 버그 2, BUILD 지시 3).
  const raw = JSON.parse(app.localStorage.getItem("araso.receipts"));
  raw.push({ kind: "add_money", chainId: "monad-testnet" }); // token/amount/txHash 없음 -> 깨진 줄
  app.localStorage.setItem("araso.receipts", JSON.stringify(raw));
  const survivedRereads = app.readReceipts();
  check("9. one malformed add_money row is skipped, legacy history is not wiped", survivedRereads.length === 3);

  // [A-553 리뷰 결함 1 수리] legacy 줄은 원래 안전장치 그대로 — 깨진 legacy 줄 하나면 전체 [] (반쯤 읽힌 목록 금지).
  raw.push({ before: "undefined", after: "1", gas: "1", sent: "1" }); // kind 없음 = legacy, BigInt 불가 -> 깨진 줄
  app.localStorage.setItem("araso.receipts", JSON.stringify(raw));
  check("9. one malformed LEGACY row still wipes to [] (legacy all-or-nothing unchanged)", app.readReceipts().length === 0);
}

// ── 10. HISTORY list/detail does not crash on an add_money receipt, no NaN/undefined text ──────
{
  const app = openApp();
  const addMoney = decodeReceiptRow({ kind: "add_money", chainId: "monad-testnet", token: TESTNET_USDC, amount: "12.5", txHash: "0xhist1", at: TS, blockNumber: "555" });
  let rows, checkLine, fields;
  assert.doesNotThrow(() => { rows = app.receiptRows(addMoney); });
  assert.doesNotThrow(() => { checkLine = app.receiptCheck(addMoney); });
  assert.doesNotThrow(() => { fields = receiptPaperFields({ receipt: addMoney, name: "Honeybun" }); });
  check("10. receiptRows renders only the existing Tx/Block labels for add_money", rows.length === 2 && rows[0].label === "Tx" && rows[1].label === "Block");
  check("10. receiptRows -> no NaN/undefined leaks into the rendered values", !rows.some((r) => /NaN|undefined/.test(String(r.value))));
  check("10. receiptCheck renders nothing for add_money (no false Sent/Cost/Left math)", checkLine === "");
  check("10. receiptPaperFields does not crash and produces no NaN/undefined", fields && !/NaN|undefined/.test(JSON.stringify(fields)));

  const addMoneyNoBlock = decodeReceiptRow({ kind: "add_money", chainId: "monad-testnet", token: TESTNET_USDC, amount: "1", txHash: "0xhist2", at: TS });
  const rowsNoBlock = app.receiptRows(addMoneyNoBlock);
  check("10. missing blockNumber renders the existing 'Unknown' label, not a fabricated number", rowsNoBlock[1].value === "Unknown");
}

// ── 11. [A-555 S2] funding-target control proof — a signed proof, not a caller-supplied string ──
{
  // 6. genuine proof for the right Piggy/chain opens — same gate as every other case below.
  const app = openApp();
  const proof = await primarySigner.proveFor({ piggyId: "honeybun" });
  const opened = await app.beginFundingForPiggy(testnetPiggy(), { action: "work", amount: "10", controlProof: proof });
  check("11. genuine proof -> opens", opened.opened === true);
  check("11. genuine proof -> FundingContext exists", app.state.funding && app.state.funding.context != null);
}
{
  // 7a. the attack the coordinator called out: proof claims piggy.address but is signed by a
  // DIFFERENT signer (a caller-supplied signerAddress string is not proof — bindSigner-style
  // string equality would have let this through; the signature recovery must not).
  const app = openApp();
  const forged = await otherSigner.proveFor({ piggyId: "honeybun", signAddress: TARGET_ADDR });
  const opened = await app.beginFundingForPiggy(testnetPiggy(), { action: "work", amount: "10", controlProof: forged });
  check("11. wrong signer signing for the claimed target address -> funding_target_unproven", opened.opened === false && opened.reason === "funding_target_unproven");
  check("11.   -> no FundingContext, no state.funding", app.state.funding === null);
}
{
  // 7b. tampered index address — proof's own address field doesn't match the Piggy being funded
  // (e.g. a stale/edited local index row), even though it's a real signature by the primary signer.
  const app = openApp();
  const tampered = await primarySigner.proveFor({ piggyId: "honeybun" });
  tampered.address = OTHER_ADDR; // forged after signing — no longer matches what was signed either
  const opened = await app.beginFundingForPiggy(testnetPiggy(), { action: "work", amount: "10", controlProof: tampered });
  check("11. tampered proof address -> funding_target_unproven", opened.opened === false && opened.reason === "funding_target_unproven");
  check("11.   -> no state.funding", app.state.funding === null);
}
{
  // 7c. a real, fresh, correctly-signed proof — but for a DIFFERENT Piggy.
  const app = openApp();
  const proofForOther = await primarySigner.proveFor({ piggyId: "mochi" });
  const opened = await app.beginFundingForPiggy(testnetPiggy(), { action: "work", amount: "10", controlProof: proofForOther });
  check("11. proof issued for another Piggy id -> funding_target_unproven", opened.opened === false && opened.reason === "funding_target_unproven");
}
{
  // 7d. a real, fresh, correctly-signed proof — but for a different chain than the live runtime.
  const app = openApp();
  const proofOtherChain = await primarySigner.proveFor({ piggyId: "honeybun", chainId: "monad-mainnet" });
  const opened = await app.beginFundingForPiggy(testnetPiggy(), { action: "work", amount: "10", controlProof: proofOtherChain });
  check("11. proof issued for a different chain -> funding_target_unproven", opened.opened === false && opened.reason === "funding_target_unproven");
}
{
  // 7e. stale — issued well outside the freshness window (FUNDING_TARGET_MAX_AGE_MS = 2 min).
  const app = openApp();
  const stale = await primarySigner.proveFor({ piggyId: "honeybun", issuedAt: Date.now() - 10 * 60 * 1000 });
  const opened = await app.beginFundingForPiggy(testnetPiggy(), { action: "work", amount: "10", controlProof: stale });
  check("11. stale proof (10 min old) -> funding_target_unproven", opened.opened === false && opened.reason === "funding_target_unproven");
}
{
  // 7f. replayed nonce — the exact same genuine proof used twice must not verify twice.
  const app = openApp();
  const proof = await primarySigner.proveFor({ piggyId: "honeybun" });
  const first = await app.beginFundingForPiggy(testnetPiggy(), { action: "work", amount: "10", controlProof: proof });
  check("11. first use of a genuine proof -> opens", first.opened === true);
  const second = await app.beginFundingForPiggy(testnetPiggy(), { action: "work", amount: "10", controlProof: proof });
  check("11. replaying the exact same proof -> funding_target_unproven (single-use nonce)", second.opened === false && second.reason === "funding_target_unproven");
}
{
  // 8. missing proof — no fallback to any stored/global credential authority.
  const app = openApp();
  const opened = await app.beginFundingForPiggy(testnetPiggy(), { action: "work", amount: "10" });
  check("11. missing controlProof -> funding_target_unproven, not silently allowed", opened.opened === false && opened.reason === "funding_target_unproven");
  check("11.   -> no state.funding", app.state.funding === null);
  const openedNull = await app.beginFundingForPiggy(testnetPiggy(), { action: "work", amount: "10", controlProof: null });
  check("11. explicit null controlProof -> funding_target_unproven", openedNull.opened === false && openedNull.reason === "funding_target_unproven");
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
