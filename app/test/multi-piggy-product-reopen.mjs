// [A-550 Lane A] Multi-Piggy product create/reopen/signer/history proof — the narrowest
// harness that drives the REAL main.js functions (not a re-implementation of their rules).
//   node app/test/multi-piggy-product-reopen.mjs
// Network 0 · real device Face ID 0 · real tx 0 · UI/copy/button changes 0.
//
// Method: cut the actual function text out of app/src/main.js (same technique as
// model-a-add-piggy.mjs / h-multi-piggy-reopen.mjs / gate-c-signer.mjs) and run it in
// node:vm with the real library modules (piggy-index.js, piggy-registry.js,
// piggy-session.js, permission-envelope.js, history-filter.js) imported directly, and a
// real Mera passkey/PRF/signing-session path behind one deterministic fake WebAuthn
// client. Only DOM/browser primitives that this repo's other tests already stub
// (document, navigator.locks, setTimeout, render, setScene) are faked — every rule
// under test (admission gating, sequence issuance, $0 projection, naming → index write,
// selection invalidation, signer binding, per-Piggy history) runs as the shipped code.
//
// "openApp()" below rebuilds the vm context from scratch each time it's called — that is
// this harness's model of "close app, reopen app": nothing carries over except `storage`.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { admitModelAPiggy, loadMyPiggiesIndex, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { createPiggy, loadRegistry, migrateSinglePiggy, normalizePiggy, projectRegistryTotals, saveRegistry } from "../src/piggy-registry.js";
import { authRequestForPiggy, bindSigner, selectionContext, switchSelection } from "../src/piggy-session.js";
import { issuePermission, authorize, consume, permissionNonce, cancel as cancelPermission, PERMISSION_STATE } from "../src/permission-envelope.js";
import { filterHistory, historyIdentityLabel, resolveHistorySelection } from "../src/history-filter.js";
import { createMemoryStorage } from "../src/second-journey-state.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function cut(startMarker, endMarker) {
  const start = MAIN.indexOf(startMarker);
  if (start < 0) throw new Error(`main.js 에서 못 찾음(시작): ${startMarker}`);
  const end = MAIN.indexOf(endMarker, start);
  if (end < 0) throw new Error(`main.js 에서 못 찾음(끝): ${endMarker}`);
  return MAIN.slice(start, end);
}

// ── real function slices, cut straight out of main.js — same markers used by the ──────────
// existing multi-Piggy tests (h-multi-piggy-reopen.mjs SCOPE_SRC/SNAPSHOT_SRC/HISTORY_SRC),
// plus two new ranges this card needs: the session lifecycle (activateSigningSession /
// endActiveSession) and the Gate C + Model-A block (requestMoneyPermission through
// admitAddedPiggy) that beginAddPiggy / applyPiggySelection / requestMoneyPermission live in.
const SCOPE_SRC = cut("function secondJourneyScope() {", "\n// [A-475] 사용자가");
const SNAPSHOT_SRC = cut("// [A-484 Lane C] Third Journey 임시 UI", "// [A-495 Lane B] 지금 실제로 쓸 수 있는 충전");
const HISTORY_SRC = cut("// [A-485 Lane A] 지금 오른쪽 종이가 보여줄 기록 줄들", "function recordsCardListMarkup(");
const SESSION_SRC = cut("let activeSession = null;", "// --- 씬 정리 (A-292 번호 9)");
const NAME_SRC = cut("let nameSaveToken = -1;", "// [A-389] 취소인지 판정");
const CORE_SRC = cut("const consumedPermissionNonces = new Set();", "function homePadMarkup(scene) {");

for (const [name, src, needle] of [
  ["secondJourneyScope", SCOPE_SRC, "function secondJourneyScope("],
  ["secondPiggyRegistrySnapshot", SNAPSHOT_SRC, "function secondPiggyRegistrySnapshot("],
  ["historyRows", HISTORY_SRC, "function historyRows("],
  ["activateSigningSession", SESSION_SRC, "function activateSigningSession("],
  ["savePiggyName", NAME_SRC, "function savePiggyName("],
  ["beginAddPiggy", CORE_SRC, "async function beginAddPiggy("],
  ["applyPiggySelection", CORE_SRC, "function applyPiggySelection("],
  ["requestMoneyPermission", CORE_SRC, "async function requestMoneyPermission("],
]) {
  if (!src.includes(needle)) throw new Error(`잘라낸 구간에 ${name} 없음 — 마커 확인 필요`);
}

const CHAIN = "monad-testnet";
const AT = "2026-09-23T09:00:00.000Z";
const RP = "araso-a550-harness.local.test";
const DEST = "0x00000000000000000000000000000000000000a1";
const ROOT_ID_BYTES = new Uint8Array(Buffer.from("a550-model-a-root"));
const ROOT_ID = Buffer.from(ROOT_ID_BYTES).toString("base64url");
const ROOT = { credentialId: ROOT_ID };

// ── one deterministic fake WebAuthn credential — real Mera code (getPasskeyPrfOutput →
// createSecp256k1SigningSession → getEvmAddress / toViemAccount) drives everything after it.
const secret = crypto.randomBytes(32);
function fakeClient({ credentialBytes = ROOT_ID_BYTES, fail = false } = {}) {
  const calls = { create: 0, get: 0 };
  const client = {
    async createCredential() { calls.create += 1; throw new Error("createCredential must never be called for + Piggy"); },
    async getCredential(req) {
      calls.get += 1;
      if (fail) throw new Error("NotAllowedError: user cancelled");
      return { credentialId: credentialBytes, prfOutput: new Uint8Array(crypto.createHmac("sha256", secret).update(Buffer.from(req.prfSalt)).digest()) };
    },
  };
  client.calls = calls;
  return client;
}
// A second, independent "wrong" fake credential/secret — used only to manufacture a
// signer that does NOT belong to the selected Piggy (§g wrong-signer-fails-closed).
const wrongSecret = crypto.randomBytes(32);
function wrongFakeClient() {
  return {
    async createCredential() { throw new Error("must not be called"); },
    async getCredential(req) {
      return { credentialId: ROOT_ID_BYTES, prfOutput: new Uint8Array(crypto.createHmac("sha256", wrongSecret).update(Buffer.from(req.prfSalt)).digest()) };
    },
  };
}
const addressOf = (prf) => getEvmAddress(createSecp256k1SigningSession({ privateKey: prf }).publicKey);
// Mirrors main.js's own requestPrf() guard (line ~825-833) exactly: the `prfSalt` key is
// only forwarded when it is a real 32-byte Uint8Array. Omitting it (rather than sending
// `prfSalt: undefined`) is what lets a default-salt Piggy (Honeybun, no locator.prfSalt)
// re-derive through this same fake and land back on its own default-salt address.
const requestPrfWith = (client) => (credential, prfSalt) => getPasskeyPrfOutput({
  rpId: RP,
  ...(credential ? { credential } : {}),
  ...(prfSalt instanceof Uint8Array && prfSalt.length === 32 ? { prfSalt } : {}),
  webAuthnClient: client,
});

// direct serialization double, structurally FIFO like the real Web Locks API used by webLocks()
function fifoLocks() {
  const tails = new Map();
  return {
    names: [],
    request(name, _opts, fn) {
      this.names.push(name);
      const prev = tails.get(name) || Promise.resolve();
      const run = prev.then(() => fn());
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

async function seedFirstPiggy(storage, { name = "Honeybun" } = {}) {
  const prf = (await getPasskeyPrfOutput({ rpId: RP, webAuthnClient: fakeClient() })).prfOutput;
  const address = addressOf(prf);
  const out = registerControlledPiggy(storage, CHAIN, {
    id: `legacy-${address.toLowerCase()}`, name, address, signerAddress: address,
    locator: { credentialId: ROOT_ID }, at: AT,
  });
  assert.equal(out.ok, true);
  return address;
}

// ── "open the app" — a brand-new vm context + brand-new `state` each time. Only `storage`
// is shared across calls, exactly like a real close/reopen: nothing in memory survives.
function openApp(storage, { address = null, secondJourneyCompletedOnce = true, piggyName = "Honeybun", receipts = [], historyPiggyId = null, requestPrf } = {}) {
  const state = {
    address, secondJourneyCompletedOnce, piggyName, receipts, historyPiggyId,
    addPiggy: null, pendingNamePiggyId: null, selectedPiggy: null,
    moneyIntent: null, funding: null, activeSignerAddress: "",
  };
  const calls = { setScene: [], render: 0 };
  let requestPrfRef = requestPrf || (async () => { throw new Error("requestPrf not wired for this call"); });
  const nameInputBox = { value: "", focus() {} };
  const ctx = {
    state, console, Set, Map, Array, Object, String, Number, Boolean, Date, JSON, Promise, RegExp,
    admitModelAPiggy, loadMyPiggiesIndex, registerControlledPiggy, renameIndexedPiggy,
    createPiggy, loadRegistry, migrateSinglePiggy, normalizePiggy, projectRegistryTotals, saveRegistry,
    filterHistory, historyIdentityLabel, resolveHistorySelection,
    issuePermission, authorize, consume, permissionNonce, cancelPermission, PERMISSION_STATE,
    authRequestForPiggy, bindSigner, selectionContext, switchSelection,
    createSecp256k1SigningSession, getEvmAddress, toViemAccount,
    safeLocalStorage: () => storage,
    displayPiggyName: () => piggyName,
    setScene: (...a) => calls.setScene.push(a),
    render: () => { calls.render += 1; },
    // Every real call site (main.js requestPrf() itself, and beginAddPiggy's
    // `(credential, prfSalt) => requestPrf(credential, { prfSalt })` wrapper around
    // admitModelAPiggy) ends up calling this free variable as requestPrf(credential, { prfSalt }).
    // Unwrap that options object before handing the raw salt to requestPrfWith's fake.
    requestPrf: (credential, opts) => {
      const raw = opts && opts.prfSalt;
      const salt = raw instanceof Uint8Array && raw.length === 32 ? raw : undefined;
      return requestPrfRef(credential, salt);
    },
    navigator: { locks: fifoLocks() },
    document: { querySelector: (sel) => (sel === "#piggyNameInput" ? nameInputBox : null) },
    setTimeout: () => 0,
    clearTimeout: () => {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    // [A-579 Lane G] beginAddPiggy no longer touches Gift at all (A-566 misassignment fix — a
    // regular +Piggy never receives a pending Gift); the former settlePendingGiftClaimIfAny stub is
    // gone. Gift binding to a NEW Piggy is covered by gift-product-entry.mjs (beginGiftPiggy).
  };
  vm.createContext(ctx);
  vm.runInContext(
    `${SCOPE_SRC}\n${SNAPSHOT_SRC}\n${HISTORY_SRC}\n${SESSION_SRC}\n` +
      // sceneToken: a plain click-lock counter (main.js line "let sceneToken = 0;") that
      // sits between the SESSION_SRC and NAME_SRC cuts — copied verbatim, not reimplemented,
      // because savePiggyName() reads/writes it.
      `let sceneToken = 0;\n${NAME_SRC}\n${CORE_SRC}\n` +
      `this.__api = { beginAddPiggy, admitAddedPiggy, indexedResidents, moneyPiggiesSnapshot, homeResidents, showAddPiggyTab, applyPiggySelection, requestMoneyPermission, authorizeMoneyAction, savePiggyName, historyRows, historyIdentityName, secondPiggyRegistrySnapshot, selectedHistoryPiggyId };\n` +
      `this.__getActiveAccount = () => activeAccount;`,
    ctx,
  );
  return {
    state, calls, nameInputBox,
    setRequestPrf: (fn) => { requestPrfRef = fn; },
    getActiveAccount: ctx.__getActiveAccount,
    ...ctx.__api,
  };
}

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }
// Objects/arrays that cross the vm boundary (built by the sliced main.js code, which
// compiles in its own vm realm) are structurally-but-not-referentially equal to same-shaped
// literals in this file — assert/strict's deepEqual is a strict, prototype-sensitive check
// and rejects that. A JSON round-trip normalizes both sides to this realm's plain
// Object/Array before comparing (same technique model-a-add-piggy.mjs uses ad hoc).
const plain = (x) => JSON.parse(JSON.stringify(x));
function deepEq(actual, expected, message) { assert.deepEqual(plain(actual), plain(expected), message); }

const storage = createMemoryStorage();
let firstAddress, piggy2, piggy3;

// ══ a) before Second completion: +Piggy cannot create ═══════════════════════════════════
await check("a1. showAddPiggyTab hides the tab before Second Journey has completed once", async () => {
  firstAddress = await seedFirstPiggy(storage);
  const app = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: false });
  assert.equal(app.showAddPiggyTab("sendstay", "home"), false);
});

await check("a2. beginAddPiggy() itself fails closed before Second completion — no lock taken, no passkey call, no index/registry write", async () => {
  const client = fakeClient();
  const app = openApp(storage, {
    address: firstAddress, secondJourneyCompletedOnce: false,
    requestPrf: requestPrfWith(client),
  });
  const before = loadMyPiggiesIndex(storage, CHAIN).index;
  const out = await app.beginAddPiggy();
  deepEq(out, { started: false, reason: "second_journey_not_closed" });
  assert.equal(client.calls.create, 0);
  assert.equal(client.calls.get, 0);
  const after = loadMyPiggiesIndex(storage, CHAIN).index;
  deepEq(after, before);
  assert.equal(app.state.addPiggy, null); // never entered "authenticating"
});

// ══ b) + c) after Second completion: existing pinned credential, no new passkey, sequence n, $0, Name it ══
let secondAddPiggyResult, appAfterSecond;
await check("b1/c1. after Second completion, beginAddPiggy() reuses the pinned Model-A credential — one assertion, zero credential creations — and lands a real, distinct, sequence-1 Piggy", async () => {
  const client = fakeClient();
  appAfterSecond = openApp(storage, {
    address: firstAddress, secondJourneyCompletedOnce: true,
    requestPrf: requestPrfWith(client),
  });
  secondAddPiggyResult = await appAfterSecond.beginAddPiggy();
  assert.equal(secondAddPiggyResult.started, true);
  assert.equal(secondAddPiggyResult.reason, null);
  // "navigator.credentials.create call count" translated to this harness's WebAuthn seam:
  // the fake authenticator's createCredential (Mera's create path) is never touched.
  assert.equal(client.calls.create, 0);
  assert.equal(client.calls.get, 1); // exactly one pinned assertion
  const idx = loadMyPiggiesIndex(storage, CHAIN).index;
  piggy2 = idx.piggies.find((p) => p.id === secondAddPiggyResult.piggyId);
  assert.ok(piggy2);
  assert.equal(piggy2.sequence, 1);
  assert.equal(idx.issuedThrough, 1);
  assert.notEqual(piggy2.address.toLowerCase(), firstAddress.toLowerCase());
  assert.equal(piggy2.locator.credentialId, ROOT_ID); // same pinned credential — not a new one
});

await check("c2. the admitted Piggy is projected as a known $0 (birth_unfunded) and the app enters Name it", async () => {
  const reg = loadRegistry(storage, { accountId: firstAddress, chainId: CHAIN }).registry.piggies;
  const born = reg.find((p) => p.id === piggy2.id);
  assert.equal(born.valuation.usd, "0");
  assert.equal(born.valuation.source, "birth_unfunded");
  assert.equal(typeof born.valuation.at, "string");
  assert.ok(born.valuation.at.length > 0);
  assert.equal(secondAddPiggyResult.projected, true);
  deepEq(appAfterSecond.calls.setScene[appAfterSecond.calls.setScene.length - 1], ["name", "", ""]);
  assert.equal(appAfterSecond.state.pendingNamePiggyId, piggy2.id);
});

// ══ d) naming updates only the non-financial index for that Piggy, then Home with 2+ residents ══
await check("d1. Name it writes ONLY the new Piggy's index row — Honeybun's index name and every registry/financial row are untouched — then returns Home", async () => {
  const registryBefore = JSON.stringify(loadRegistry(storage, { accountId: firstAddress, chainId: CHAIN }).registry);
  appAfterSecond.nameInputBox.value = "Bumble Bee 12345678901237890123456789012345"; // will be trimmed/sliced to 24 by the real function
  appAfterSecond.savePiggyName({ preventDefault() {} });
  const registryAfter = JSON.stringify(loadRegistry(storage, { accountId: firstAddress, chainId: CHAIN }).registry);
  assert.equal(registryAfter, registryBefore); // naming never touches money/registry state
  const idx = loadMyPiggiesIndex(storage, CHAIN).index;
  const named = idx.piggies.find((p) => p.id === piggy2.id);
  assert.equal(named.name, "Bumble Bee 1234567890123"); // real 24-char slice
  const honeybunRow = idx.piggies.find((p) => p.id === `legacy-${firstAddress.toLowerCase()}`);
  assert.equal(honeybunRow.name, "Honeybun"); // untouched neighbor
  assert.equal(appAfterSecond.state.pendingNamePiggyId, null);
  deepEq(appAfterSecond.calls.setScene[appAfterSecond.calls.setScene.length - 1], ["sendstay", "", ""]); // Home
});

await check("d2. Home now shows 2+ actual residents, in index order, with real names/addresses", async () => {
  const rows = appAfterSecond.indexedResidents();
  assert.equal(rows.length, 2);
  deepEq(rows.map((r) => r.id), [`legacy-${firstAddress.toLowerCase()}`, piggy2.id]);
  deepEq(rows.map((r) => r.name), ["Honeybun", "Bumble Bee 1234567890123"]);
  deepEq(rows.map((r) => r.address.toLowerCase()), [firstAddress.toLowerCase(), piggy2.address.toLowerCase()]);
  const residents = appAfterSecond.homeResidents("home", false);
  assert.equal(residents.length, 2);
  deepEq(residents.map((r) => r.name), ["Honeybun", "Bumble Bee 1234567890123"]);
});

// ══ e) refresh/reopen from persisted storage — same count/order/names/addresses/locators, no dup, no sequence reuse ══
let reopened;
await check("e1. a fresh reopen (new state, new vm context, same storage) reconstructs the same 2 Piggies — same order, names, addresses, locators", async () => {
  const before = appAfterSecond.indexedResidents();
  reopened = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun" });
  const after = reopened.indexedResidents();
  deepEq(after, before);
  assert.equal(after.length, 2);
  deepEq(new Set(after.map((p) => p.id)).size, 2); // no duplicate Piggy
  deepEq(new Set(after.map((p) => p.address.toLowerCase())).size, 2);
});

await check("e2. admitting a third Piggy after reopen gets the NEXT sequence (2), never reuses 1, and the watermark survives the reopen", async () => {
  const client = fakeClient();
  reopened.setRequestPrf(requestPrfWith(client));
  const before = loadMyPiggiesIndex(storage, CHAIN).index;
  assert.equal(before.issuedThrough, 1);
  const out = await reopened.beginAddPiggy();
  assert.equal(out.started, true);
  const idx = loadMyPiggiesIndex(storage, CHAIN).index;
  piggy3 = idx.piggies.find((p) => p.id === out.piggyId);
  assert.equal(piggy3.sequence, 2);
  assert.equal(idx.issuedThrough, 2);
  assert.notEqual(piggy3.address.toLowerCase(), firstAddress.toLowerCase());
  assert.notEqual(piggy3.address.toLowerCase(), piggy2.address.toLowerCase());
  deepEq(idx.piggies.filter((p) => p.sequence).map((p) => p.sequence), [1, 2]);
  reopened.nameInputBox.value = "Third Piggy";
  reopened.savePiggyName({ preventDefault() {} });
});

await check("e3. yet another reopen still shows all 3 Piggies with their persisted balances (2 known-$0, Honeybun unknown), in order", async () => {
  const app3 = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun" });
  const rows = app3.indexedResidents();
  deepEq(rows.map((r) => r.id), [`legacy-${firstAddress.toLowerCase()}`, piggy2.id, piggy3.id]);
  const snap = app3.moneyPiggiesSnapshot();
  assert.equal(snap.piggies.find((p) => p.id === piggy2.id).valuation.usd, "0");
  assert.equal(snap.piggies.find((p) => p.id === piggy3.id).valuation.usd, "0");
  assert.equal(snap.piggies.find((p) => p.id === `legacy-${firstAddress.toLowerCase()}`).valuation, null);
});

// ══ f) switching Honeybun ↔ second Piggy never leaves a previous session/permission alive ══
let liveApp, honeybunRow2, piggyBRow2, envHoldByHoneybun;
await check("f1. selecting Honeybun then establishing a real money session, then switching to the second Piggy, ends Honeybun's session and clears the pending intent", async () => {
  liveApp = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun" });
  const snap = liveApp.moneyPiggiesSnapshot();
  honeybunRow2 = snap.piggies.find((p) => p.id === `legacy-${firstAddress.toLowerCase()}`);
  piggyBRow2 = snap.piggies.find((p) => p.id === piggy2.id);
  liveApp.applyPiggySelection(honeybunRow2);
  deepEq({ ...liveApp.state.selectedPiggy }, { id: honeybunRow2.id, address: honeybunRow2.address });

  liveApp.setRequestPrf(requestPrfWith(fakeClient())); // Honeybun's default-salt credential
  liveApp.state.moneyIntent = { piggyId: honeybunRow2.id, status: PERMISSION_STATE.AWAITING, action: "send_money", asset: "USDC", amount: "1", destination: DEST };
  await liveApp.requestMoneyPermission();
  assert.equal(liveApp.state.moneyIntent.status, PERMISSION_STATE.PERMITTED);
  envHoldByHoneybun = liveApp.state.moneyIntent.permission;
  assert.ok(envHoldByHoneybun);
  assert.equal(liveApp.state.activeSignerAddress.toLowerCase(), firstAddress.toLowerCase());
  assert.ok(liveApp.getActiveAccount()); // a real viem-shaped signing account is live

  liveApp.applyPiggySelection(piggyBRow2);
  deepEq({ ...liveApp.state.selectedPiggy }, { id: piggyBRow2.id, address: piggyBRow2.address });
  assert.equal(liveApp.getActiveAccount(), null); // endActiveSession() really ran
  assert.equal(liveApp.state.activeSignerAddress, "");
  assert.equal(liveApp.state.moneyIntent, null);
  assert.equal(liveApp.state.funding, null);
});

await check("f2. the permission Honeybun held cannot be authorized once the second Piggy is selected — the old session is not merely forgotten, it is refused", async () => {
  const req = { piggyId: honeybunRow2.id, signerAddress: firstAddress, action: "send_money", asset: "USDC", amount: "1", chain: CHAIN, destination: DEST };
  const out = liveApp.authorizeMoneyAction(req);
  assert.equal(out.ok, false);
  // applyPiggySelection() already nulled state.moneyIntent, so there is no envelope left to
  // even present ("no_permission") — the strongest form of "not merely forgotten, refused".
  assert.ok(["no_permission", "selected_piggy_mismatch", "no_selection_context", "active_signer_mismatch"].includes(out.reason), out.reason);
});

await check("f3. switching back the other direction (second Piggy → Honeybun) also tears down the live session before the new selection takes hold", async () => {
  // Piggy #2's locator carries its own prfSalt (from admitModelAPiggy); authRequestForPiggy()
  // reads that salt from the row and asks with it, so any fakeClient() sharing the module's
  // deterministic `secret` reproduces piggy2's real address — no per-Piggy fake needed.
  liveApp.setRequestPrf(requestPrfWith(fakeClient()));
  liveApp.state.moneyIntent = { piggyId: piggyBRow2.id, status: PERMISSION_STATE.AWAITING, action: "send_money", asset: "USDC", amount: "2", destination: DEST };
  await liveApp.requestMoneyPermission();
  assert.equal(liveApp.state.moneyIntent.status, PERMISSION_STATE.PERMITTED);
  assert.ok(liveApp.getActiveAccount());

  liveApp.applyPiggySelection(honeybunRow2);
  assert.equal(liveApp.getActiveAccount(), null);
  assert.equal(liveApp.state.activeSignerAddress, "");
  assert.equal(liveApp.state.moneyIntent, null);
});

// ══ g) money session's active signer must equal the selected Piggy's address; wrong signer fails closed ══
await check("g1. a correctly-derived signer for the selected Piggy matches exactly, and authorizes the matching request", async () => {
  const app = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun" });
  const snap = app.moneyPiggiesSnapshot();
  const rowB = snap.piggies.find((p) => p.id === piggy2.id);
  app.applyPiggySelection(rowB);
  app.setRequestPrf(requestPrfWith(fakeClient()));
  app.state.moneyIntent = { piggyId: rowB.id, status: PERMISSION_STATE.AWAITING, action: "send_money", asset: "USDC", amount: "3", destination: DEST };
  await app.requestMoneyPermission();
  assert.equal(app.state.moneyIntent.status, PERMISSION_STATE.PERMITTED);
  const signer = app.state.moneyIntent.permission.signerAddress;
  assert.equal(signer.toLowerCase(), rowB.address.toLowerCase()); // selected Piggy == active signer
  assert.equal(app.state.activeSignerAddress.toLowerCase(), rowB.address.toLowerCase());
  const out = app.authorizeMoneyAction({ piggyId: rowB.id, signerAddress: signer, action: "send_money", asset: "USDC", amount: "3", chain: CHAIN, destination: DEST });
  assert.equal(out.ok, true);
});

await check("g2. a signer that derives to a DIFFERENT address than the selected Piggy fails closed — no envelope, session torn down, no money authorized", async () => {
  const app = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun" });
  const snap = app.moneyPiggiesSnapshot();
  const rowB = snap.piggies.find((p) => p.id === piggy2.id);
  app.applyPiggySelection(rowB);
  // A different authenticator/secret answers the same pinned-credential-id request but
  // yields a different key — simulating a corrupted/mismatched derivation.
  app.setRequestPrf(requestPrfWith(wrongFakeClient()));
  app.state.moneyIntent = { piggyId: rowB.id, status: PERMISSION_STATE.AWAITING, action: "send_money", asset: "USDC", amount: "3", destination: DEST };
  await app.requestMoneyPermission();
  assert.equal(app.state.moneyIntent.status, PERMISSION_STATE.FAILED);
  assert.equal(app.state.moneyIntent.permissionError, "signer_mismatch");
  assert.equal(app.state.moneyIntent.permission, null);
  assert.equal(app.getActiveAccount(), null); // endActiveSession() ran on the mismatch
  assert.equal(app.state.activeSignerAddress, "");
  const out = app.authorizeMoneyAction({ piggyId: rowB.id, signerAddress: rowB.address, action: "send_money", asset: "USDC", amount: "3", chain: CHAIN, destination: DEST });
  assert.equal(out.ok, false); // nothing to authorize — no envelope was ever issued
});

// ══ h) per-Piggy Receipt/HISTORY isolated after reopen; ownerless legacy rows in neither ══
const RECEIPTS = [
  { date: "SEP 23", statusLabel: "gave 3", piggyId: piggy2.id },
  { date: "SEP 22", statusLabel: "went out", piggyId: `legacy-${firstAddress.toLowerCase()}` },
  { date: "SEP 21", statusLabel: "came back empty" }, // ownerless legacy row — no piggyId at all
  { date: "SEP 20", statusLabel: "gave 2", piggyId: piggy2.id },
];
await check("h1. after reopen, selecting the second Piggy's history shows only its own rows — Honeybun's rows and the ownerless row never leak in", async () => {
  const app = openApp(storage, {
    address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun",
    receipts: RECEIPTS, historyPiggyId: piggy2.id,
  });
  const rows = app.historyRows();
  deepEq(rows.map((r) => r.receipt.statusLabel), ["gave 3", "gave 2"]);
  assert.ok(rows.every((r) => r.receipt.piggyId === piggy2.id));
  // [A-551 fix] historyIdentityName() now resolves through moneyPiggiesSnapshot() (financial
  // registry merged with the MY PIGGIES index by exact id — the same merge MY MONEY row
  // selection already uses), so the second Piggy's masthead shows the name it was actually
  // given in d1 ("Bumble Bee 1234567890123"), not its bare id.
  assert.equal(app.historyIdentityName(), "Bumble Bee 1234567890123");
});

await check("h2. selecting Honeybun's history after the same reopen shows only Honeybun's rows — the ownerless row still appears in neither", async () => {
  const app = openApp(storage, {
    address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun",
    receipts: RECEIPTS, historyPiggyId: `legacy-${firstAddress.toLowerCase()}`,
  });
  const rows = app.historyRows();
  deepEq(rows.map((r) => r.receipt.statusLabel), ["went out"]);
  assert.ok(rows.every((r) => r.receipt.piggyId === `legacy-${firstAddress.toLowerCase()}`));
  assert.equal(app.historyIdentityName(), "Honeybun");
});

await check("h3. the ownerless legacy row is invisible from both Piggy-specific filters, but still present in the unfiltered (no selection) path", async () => {
  const appAll = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", receipts: RECEIPTS, historyPiggyId: null });
  const all = appAll.historyRows();
  assert.equal(all.length, RECEIPTS.length);
  assert.ok(all.some((r) => r.receipt.statusLabel === "came back empty"));

  for (const id of [piggy2.id, `legacy-${firstAddress.toLowerCase()}`]) {
    const app = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", receipts: RECEIPTS, historyPiggyId: id });
    assert.ok(!app.historyRows().some((r) => r.receipt.statusLabel === "came back empty"), `ownerless row leaked into ${id}`);
  }
});

// ══ i) [A-551] HISTORY masthead identity — named added Piggy shows its MY PIGGIES index ══
// name (exact id), survives reopen, unnamed/unmatched keeps the safe id fallback, two
// Piggies never swap/borrow each other's name, and Honeybun's masthead is unchanged.
await check("i1. a named added Piggy's HISTORY masthead shows its MY PIGGIES index name, not its bare id", async () => {
  const app = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", historyPiggyId: piggy2.id });
  assert.equal(app.historyIdentityName(), "Bumble Bee 1234567890123");
  const app3 = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", historyPiggyId: piggy3.id });
  assert.equal(app3.historyIdentityName(), "Third Piggy");
});

await check("i2. after a fresh reopen (new state, new vm context, same storage), the added Piggy's masthead still shows its name", async () => {
  const reopenedAgain = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", historyPiggyId: piggy2.id });
  assert.equal(reopenedAgain.historyIdentityName(), "Bumble Bee 1234567890123");
});

let unnamedId, unnamedAddress;
await check("i3. an added Piggy that was never named (index row name=null) falls back to its safe id — never invented, never borrowed", async () => {
  const unnamedPrf = crypto.randomBytes(32);
  unnamedAddress = addressOf(unnamedPrf);
  unnamedId = `piggy-${unnamedAddress.toLowerCase()}`;
  const reg = registerControlledPiggy(storage, CHAIN, {
    id: unnamedId, name: null, address: unnamedAddress, signerAddress: unnamedAddress,
    locator: { credentialId: ROOT_ID }, at: AT,
  });
  assert.equal(reg.ok, true);
  const app = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", historyPiggyId: unnamedId });
  assert.equal(app.historyIdentityName(), unnamedId);
});

await check("i4. a historyPiggyId matching nothing in the index or registry also falls back to the bare id (missing/unmatched, not another Piggy's name)", async () => {
  const unmatchedId = "piggy-0xffffffffffffffffffffffffffffffffffffff";
  const app = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", historyPiggyId: unmatchedId });
  assert.equal(app.historyIdentityName(), unmatchedId);
});

await check("i5. two named Piggies never swap or borrow each other's masthead name — each exact id resolves only to its own name", async () => {
  const appB = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", historyPiggyId: piggy2.id });
  const appC = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", historyPiggyId: piggy3.id });
  const nameB = appB.historyIdentityName();
  const nameC = appC.historyIdentityName();
  assert.equal(nameB, "Bumble Bee 1234567890123");
  assert.equal(nameC, "Third Piggy");
  assert.notEqual(nameB, nameC);
  // the unnamed Piggy's id fallback must not pick up either named Piggy's name either.
  const appU = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", historyPiggyId: unnamedId });
  assert.equal(appU.historyIdentityName(), unnamedId);
  assert.notEqual(appU.historyIdentityName(), nameB);
  assert.notEqual(appU.historyIdentityName(), nameC);
});

await check("i6. the first Piggy's (Honeybun) HISTORY masthead is unchanged by this fix — still its own registry/index name, exact id only", async () => {
  const app = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", historyPiggyId: `legacy-${firstAddress.toLowerCase()}` });
  assert.equal(app.historyIdentityName(), "Honeybun");
  // the no-selection (single-Piggy Home) path is untouched — still displayPiggyName(), no index/registry read.
  const appNoSelection = openApp(storage, { address: firstAddress, secondJourneyCompletedOnce: true, piggyName: "Honeybun", historyPiggyId: null });
  assert.equal(appNoSelection.historyIdentityName(), "Honeybun");
});

console.log(`\n${pass}/${pass} PASS`);
