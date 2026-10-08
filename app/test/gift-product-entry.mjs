// [A-559 PHASE S2] Gift claim **product entry** proof — drives the actual app boot/claim
// functions cut straight out of main.js in node:vm (multi-piggy-product-reopen.mjs /
// gift-claim-wallet-birth.mjs technique), with real Mera passkey/PRF/signing-session code
// behind a deterministic fake WebAuthn assertion, and the real gift-claim-entry.js /
// gift-piggy-claim-link.js modules imported directly (not reimplemented).
//   node app/test/gift-product-entry.mjs
//
// Network 0 · real device Face ID 0 · real tx 0 · UI/copy/button/CSS changes 0.
//
// What is real vs mocked:
//   REAL (compiled straight from app/src/main.js text): activateSigningSession/
//   endSignerSession/endActiveSession/touchAppSession/armSignerExpiry, readCredential/
//   writeCredential, storedPrfSalt, indexedPiggyId/indexControlledPiggy, recoverPiggy,
//   noteRecoverSuccess/Failure, checkPiggy, startPiggyOpen, GIFT_RECORD_SOURCE/
//   pendingGiftClaim/stripClaimFragmentFromUrl/settlePendingGiftClaimIfAny, the boot-time
//   fragment read, indexedResidents/modelARootCredential/webLocks/beginAddPiggy/
//   projectBirthUnfunded/admitAddedPiggy.
//   REAL (imported directly, not sliced): every gift-claim-entry.js / gift-piggy-claim-link.js
//   function, admitModelAPiggy/loadMyPiggiesIndex/registerControlledPiggy (piggy-index.js),
//   createPiggy/loadRegistry/migrateSinglePiggy/saveRegistry (piggy-registry.js), the real
//   Mera SDK (createSecp256k1SigningSession/getEvmAddress/getPasskeyPrfOutput/toViemAccount),
//   viem's recoverMessageAddress.
//   MOCKED (free variables this harness supplies, same convention as every other main.js
//   vm-slice test in this repo — model-a-add-piggy.mjs/gate-b-product-recovery.mjs/
//   multi-piggy-product-reopen.mjs): `requestPrf` (calls the real Mera getPasskeyPrfOutput
//   with an explicit fake webAuthnClient instead of main.js's own browser-WebAuthn wrapper),
//   `setScene`/`render`, `localStorage`/`navigator.locks`, `location`/`history` (for the
//   fragment/strip proof), `isAllowedPiggyRpId`/`readPiggyName`/`hasReceivedPiggy`.
//
// [A-579 Lane G] Gift now binds ONLY to a newly-created Gift Piggy, taken at the START of the
// creating flow: openPiggy() (first birth) and beginGiftPiggy() (Model-A new Piggy). checkPiggy
// (recovery of an EXISTING Piggy) and beginAddPiggy (regular +Piggy) no longer settle anything
// (A-566 misassignment fix). openPiggy() IS now driven end-to-end (§9b) through main.js's own
// three-locked LOCAL_ONLY webAuthnClient hook (harness rpId + LOCAL_DEV path + injected hook
// object) with the REAL Mera createPasskeyWithPrfOutput; its source order is still asserted (§0c).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress, isMeraError } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { recoverMessageAddress } from "viem";
import { admitModelAPiggy, loadMyPiggiesIndex, myPiggiesIndexKey, registerControlledPiggy, markBornPiggyIssuance } from "../src/piggy-index.js";
import { createPiggy, loadRegistry, migrateSinglePiggy, normalizePiggy, projectRegistryTotals, saveRegistry } from "../src/piggy-registry.js";
import { prfSaltFromHex, modelASalt } from "../src/piggy-session.js";
import { createMemoryStorage } from "../src/second-journey-state.js";
import { ISSUANCE_AUTHORITY_INTERFACE_VERSION, ISSUANCE_REFUSAL, PLUS_PURPOSE, REGISTERED_TOPIC0 } from "../src/issuance-authority.js";
import {
  CLAIM_RESULT,
  CLAIM_STATUS,
  buildClaimUrl,
  claimParties,
  claimStatement,
  createClaimLink,
  sealClaimLink,
  attachGiftValue,
  attachTransferReceipt,
} from "../src/gift-piggy-claim-link.js";
import { GIFT_ENTRY_STATUS, beginGiftClaim, bindGiftToNewPiggy, createGiftClaimSubmitter, isGiftBinding, readClaimFragment, settleGiftClaim } from "../src/gift-claim-entry.js";
import { giftValueLabel, GIFT_VALUE_LABEL, buildGiftValueBinding } from "../src/gift-value-spec.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function cut(startMarker, endMarker) {
  const start = MAIN.indexOf(startMarker);
  if (start < 0) throw new Error(`main.js 에서 못 찾음(시작): ${startMarker}`);
  const end = MAIN.indexOf(endMarker, start);
  if (end < 0) throw new Error(`main.js 에서 못 찾음(끝): ${endMarker}`);
  return MAIN.slice(start, end);
}

// ── real function slices, cut straight out of main.js ─────────────────────────────────────
const SESSION_SRC = cut("let activeSession = null;", "// --- 씬 정리 (A-292 번호 9)");
const ERR_SRC = cut("function isCancelledAuthError(error) {", "function requestPrf(credential");
const RAW_OPEN_SRC = cut("function storedPrfSalt() {", "function stayHome() {");
// [A-562 LANE C] main.js now derives GIFT_RECORD_SOURCE from GIFT_RECORD_CONFIG (still `null` by
// product default) via `createGiftRecordSource(...)` instead of a bare `= null;` literal — the
// exact real block, not a paraphrase, so a change to that block breaks this assertion instead of
// silently drifting.
const GIFT_RECORD_SOURCE_BLOCK =
  "const GIFT_RECORD_SOURCE = GIFT_RECORD_CONFIG\n" +
  "  ? createGiftRecordSource({\n" +
  "      client: publicClient,\n" +
  "      chainScope: GIFT_RECORD_CONFIG.chainScope,\n" +
  "      contractAddress: GIFT_RECORD_CONFIG.contractAddress,\n" +
  "    })\n" +
  "  : null;";
assert.match(
  RAW_OPEN_SRC,
  new RegExp(GIFT_RECORD_SOURCE_BLOCK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  "치환 대상 리터럴이 소스에 그대로 있어야 한다",
);
// Same technique gate-b-product-recovery.mjs uses for INDEX_BACKUP_ADAPTER: substitute ONLY
// this test file's copy of the literal so a test can inject a record source — main.js's own
// source (the product default `GIFT_RECORD_CONFIG = null`) is not touched. `createGiftRecordSource`
// itself is never called in this substitution (a plain injected object is enough to prove the
// wiring), so this harness does not need to also supply that free variable.
// [A-579 Lane G] same technique for the new submit seam: the product literal must be present
// verbatim, and only this test's copy is swapped to an injectable fake submitter.
const GIFT_SUBMITTER_BLOCK =
  "const GIFT_CLAIM_SUBMITTER = GIFT_CLAIM_SUBMIT_CONFIG && GIFT_RECORD_CONFIG\n" +
  "  ? createGiftClaimSubmitter(GIFT_CLAIM_SUBMIT_CONFIG)\n" +
  "  : null;";
assert.ok(RAW_OPEN_SRC.includes(GIFT_SUBMITTER_BLOCK), "submitter literal must be in the source verbatim");
assert.match(RAW_OPEN_SRC, /const GIFT_CLAIM_SUBMIT_CONFIG = null;/);
const OPEN_SRC = RAW_OPEN_SRC.replace(
  GIFT_RECORD_SOURCE_BLOCK,
  "const GIFT_RECORD_SOURCE = globalThis.__GIFT_RECORD_SOURCE__ ?? null;",
).replace(GIFT_SUBMITTER_BLOCK, "const GIFT_CLAIM_SUBMITTER = globalThis.__GIFT_CLAIM_SUBMITTER__ ?? null;");
const RAW_ADD_SRC = cut("// [A-522 B2a] MY PIGGIES 색인 = **제품 읽기 원천**", "function homePadMarkup(scene) {");
// [A-711] same technique as the record source / submitter seams: the product literal (`= null`, no authority, no
// registry address, no provider) must be in the source verbatim; only THIS file's copy is swapped for an injectable fake.
assert.equal((RAW_ADD_SRC.match(/^const ISSUANCE_AUTHORITY = null;$/gm) || []).length, 1, "product default: issuance authority is null");
const ADD_SRC = RAW_ADD_SRC.replace("const ISSUANCE_AUTHORITY = null;", "const ISSUANCE_AUTHORITY = globalThis.__ISSUANCE_AUTHORITY__ ?? null;");
const BOOT_SRC = cut(
  "// [A-559 PHASE S1] Gift 링크 fragment 를 부팅 시 **한 번만** 읽어 둔다.",
  "\n\nrender();",
);

for (const [name, src, needle] of [
  ["activateSigningSession", SESSION_SRC, "function activateSigningSession("],
  ["isCancelledAuthError", ERR_SRC, "function isCancelledAuthError("],
  ["checkPiggy", OPEN_SRC, "async function checkPiggy("],
  ["startPiggyOpen", OPEN_SRC, "async function startPiggyOpen("],
  ["openPiggy", OPEN_SRC, "async function openPiggy("],
  ["settleBoundGiftClaim", OPEN_SRC, "async function settleBoundGiftClaim("],
  ["takePendingGiftClaim", OPEN_SRC, "function takePendingGiftClaim("],
  ["beginAddPiggy", ADD_SRC, "async function beginAddPiggy("],
  ["runModelAAdmission", ADD_SRC, "async function runModelAAdmission("],
  ["beginGiftPiggy", ADD_SRC, "async function beginGiftPiggy("],
  ["indexedResidents", ADD_SRC, "function indexedResidents("],
]) {
  if (!src.includes(needle)) throw new Error(`잘라낸 구간에 ${name} 없음 — 마커 확인 필요`);
}

// ── §0c openPiggy's own wiring — source-order assertion (openPiggy() itself is not driven
// end-to-end by this harness, see file header) ─────────────────────────────────────────────
{
  const code = MAIN.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const fn = (name) => { const i = code.indexOf(`function ${name}(`); return code.slice(i, code.indexOf("\n}\n", i)); };
  const open = fn("openPiggy");
  // [A-579 Lane G] intent is taken at the START (before the passkey is created), bound only to
  // the address this very call derived, and only then settled.
  assert.ok(open.indexOf("takePendingGiftClaim()") > 0 && open.indexOf("takePendingGiftClaim()") < open.indexOf("createPasskeyWithPrfOutput("));
  assert.ok(open.indexOf("knownPiggyAddresses()") < open.indexOf("createPasskeyWithPrfOutput("));
  assert.match(open, /lastGiftClaimSettlement = await settleBoundGiftClaim\(bound\.binding, giftIntent\);/);
  assert.match(open, /bindGiftToNewPiggy\(\{ intent: giftIntent, piggy: \{ address \}, preExistingAddresses: giftPreExisting, signerAddress: state\.activeSignerAddress, requireSequence: false \}\)/);
  assert.match(open, /if \(giftIntent && !giftAttempted\) restorePendingGiftClaim\(giftIntent\);/);
  const order = ["indexControlledPiggy(", "noteRecoverSuccess()", "bindGiftToNewPiggy(", "settleBoundGiftClaim(bound.binding, giftIntent)"];
  let last = -1;
  for (const token of order) { const at = open.indexOf(token); assert.ok(at > last, token); last = at; }
  // A-566 misassignment fix: recovery and regular +Piggy never touch the pending Gift.
  for (const name of ["checkPiggy", "beginAddPiggy", "runModelAAdmission", "recoverPiggy"]) {
    for (const banned of ["settleBoundGiftClaim", "takePendingGiftClaim", "pendingGiftClaim", "bindGiftToNewPiggy"]) {
      assert.equal(fn(name).includes(banned), false, `${name} must not reference ${banned}`);
    }
  }
  // the only settle call sites in the whole file are openPiggy + beginGiftPiggy + (A-897 case 2) a897GiftOpenPromotion.
  // [A-897 re-pin · pre-A-897 P1 baseline: 2] the third site binds only through bindGiftToPromotedFirstPiggy (the same #1), never to a new Piggy.
  assert.equal((code.match(/await settleBoundGiftClaim\(/g) || []).length, 3);
  assert.equal((fn("a897GiftOpenPromotion").match(/await settleBoundGiftClaim\(/g) || []).length, 1);
  assert.equal(code.includes("settlePendingGiftClaimIfAny"), false);
  // setScene() still happens somewhere after the claim attempt (scene continues normally,
  // it is just not driven by the claim's outcome) — checked from that point on, since an
  // earlier unrelated setScene() also exists on openPiggy's early "not from here" return.
  assert.ok(open.indexOf("setScene(", last) > last);
}

const CHAIN = "monad-testnet";
const RP = "araso-harness.local.test";
const ORIGIN = "https://araso-harness.local.test";
const SENDER_ADDRESS = "0x00000000000000000000000000000000000000a1";

// ── deterministic fake WebAuthn per identity secret (A-493/A-512 pattern) ─────────────────
function fakeClient(secret, { fail = false } = {}) {
  const credentialIdBytes = crypto.createHmac("sha256", secret).update("credential-id/v1").digest();
  const calls = { get: 0, create: 0 };
  const client = {
    async createCredential() { calls.create += 1; throw new Error("createCredential must never be called by this harness"); },
    async getCredential(req) {
      calls.get += 1;
      if (fail) throw new Error("NotAllowedError: user cancelled");
      const prfOutput = new Uint8Array(crypto.createHmac("sha256", secret).update("prf/v1").update(Buffer.from(req.prfSalt)).digest());
      return { credentialId: credentialIdBytes, prfOutput };
    },
  };
  client.calls = calls;
  // Mera's getPasskeyPrfOutput/createPasskeyWithPrfOutput return `credentialId` base64url-encoded
  // (node_modules/@category-labs/mera/dist/passkey.js) — this is the STRING form main.js/
  // piggy-index.js actually store/compare (registerControlledPiggy locator, rootCredential,
  // state.credential). The raw bytes above are only what a WebAuthnClient itself returns.
  client.credentialIdString = credentialIdBytes.toString("base64url");
  return client;
}
// Same deterministic identity, but also able to CREATE (openPiggy's first-birth path, via main.js's
// three-locked LOCAL_ONLY hook — see §9b). Same shape as A-577's fixture authenticator.
function fakeCreateClient(secret, { failCreate = false } = {}) {
  const base = fakeClient(secret);
  const credentialIdBytes = crypto.createHmac("sha256", secret).update("credential-id/v1").digest();
  base.createCredential = async (req) => {
    base.calls.create += 1;
    if (failCreate) throw new Error("NotAllowedError: user cancelled");
    const prfOutput = new Uint8Array(crypto.createHmac("sha256", secret).update("prf/v1").update(Buffer.from(req.prfSalt)).digest());
    return { credentialId: credentialIdBytes, transports: ["internal"], prfEnabled: true, prfOutput };
  };
  return base;
}
const requestPrfWith = (client) => async (credential, { prfSalt } = {}) =>
  getPasskeyPrfOutput({ rpId: RP, ...(credential ? { credential } : {}), ...(prfSalt instanceof Uint8Array ? { prfSalt } : {}), webAuthnClient: client });
const addressOf = (prf) => getEvmAddress(createSecp256k1SigningSession({ privateKey: prf }).publicKey);

async function seedFirstPiggy(storage, client, { name = "Honeybun", chain = CHAIN } = {}) {
  const prf = (await requestPrfWith(client)(null, {})).prfOutput;
  const address = addressOf(prf);
  const out = registerControlledPiggy(storage, chain, {
    id: `legacy-${address.toLowerCase()}`, name, address, signerAddress: address,
    locator: { credentialId: client.credentialIdString }, at: "2026-09-24T09:00:00.000Z",
  });
  assert.equal(out.ok, true);
  assert.equal(markBornPiggyIssuance(storage, chain, { address }).ok, true);   // [A-695] 생성 경로 시드
  storage.setItem("araso.passkey", JSON.stringify({ credentialId: client.credentialIdString }));
  return address;
}

// ── in-memory Gift record source — the exact seam main.js's GIFT_RECORD_SOURCE expects ────
function memoryRecordSource(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { map, async getRecordByGiftId(giftId) { return map.has(giftId) ? map.get(giftId) : null; } };
}
async function makeLink({ giftId, senderAddress = SENDER_ADDRESS, chainId = CHAIN, createdAt = "2026-09-24T09:00:00.000Z", expiresAt = null, value = null } = {}) {
  const made = createClaimLink({ giftId, senderAddress, chainId, createdAt, expiresAt });
  if (!made.ok) throw new Error(`STOP: ${made.reason}`);
  let record = made.record;
  if (value) {
    const attached = attachGiftValue(record, value);
    if (!attached.ok) throw new Error(`STOP: ${attached.reason}`);
    record = attached.record;
  }
  record = await sealClaimLink(record, made.token);
  const url = buildClaimUrl(ORIGIN, { giftId, token: made.token });
  return { record, token: made.token, url };
}

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

// ── "open the app" — a brand-new vm context + brand-new `state` each time (close/reopen). ──
function openApp(storage, { href = `${ORIGIN}/`, credential, address = null, secondJourneyCompletedOnce = false, requestPrf, giftRecordSource, giftSubmitter = null, webAuthnHook = null, issuanceAuthority = null, chainId = CHAIN } = {}) {
  const storedCredential = (() => { try { return JSON.parse(storage.getItem("araso.passkey") || "null"); } catch { return null; } })();
  const state = {
    address, credential: credential !== undefined ? credential : storedCredential,
    authPhase: "idle", authCancelled: false, recoverFailures: 0, noPiggy: false,
    activeSignerAddress: "", freshRecoveryTried: false,
    secondJourneyCompletedOnce, addPiggy: null, pendingNamePiggyId: null,
  };
  const calls = { setScene: [], render: 0, replaceState: [] };
  let requestPrfRef = requestPrf || (async () => { throw new Error("requestPrf not wired for this call"); });
  const locationBox = { href };
  // [A-563 LANE B] stripClaimFragmentFromUrl() reads location.pathname/location.search and
  // calls history.replaceState(null, "", pathname+search) — mirror the real browser round-trip
  // (not just count the call) so a test can check the hash is actually gone from the address
  // bar afterward, the same way a real reload would see it.
  const ctx = {
    state, console, Buffer, Map, Set, Array, Object, String, Number, Boolean, Date, JSON, Promise, RegExp,
    isMeraError, getEvmAddress, createSecp256k1SigningSession, toViemAccount, prfSaltFromHex,
    admitModelAPiggy, loadMyPiggiesIndex, registerControlledPiggy, markBornPiggyIssuance,
    createPiggy, loadRegistry, migrateSinglePiggy, normalizePiggy, projectRegistryTotals, saveRegistry,
    beginGiftClaim, settleGiftClaim, GIFT_ENTRY_STATUS, readClaimFragment, CLAIM_RESULT,
    bindGiftToNewPiggy, isGiftBinding, createGiftClaimSubmitter, createPasskeyWithPrfOutput,
    hasPlayedBirth: () => false,
    __ARASO_LOCAL_TEST_WEBAUTHN_CLIENT__: webAuthnHook,
    claimStatement, recoverMessageAddress, giftValueLabel,
    safeLocalStorage: () => storage,
    secondJourneyScope: () => ({ accountId: state.address, chainId }),
    localStorage: storage,
    setScene: (...a) => calls.setScene.push(a),
    render: () => { calls.render += 1; },
    readPiggyName: () => null,
    hasReceivedPiggy: () => storage.getItem("araso.piggyReceived") === "1",
    PIGGY_RECEIVED_KEY: "araso.piggyReceived",
    PASSKEY_STORAGE_KEY: "araso.passkey",
    isCancelledAuthError: (error) => isMeraError(error) && error?.cause?.name === "NotAllowedError",
    // SESSION_SRC brings in the REAL isAllowedPiggyRpId()/getRpId()/isProductionRpId()/
    // isLocalDevRpId() (they are not mocked — a ctx-level `isAllowedPiggyRpId` of our own
    // would be shadowed by the real one compiled into the same script). Satisfy them for
    // real: `window.location.hostname` matching the real, hardcoded isolated-harness rpId
    // (`HARNESS_RP_ID` inside SESSION_SRC itself) via the LOCAL_DEV_RP_ID path.
    window: { location: { hostname: RP } },
    PRODUCTION_RP_ID: "arasoo.vercel.app",
    LOCAL_DEV_ENTRY: true,
    LOCAL_DEV_RP_ID: RP,
    requestPrf: (credentialArg, opts) => requestPrfRef(credentialArg, opts || {}),
    navigator: { locks: fifoLocks() },
    document: { querySelector: () => null },
    setTimeout: () => 0,
    clearTimeout: () => {},
    get location() {
      const parsed = new URL(locationBox.href);
      return { href: locationBox.href, pathname: parsed.pathname, search: parsed.search };
    },
    history: {
      replaceState: (...a) => {
        calls.replaceState.push(a);
        const nextUrl = a[2];
        if (typeof nextUrl === "string") {
          locationBox.href = new URL(nextUrl, locationBox.href).href;
        }
      },
    },
    __GIFT_RECORD_SOURCE__: giftRecordSource,
    __ISSUANCE_AUTHORITY__: issuanceAuthority,
    __GIFT_CLAIM_SUBMITTER__: giftSubmitter,
  };
  vm.createContext(ctx);
  vm.runInContext(
    `${SESSION_SRC}\n${ERR_SRC}\n${OPEN_SRC}\n${ADD_SRC}\n${BOOT_SRC}\n` +
      // [A-734] + the Gift Open UI entry (startGiftOpen / openGiftForExistingPiggy / giftPaperKind / offerGiftPaperAtBoot) so §12
      // drives the REAL entry into the REAL beginGiftPiggy (named reason: the entry must be proven on this harness's record-source seam).
      `this.__api = { checkPiggy, startPiggyOpen, openPiggy, beginAddPiggy, beginGiftPiggy, admitAddedPiggy, settleBoundGiftClaim, startGiftOpen, openGiftForExistingPiggy, giftPaperKind, offerGiftPaperAtBoot };\n` +
      `this.__getPendingGiftClaim = () => pendingGiftClaim;\n` +
      `this.__getLastGiftClaimSettlement = () => lastGiftClaimSettlement;\n` +
      `this.__getActiveAccount = () => activeAccount;`,
    ctx,
  );
  return {
    state, calls,
    setRequestPrf: (fn) => { requestPrfRef = fn; },
    setHref: (h) => { locationBox.href = h; },
    getHref: () => locationBox.href,
    getPendingGiftClaim: ctx.__getPendingGiftClaim,
    getLastGiftClaimSettlement: ctx.__getLastGiftClaimSettlement,
    getActiveAccount: ctx.__getActiveAccount,
    ...ctx.__api,
  };
}

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }
const plain = (x) => JSON.parse(JSON.stringify(x));

// ═══ 1. normal boot, no fragment — unchanged ═══════════════════════════════════════════════
await check("1. no fragment in the URL → pendingGiftClaim stays null, boot never renders/setScene by itself, no strip", async () => {
  const storage = createMemoryStorage();
  const app = openApp(storage, { href: `${ORIGIN}/` });
  assert.equal(app.getPendingGiftClaim(), null);
  assert.equal(app.calls.render, 0);
  assert.deepEqual(app.calls.setScene, []);
  // [A-563 LANE B] no-fragment behavior is unchanged: stripClaimFragmentFromUrl() is only
  // reached from inside the READY branch, so a plain boot never calls history.replaceState.
  assert.equal(app.calls.replaceState.length, 0);
});

// ═══ 2. malformed fragment → 0 pending, 0 Piggies ══════════════════════════════════════════
await check("2a. a malformed fragment (bad token shape) never becomes a pending claim, no strip", async () => {
  const storage = createMemoryStorage();
  const href = `${ORIGIN}/#g=gift-1&t=short&v=1`;
  assert.equal(readClaimFragment(href).status, GIFT_ENTRY_STATUS.MALFORMED); // confirmed directly first
  const app = openApp(storage, { href });
  assert.equal(app.getPendingGiftClaim(), null); // and the real boot code agrees
  // [A-563 LANE B] malformed behavior is unchanged: no READY status, so no strip either —
  // the broken fragment is left exactly where it was (unchanged card requirement).
  assert.equal(app.calls.replaceState.length, 0);
  assert.equal(app.getHref(), href);
});

await check("2b. no fragment at all reads as no_fragment, not malformed", () => {
  assert.equal(readClaimFragment(`${ORIGIN}/`).status, GIFT_ENTRY_STATUS.NO_FRAGMENT);
  assert.equal(readClaimFragment("").status, GIFT_ENTRY_STATUS.NO_FRAGMENT);
});

// ═══ 3. valid link + no auth → pending is set, URL is stripped immediately at boot, nothing
// else happens (A-563 Lane B: the strip no longer waits for the auth boundary) ══════════════
await check("3. a valid link with no auth yet: pendingGiftClaim is set, URL fragment is stripped once at boot (before any auth), zero Piggies/auth calls happen", async () => {
  const storage = createMemoryStorage();
  const { url, token } = await makeLink({ giftId: "gift-3-no-auth" });
  const app = openApp(storage, { href: url });
  const pending = app.getPendingGiftClaim();
  // pendingGiftClaim (module memory) still holds the token for the later auth boundary —
  // stripping the address bar does not touch it.
  assert.ok(pending && pending.giftId === "gift-3-no-auth" && pending.token === token);
  // [A-563 LANE B] exactly one replaceState, and it already happened — no auth call
  // (checkPiggy/startPiggyOpen/beginAddPiggy) has been made yet in this test at all.
  assert.equal(app.calls.replaceState.length, 1);
  assert.ok(!app.getHref().includes("#"), `hash should be gone from the address bar: ${app.getHref()}`);
  assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.piggies.length, 0); // 0 Piggies
  assert.equal(app.calls.setScene.length, 0); // no scene change from the fragment read itself
  // the raw token never touches any storage seam this harness exposes.
  assert.ok(!JSON.stringify(storage.dump()).includes(token));
});

// ═══ 3b. simulated reload after the boot-time strip: a fresh boot on the now-hash-less URL
// (module memory is gone, exactly like a real reload) has no pending claim and touches
// nothing — the A-559 tradeoff this card accepts (no persistence added) ══════════════════════
await check("3b. simulated reload on the stripped URL: no pending claim, 0 Piggies, 0 auth, token never in storage", async () => {
  const storage = createMemoryStorage();
  const { url, token } = await makeLink({ giftId: "gift-3b-reload" });
  const first = openApp(storage, { href: url });
  assert.ok(first.getPendingGiftClaim());
  assert.equal(first.calls.replaceState.length, 1);
  const strippedHref = first.getHref();
  assert.ok(!strippedHref.includes("#"));

  // A real reload starts a brand-new module (all `let` module state, including
  // pendingGiftClaim, resets) and the browser now presents the stripped URL — modeled here
  // by a fresh openApp() call on strippedHref, not by reusing `first`.
  const reopened = openApp(storage, { href: strippedHref });
  assert.equal(reopened.getPendingGiftClaim(), null);
  assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.piggies.length, 0);
  assert.equal(reopened.calls.setScene.length, 0);
  assert.equal(reopened.calls.replaceState.length, 0); // no fragment left to strip a second time
  assert.equal(reopened.getActiveAccount?.() ?? null, null); // 0 auth

  assert.ok(!JSON.stringify(storage.dump()).includes(token)); // token never persisted, across either boot
});

// ═══ 4. [A-579 Lane G] recovery of an EXISTING Piggy (checkPiggy) never receives the Gift ════
let sharedStorage, sharedClient, firstAddressMain, recipientAddress, giftIdMain, recordSourceMain, urlMain, tokenMain, claimedRecordFromTest4;
await check("4. checkPiggy() (recover an EXISTING Piggy) with a pending Gift + record source: recovery succeeds, NO claim attempt, pending Gift stays intact in memory (A-566 misassignment fix)", async () => {
  sharedStorage = createMemoryStorage();
  sharedClient = fakeClient(crypto.randomBytes(32));
  firstAddressMain = await seedFirstPiggy(sharedStorage, sharedClient);
  giftIdMain = "gift-4-settle";
  const { record, url, token } = await makeLink({ giftId: giftIdMain });
  urlMain = url;
  tokenMain = token;
  recordSourceMain = memoryRecordSource({ [giftIdMain]: record });

  const app = openApp(sharedStorage, { href: urlMain, giftRecordSource: recordSourceMain });
  assert.equal(app.calls.replaceState.length, 1); // boot strip unchanged (A-563)
  app.setRequestPrf(requestPrfWith(sharedClient));
  const out = await app.checkPiggy();
  assert.equal(out.ok, true);
  assert.equal(app.getLastGiftClaimSettlement(), null); // no settle at all
  const pending = app.getPendingGiftClaim();
  assert.ok(pending && pending.giftId === giftIdMain && pending.token === tokenMain); // untouched
  assert.equal(recordSourceMain.map.get(giftIdMain).status, CLAIM_STATUS.UNCLAIMED);
  assert.equal(loadMyPiggiesIndex(sharedStorage, CHAIN).index.piggies.length, 1);
  assert.equal(app.calls.replaceState.length, 1);
});

await check("4b. beginAddPiggy() (regular +Piggy) with a pending Gift: the new Piggy is born, but receives NOTHING — no settlement, pending intact (A-566 test 7 inverted)", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const firstAddress = await seedFirstPiggy(storage, client);
  const giftId = "gift-4b-add-piggy";
  const { record, url, token } = await makeLink({ giftId });
  const recordSource = memoryRecordSource({ [giftId]: record });
  const app = openApp(storage, { href: url, address: firstAddress, secondJourneyCompletedOnce: true, giftRecordSource: recordSource });
  app.setRequestPrf(requestPrfWith(client));
  const out = await app.beginAddPiggy();
  assert.equal(out.started, true, JSON.stringify(out));
  assert.equal(app.getLastGiftClaimSettlement(), null);
  assert.equal(app.getPendingGiftClaim()?.token, token);
  assert.equal(recordSource.map.get(giftId).status, CLAIM_STATUS.UNCLAIMED);
  assert.equal(app.getActiveAccount(), null); // birth session still ended in finally (A-531)
});

await check("4c. beginGiftPiggy(): the pending Gift is bound at START to the NEWLY-created Model-A Gift Piggy (sequence 1) and settles to it — recovered signer == that new Piggy, distinct from the first Piggy and the sender", async () => {
  const app = openApp(sharedStorage, { href: urlMain, address: firstAddressMain, giftRecordSource: recordSourceMain });
  const seen = [];
  app.setRequestPrf(async (cred, opts) => { seen.push({ pendingAtAuth: app.getPendingGiftClaim() }); return requestPrfWith(sharedClient)(cred, opts); });
  const out = await app.beginGiftPiggy();
  assert.equal(out.started, true, JSON.stringify(out));
  assert.equal(out.giftAttempted, true);
  assert.equal(seen.length, 1); // exactly one assertion (Model A), 0 creations
  assert.equal(seen[0].pendingAtAuth, null); // intent already taken at START — nothing else could grab it mid-flow
  assert.equal(sharedClient.calls.create, 0);
  assert.equal(app.getPendingGiftClaim(), null); // consumed exactly once

  // the expected NEW address is derivable independently: same root passkey + modelASalt(1)
  const expectedPrf = (await requestPrfWith(sharedClient)({ credentialId: sharedClient.credentialIdString }, { prfSalt: await modelASalt(1) })).prfOutput;
  recipientAddress = addressOf(expectedPrf);
  assert.equal(out.piggyId, `piggy-${recipientAddress.toLowerCase()}`);
  const settlement = app.getLastGiftClaimSettlement();
  assert.equal(settlement.result, CLAIM_RESULT.OK, JSON.stringify(settlement));
  const parties = plain(settlement.claimParties);
  assert.equal(parties.recipientAddress, recipientAddress);
  assert.notEqual(parties.recipientAddress.toLowerCase(), firstAddressMain.toLowerCase());
  assert.equal(parties.senderAddress, SENDER_ADDRESS);
  assert.equal(parties.distinct, true);
  // product default: no submit transport → exact reason, value never faked
  assert.deepEqual(plain(settlement.valueSubmission), { status: "claim_transport_unavailable" });

  const record = recordSourceMain.map.get(giftIdMain);
  const statement = claimStatement({
    giftId: record.giftId, chainId: record.chainId, senderAddress: record.senderAddress,
    recipientAddress, claimTokenHash: record.claimTokenHash, claimedAt: settlement.record.claimedAt,
  });
  assert.equal(settlement.record.claimProof.statementHash, crypto.createHash("sha256").update(statement).digest("hex"));
  const acct = toViemAccount(createSecp256k1SigningSession({ privateKey: expectedPrf }));
  assert.equal((await recoverMessageAddress({ message: statement, signature: await acct.signMessage({ message: statement }) })).toLowerCase(), recipientAddress.toLowerCase());

  const { index } = loadMyPiggiesIndex(sharedStorage, CHAIN);
  assert.equal(index.piggies.length, 2); // first Piggy + exactly one new Gift Piggy
  assert.equal(index.piggies[1].sequence, 1);
  assert.equal(app.getActiveAccount(), null); // birth session ended after the claim (finally)
  claimedRecordFromTest4 = settlement.record;
});

// ═══ 5. sender cannot claim their own gift ═══════════════════════════════════════════════
await check("5. a self-addressed gift (sender === the would-be new Gift Piggy) settles to SENDER_IS_RECIPIENT, record stays unclaimed", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);
  const selfAddress = addressOf((await requestPrfWith(client)({ credentialId: client.credentialIdString }, { prfSalt: await modelASalt(1) })).prfOutput);
  const giftId = "gift-5-self";
  const { record, url } = await makeLink({ giftId, senderAddress: selfAddress });
  const recordSource = memoryRecordSource({ [giftId]: record });
  const app = openApp(storage, { href: url, address: first, giftRecordSource: recordSource });
  app.setRequestPrf(requestPrfWith(client));
  const out = await app.beginGiftPiggy();
  assert.equal(out.started, true);
  assert.equal(app.getLastGiftClaimSettlement().result, CLAIM_RESULT.SENDER_IS_RECIPIENT);
  assert.equal(recordSource.map.get(giftId).status, CLAIM_STATUS.UNCLAIMED);
});

// ═══ 6. replay cannot create a second claim/identity ═══════════════════════════════════════
await check("6. reopening the SAME already-claimed link on the device that owns the Gift Piggy → already_claimed_by_same BEFORE any auth: 0 requestPrf, 0 new Piggies", async () => {
  assert.equal(claimedRecordFromTest4.status, CLAIM_STATUS.CLAIMED);
  recordSourceMain.map.set(giftIdMain, claimedRecordFromTest4);
  const before = loadMyPiggiesIndex(sharedStorage, CHAIN).index.piggies.length;
  const app = openApp(sharedStorage, { href: urlMain, address: firstAddressMain, giftRecordSource: recordSourceMain });
  let prf = 0;
  app.setRequestPrf(async (...a) => { prf += 1; return requestPrfWith(sharedClient)(...a); });
  const out = await app.beginGiftPiggy();
  assert.equal(out.started, false);
  assert.equal(app.getLastGiftClaimSettlement().reason, CLAIM_RESULT.ALREADY_CLAIMED_BY_SAME, JSON.stringify(app.getLastGiftClaimSettlement()));
  assert.equal(prf, 0);
  assert.equal(loadMyPiggiesIndex(sharedStorage, CHAIN).index.piggies.length, before);
});

await check("6b. a DIFFERENT identity replaying the same already-claimed link is told already-claimed-by-other, 0 auth, 0 Piggies created", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const stranger = await seedFirstPiggy(storage, client);
  const recordSource = memoryRecordSource({ [giftIdMain]: claimedRecordFromTest4 });
  const app = openApp(storage, { href: urlMain, address: stranger, giftRecordSource: recordSource });
  let prf = 0;
  app.setRequestPrf(async (...a) => { prf += 1; return requestPrfWith(client)(...a); });
  await app.beginGiftPiggy();
  assert.equal(app.getLastGiftClaimSettlement().reason, CLAIM_RESULT.ALREADY_CLAIMED_BY_OTHER);
  assert.equal(prf, 0);
  assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.piggies.length, 1);
});

// ═══ 7. beginGiftPiggy edge cases — no pending / cancel / no root ════════════════════════════
await check("7a. beginGiftPiggy() with no pending Gift → no_gift_intent, 0 requestPrf, 0 Piggies", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);
  const app = openApp(storage, { href: `${ORIGIN}/`, address: first, giftRecordSource: memoryRecordSource({}) });
  let prf = 0;
  app.setRequestPrf(async () => { prf += 1; throw new Error("must not be called"); });
  assert.equal((await app.beginGiftPiggy()).reason, "no_gift_intent");
  assert.equal(prf, 0);
  assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.piggies.length, 1);
});

await check("7b. beginGiftPiggy() cancelled at Face ID → no Piggy, no settlement, the SAME pending Gift is restored (retry possible)", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);
  const giftId = "gift-7b-cancel";
  const { record, url, token } = await makeLink({ giftId });
  const recordSource = memoryRecordSource({ [giftId]: record });
  const app = openApp(storage, { href: url, address: first, giftRecordSource: recordSource });
  app.setRequestPrf(requestPrfWith(fakeClient(crypto.randomBytes(32), { fail: true })));
  const out = await app.beginGiftPiggy();
  assert.equal(out.started, false);
  assert.equal(app.getLastGiftClaimSettlement(), null);
  assert.equal(app.getPendingGiftClaim()?.token, token);
  assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.piggies.length, 1);
  // …and a retry with the real passkey then binds to the new Piggy.
  app.setRequestPrf(requestPrfWith(client));
  const retry = await app.beginGiftPiggy();
  assert.equal(retry.started, true);
  assert.equal(app.getLastGiftClaimSettlement().result, CLAIM_RESULT.OK);
});

await check("7c. beginGiftPiggy() without a pinned root credential → missing_root_credential, 0 auth, pending kept", async () => {
  const storage = createMemoryStorage();
  const { url } = await makeLink({ giftId: "gift-7c-noroot" });
  const app = openApp(storage, { href: url, giftRecordSource: memoryRecordSource({}) });
  assert.equal((await app.beginGiftPiggy()).reason, "missing_root_credential");
  assert.ok(app.getPendingGiftClaim());
});

for (const [label, damage, reason] of [
  ["missing index", (st) => st.removeItem(myPiggiesIndexKey(CHAIN)), "origin_index_missing"],
  ["corrupt index", (st) => st.setItem(myPiggiesIndexKey(CHAIN), "{not json"), "origin_index_corrupt"],
]) {
  await check(`7e. [A-695 SEQ-5=A] beginGiftPiggy() on a device with a ${label} fails closed: ${reason}, 0 requestPrf, 0 Piggies written, pending Gift kept, record untouched`, async () => {
    const storage = createMemoryStorage();
    const client = fakeClient(crypto.randomBytes(32));
    const first = await seedFirstPiggy(storage, client);     // saved passkey stays (araso.passkey) — only the local index is lost
    damage(storage);
    const giftId = `gift-7e-${reason}`;
    const { record, url, token } = await makeLink({ giftId });
    const recordSource = memoryRecordSource({ [giftId]: record });
    const app = openApp(storage, { href: url, address: first, giftRecordSource: recordSource });
    let prf = 0;
    app.setRequestPrf(async (...a) => { prf += 1; return requestPrfWith(client)(...a); });
    const before = storage.getItem(myPiggiesIndexKey(CHAIN));
    const out = await app.beginGiftPiggy();
    assert.deepEqual([out.started, out.reason], [false, reason]);
    assert.equal(prf, 0);
    assert.equal(storage.getItem(myPiggiesIndexKey(CHAIN)), before);
    assert.equal(app.getPendingGiftClaim()?.token, token);
    assert.equal(recordSource.map.get(giftId).status, CLAIM_STATUS.UNCLAIMED);
  });
}

await check("7d. a look-alike binding (same fields, not minted by bindGiftToNewPiggy) is refused by settleBoundGiftClaim: binding_invalid", async () => {
  const storage = createMemoryStorage();
  const app = openApp(storage, { href: urlMain, giftRecordSource: recordSourceMain });
  const forged = Object.freeze({ giftId: giftIdMain, recipientAddress: firstAddressMain, piggyId: null, sequence: null, boundAt: "x" });
  assert.equal((await app.settleBoundGiftClaim(forged, { giftId: giftIdMain, token: tokenMain })).status, "binding_invalid");
  const real = bindGiftToNewPiggy({ intent: { giftId: giftIdMain, token: tokenMain }, piggy: { address: SENDER_ADDRESS.replace("a1", "b2") }, preExistingAddresses: [], signerAddress: SENDER_ADDRESS.replace("a1", "b2") });
  assert.equal(real.ok, true);
  assert.equal((await app.settleBoundGiftClaim({ ...real.binding }, { giftId: giftIdMain, token: tokenMain })).status, "binding_invalid"); // spread copy ≠ binding
  assert.equal((await app.settleBoundGiftClaim(real.binding, { giftId: "other", token: tokenMain })).status, "binding_invalid"); // giftId mismatch
});

// ═══ 8. malformed/expired/revoked/bad-token → refused BEFORE auth, 0 extra Piggies ══════════
for (const [label, giftId, mk, expect] of [
  ["8a. expired", "gift-8a-expired", async (id) => makeLink({ giftId: id, createdAt: "2020-01-01T00:00:00Z", expiresAt: "2020-02-01T00:00:00Z" }), { status: GIFT_ENTRY_STATUS.REFUSED, reason: CLAIM_RESULT.EXPIRED }],
  ["8b. revoked", "gift-8b-revoked", async (id) => { const l = await makeLink({ giftId: id }); return { ...l, record: { ...l.record, status: CLAIM_STATUS.REVOKED } }; }, { status: GIFT_ENTRY_STATUS.REFUSED, reason: CLAIM_RESULT.REVOKED }],
  ["8c. bad token", "gift-8c-badtoken", async (id) => { const l = await makeLink({ giftId: id }); return { ...l, url: buildClaimUrl(ORIGIN, { giftId: id, token: "b".repeat(43) }) }; }, { status: GIFT_ENTRY_STATUS.REFUSED, reason: CLAIM_RESULT.BAD_TOKEN }],
  ["8d. unknown link", "gift-8d-unknown", async (id) => { const l = await makeLink({ giftId: id }); return { ...l, record: null }; }, { status: GIFT_ENTRY_STATUS.UNKNOWN_LINK }],
]) {
  await check(`${label} → beginGiftPiggy refuses before any auth (${expect.reason || expect.status}), 0 requestPrf, 0 new Piggies`, async () => {
    const storage = createMemoryStorage();
    const client = fakeClient(crypto.randomBytes(32));
    const first = await seedFirstPiggy(storage, client);
    const { record, url } = await mk(giftId);
    const recordSource = memoryRecordSource(record ? { [giftId]: record } : {});
    const app = openApp(storage, { href: url, address: first, giftRecordSource: recordSource });
    let prf = 0;
    app.setRequestPrf(async (...a) => { prf += 1; return requestPrfWith(client)(...a); });
    const out = await app.beginGiftPiggy();
    assert.equal(out.started, false);
    const settlement = app.getLastGiftClaimSettlement();
    assert.equal(settlement.status, expect.status, JSON.stringify(settlement));
    if (expect.reason) assert.equal(settlement.reason, expect.reason);
    assert.equal(prf, 0);
    assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.piggies.length, 1);
  });
}

await check("8e. malformed fragment never becomes an intent — beginGiftPiggy says no_gift_intent, checkPiggy settles nothing", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);
  const app = openApp(storage, { href: `${ORIGIN}/#g=&t=x&v=1`, address: first, giftRecordSource: memoryRecordSource({}) });
  app.setRequestPrf(requestPrfWith(client));
  assert.equal((await app.beginGiftPiggy()).reason, "no_gift_intent");
  await app.checkPiggy();
  assert.equal(app.getLastGiftClaimSettlement(), null);
});

// ═══ 9. product default — GIFT_RECORD_SOURCE null → record_source_unavailable ══════════════
await check("9. product default (no record source): beginGiftPiggy stops at record_source_unavailable with 0 auth and 0 new Piggies; checkPiggy uses exactly its one normal assertion and settles nothing", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);
  const { url } = await makeLink({ giftId: "gift-9-no-source" });
  const callsBefore = client.calls.get;
  const app = openApp(storage, { href: url, address: first });
  app.setRequestPrf(requestPrfWith(client));
  const g = await app.beginGiftPiggy();
  assert.equal(g.started, false);
  assert.equal(app.getLastGiftClaimSettlement().status, GIFT_ENTRY_STATUS.RECORD_SOURCE_UNAVAILABLE);
  assert.equal(client.calls.get - callsBefore, 0);
  assert.ok(app.getPendingGiftClaim()); // still pending (memory only)
  const out = await app.checkPiggy();
  assert.equal(out.ok, true);
  assert.equal(client.calls.get - callsBefore, 1);
  assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.piggies.length, 1);
});

// ═══ 9b. openPiggy() first birth, end-to-end through the real Mera create + LOCAL_ONLY hook ══
await check("9b. openPiggy() (fresh device first birth) with a pending Gift: REAL Mera createPasskeyWithPrfOutput via the three-locked harness hook; the Gift binds to exactly the address this birth derived and settles to it", async () => {
  const storage = createMemoryStorage();
  const secret = crypto.randomBytes(32);
  const hook = fakeCreateClient(secret);
  const giftId = "gift-9b-open";
  const { record, url } = await makeLink({ giftId });
  const recordSource = memoryRecordSource({ [giftId]: record });
  const app = openApp(storage, { href: url, giftRecordSource: recordSource, webAuthnHook: hook });
  await app.openPiggy();
  assert.equal(hook.calls.create, 1);
  const born = app.state.address;
  assert.match(born, /^0x[0-9a-fA-F]{40}$/);
  const settlement = app.getLastGiftClaimSettlement();
  assert.equal(settlement.result, CLAIM_RESULT.OK, JSON.stringify(settlement));
  assert.equal(settlement.claimParties.recipientAddress, born);
  assert.equal(app.getPendingGiftClaim(), null);
  assert.deepEqual(plain(settlement.valueSubmission), { status: "claim_transport_unavailable" });
  assert.deepEqual(app.calls.setScene.at(-1), ["hatch"]); // scene flow unchanged
});

await check("9b2. [A-695] the real openPiggy create path stamps provenance=\"birth\" on the row it just indexed (and only that row)", async () => {
  const storage = createMemoryStorage();
  const app = openApp(storage, { href: `${ORIGIN}/`, giftRecordSource: memoryRecordSource({}), webAuthnHook: fakeCreateClient(crypto.randomBytes(32)) });
  await app.openPiggy();
  const rows = loadMyPiggiesIndex(storage, CHAIN).index.piggies;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provenance, "birth");
  assert.equal(rows[0].address, app.state.address);
});

await check("9d. [A-695] Check Piggy (recoverPiggy) on a device whose index is gone indexes the Piggy with ZERO provenance; beginGiftPiggy then fails closed: origin_index_no_provenance, no extra requestPrf, pending Gift kept", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);
  storage.removeItem(myPiggiesIndexKey(CHAIN));                      // index lost; saved passkey (araso.passkey) remains
  const giftId = "gift-9d-recovered";
  const { record, url, token } = await makeLink({ giftId });
  const recordSource = memoryRecordSource({ [giftId]: record });
  const app = openApp(storage, { href: url, giftRecordSource: recordSource });
  let prf = 0;
  app.setRequestPrf(async (...a) => { prf += 1; return requestPrfWith(client)(...a); });
  assert.equal((await app.checkPiggy()).ok, true);
  const rows = loadMyPiggiesIndex(storage, CHAIN).index.piggies;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].address.toLowerCase(), first.toLowerCase());
  assert.equal("provenance" in rows[0], false, "recovery creates zero provenance");
  const before = prf;
  const out = await app.beginGiftPiggy();
  assert.deepEqual([out.started, out.reason], [false, "origin_index_no_provenance"]);
  assert.equal(prf, before, "no requestPrf for the refused +Piggy/Gift");
  assert.equal(app.getPendingGiftClaim()?.token, token);
  assert.equal(recordSource.map.get(giftId).status, CLAIM_STATUS.UNCLAIMED);
});

await check("9e. [A-695] after Check Piggy re-indexes an EXISTING born row (update path) the provenance is kept — recovery neither adds nor strips it", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);                 // born
  const app = openApp(storage, { href: `${ORIGIN}/`, giftRecordSource: memoryRecordSource({}) });
  app.setRequestPrf(requestPrfWith(client));
  assert.equal((await app.checkPiggy()).ok, true);
  const rows = loadMyPiggiesIndex(storage, CHAIN).index.piggies;
  assert.deepEqual([rows.length, rows[0].provenance, rows[0].address.toLowerCase()], [1, "birth", first.toLowerCase()]);
});

await check("9c. openPiggy() cancelled at create → no Piggy, pending Gift restored; openPiggy() with no pending → settlement stays null", async () => {
  const storage = createMemoryStorage();
  const { url, token } = await makeLink({ giftId: "gift-9c-cancel" });
  const app = openApp(storage, { href: url, giftRecordSource: memoryRecordSource({}), webAuthnHook: fakeCreateClient(crypto.randomBytes(32), { failCreate: true }) });
  await app.openPiggy();
  assert.equal(app.getLastGiftClaimSettlement(), null);
  assert.equal(app.getPendingGiftClaim()?.token, token);
  assert.equal(app.state.address, null);
  const plainBoot = openApp(createMemoryStorage(), { href: `${ORIGIN}/`, webAuthnHook: fakeCreateClient(crypto.randomBytes(32)) });
  await plainBoot.openPiggy();
  assert.match(plainBoot.state.address, /^0x/);
  assert.equal(plainBoot.getLastGiftClaimSettlement(), null);
});

await check("9c2. [A-579 repair N-1] openPiggy(): a Gift settle that THROWS after the birth never turns the created Piggy into \"could not open\" — scene flow unchanged, Piggy indexed, failure recorded as claim_settle_failed, the attempted intent is not re-armed", async () => {
  const storage = createMemoryStorage();
  const giftId = "gift-9c2-throw";
  const { url } = await makeLink({ giftId });
  // a record source that answers with a record whose every field read throws — beginGiftClaim's own
  // try covers only the fetch, so before the repair this rejected settleBoundGiftClaim inside openPiggy.
  const exploding = new Proxy({}, { get(_t, key) { if (key === "then") return undefined; throw new Error("record read exploded SECRET-9c2"); } }); // not a thenable, so the fetch itself resolves
  const recordSource = { async getRecordByGiftId() { return exploding; } };
  const hook = fakeCreateClient(crypto.randomBytes(32));
  const app = openApp(storage, { href: url, giftRecordSource: recordSource, webAuthnHook: hook });
  await app.openPiggy();
  assert.equal(hook.calls.create, 1);
  const born = app.state.address;
  assert.match(born, /^0x[0-9a-fA-F]{40}$/);
  assert.deepEqual(plain(app.getLastGiftClaimSettlement()), { status: "claim_settle_failed" });
  assert.equal(JSON.stringify(app.getLastGiftClaimSettlement()).includes("SECRET"), false);
  assert.equal(app.getPendingGiftClaim(), null);
  assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.piggies.some((p) => p.address.toLowerCase() === born.toLowerCase()), true);
  assert.deepEqual(app.calls.setScene.at(-1), ["hatch"]); // exactly the 9b scene flow
  assert.equal(app.calls.setScene.some((call) => call[1] === "Piggy could not open here."), false);
  assert.equal(app.state.authPhase, "idle");
});

await check("9d. an injected submitter (test-only substitution of GIFT_CLAIM_SUBMITTER) is called ONLY with the registered binding of the NEW Piggy and that Piggy's live signer; its real transfer receipt is what flips the label to value_transferred", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);
  const binding20 = buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 20 });
  const giftId = "gift-9d-submit";
  const { record, url, token } = await makeLink({ giftId, value: binding20.value });
  const seen = [];
  const submitter = {
    async submit(args) {
      seen.push({ isBinding: isGiftBinding(args.binding), recipient: args.binding.recipientAddress, signer: args.account?.address, token: args.token, recordStatus: args.record.status });
      const attached = attachTransferReceipt(args.record, { txHash: `0x${"ab".repeat(32)}`, blockNumber: 7, status: "success" });
      return { status: "value_transferred", record: attached.record, txHashes: { claim: `0x${"ab".repeat(32)}` } };
    },
  };
  const app = openApp(storage, { href: url, address: first, giftRecordSource: memoryRecordSource({ [giftId]: record }), giftSubmitter: submitter });
  app.setRequestPrf(requestPrfWith(client));
  const out = await app.beginGiftPiggy();
  assert.equal(out.started, true);
  assert.equal(seen.length, 1);
  const newAddr = out.piggyId.replace(/^piggy-/, "");
  assert.equal(seen[0].isBinding, true);
  assert.equal(seen[0].recipient.toLowerCase(), newAddr);
  assert.equal(seen[0].signer.toLowerCase(), newAddr);
  assert.notEqual(newAddr, first.toLowerCase());
  assert.equal(seen[0].token, token);
  assert.equal(seen[0].recordStatus, CLAIM_STATUS.CLAIMED);
  const settlement = app.getLastGiftClaimSettlement();
  assert.equal(settlement.valueLabel, GIFT_VALUE_LABEL.VALUE_TRANSFERRED);
  assert.equal(settlement.valueSubmission.status, "value_transferred");
  assert.equal(JSON.stringify(plain(settlement)).includes(token), false);
  // checkPiggy / beginAddPiggy never reach the submitter
  const app2 = openApp(storage, { href: url, address: first, secondJourneyCompletedOnce: true, giftRecordSource: memoryRecordSource({ [giftId]: record }), giftSubmitter: submitter });
  app2.setRequestPrf(requestPrfWith(client));
  await app2.checkPiggy();
  await app2.beginAddPiggy();
  assert.equal(seen.length, 1);
});

// ═══ 10. A-560: a USDC-value-bound gift settles through the real product entry, never faking
//        a transfer that never happened ════════════════════════════════════════════════════
let claimedRecordFromTest10;
await check("10. a USDC-value-bound gift (preset 20) settles with the record's own amount/asset, labeled value_pending (no real transfer receipt exists in this slice) — never value_transferred", async () => {
  const storage = createMemoryStorage();
  const secret = crypto.randomBytes(32);
  const client = fakeClient(secret);
  const recipientAddress10 = await seedFirstPiggy(storage, client);

  const binding = buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 20 });
  assert.equal(binding.error, null, JSON.stringify(binding));
  const giftId10 = "gift-10-value-20";
  const { record, url, token } = await makeLink({ giftId: giftId10, value: binding.value });
  const recordSource10 = memoryRecordSource({ [giftId10]: record });

  // Recipient sees only the authoritative amount/asset from the record — never anything the
  // URL/UI could have invented — before ever authenticating.
  const opened = await beginGiftClaim({
    pending: { status: GIFT_ENTRY_STATUS.READY, giftId: giftId10, token },
    recordSource: recordSource10,
    now: new Date().toISOString(),
  });
  assert.equal(opened.status, GIFT_ENTRY_STATUS.READY, JSON.stringify(opened));
  assert.deepEqual(plain(opened.record.value), {
    tokenAddress: binding.value.tokenAddress, decimals: 6, amountAtomic: 20_000000,
  });

  // [A-579 Lane G] received into a NEW Gift Piggy (beginGiftPiggy), not the recovered first Piggy.
  const app = openApp(storage, { href: url, address: recipientAddress10, giftRecordSource: recordSource10 });
  app.setRequestPrf(requestPrfWith(client));
  const out = await app.beginGiftPiggy();
  assert.equal(out.started, true);

  const settlement = app.getLastGiftClaimSettlement();
  assert.equal(settlement.result, CLAIM_RESULT.OK, JSON.stringify(settlement));
  assert.equal(settlement.record.value.amountAtomic, 20_000000);
  const parties = plain(settlement.claimParties);
  assert.equal(parties.recipientAddress.toLowerCase(), out.piggyId.replace(/^piggy-/, ""));
  assert.notEqual(parties.recipientAddress.toLowerCase(), recipientAddress10.toLowerCase());
  assert.equal(settlement.valueSubmission.status, "claim_transport_unavailable");
  // No on-chain/local escrow was ever touched in this slice — the app must say pending, never
  // fake a transfer that didn't happen.
  assert.equal(settlement.valueLabel, GIFT_VALUE_LABEL.VALUE_PENDING, JSON.stringify(settlement));
  claimedRecordFromTest10 = settlement.record;
});

await check("10b. a legacy identity-only gift (no value bound) is still labeled legacy_identity_only, never funded", async () => {
  assert.equal(giftValueLabel(claimedRecordFromTest4), GIFT_VALUE_LABEL.LEGACY_IDENTITY_ONLY);
});

// ═══ 11. A-560: amount/asset tampering fails closed through the real product entry path ════
await check("11. amount tampering through the real product path: settleGiftClaim always rebuilds the signed statement from the record's OWN bound value, never the caller's — a 20 gift cannot become 50", async () => {
  const secret = crypto.randomBytes(32);
  const client = fakeClient(secret);
  const recipientPrf = (await requestPrfWith(client)(null, {})).prfOutput;
  const recipientAddress = addressOf(recipientPrf);
  const recipientAccount = toViemAccount(createSecp256k1SigningSession({ privateKey: recipientPrf }));

  const binding20 = buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 20 });
  const giftId = "gift-11-tamper";
  const { record, token } = await makeLink({ giftId, value: binding20.value });
  const claimedAt = "2026-09-24T10:00:00.000Z";
  // The recipient is shown/signs a TAMPERED statement claiming 50 USDC instead of the record's
  // true 20 USDC (simulating a compromised/buggy caller trying to mutate the displayed amount).
  const tamperedStatement = claimStatement({
    giftId: record.giftId, chainId: record.chainId, senderAddress: record.senderAddress,
    recipientAddress, claimTokenHash: record.claimTokenHash, claimedAt,
    tokenAddress: binding20.value.tokenAddress, decimals: 6, amountAtomic: 50_000000,
  });
  const signature = await recipientAccount.signMessage({ message: tamperedStatement });

  const settled = await settleGiftClaim({
    record, token, recipientAddress, signature,
    recover: ({ message, signature: sig }) => recoverMessageAddress({ message, signature: sig }),
    claimedAt,
  });
  assert.equal(settled.result, CLAIM_RESULT.NOT_PROVEN_BY_SIGNATURE, JSON.stringify(settled));
  assert.equal(settled.record.status, CLAIM_STATUS.UNCLAIMED);
});

await check("11b. token/asset tampering (correct amount, wrong token address) is rejected the same way", async () => {
  const secret = crypto.randomBytes(32);
  const client = fakeClient(secret);
  const recipientPrf = (await requestPrfWith(client)(null, {})).prfOutput;
  const recipientAddress = addressOf(recipientPrf);
  const recipientAccount = toViemAccount(createSecp256k1SigningSession({ privateKey: recipientPrf }));

  const binding20 = buildGiftValueBinding({ chainScope: CHAIN, presetLabel: 20 });
  const giftId = "gift-11b-tamper-token";
  const { record, token } = await makeLink({ giftId, value: binding20.value });
  const claimedAt = "2026-09-24T10:05:00.000Z";
  const wrongToken = `0x${"1".repeat(40)}`;
  const tamperedStatement = claimStatement({
    giftId: record.giftId, chainId: record.chainId, senderAddress: record.senderAddress,
    recipientAddress, claimTokenHash: record.claimTokenHash, claimedAt,
    tokenAddress: wrongToken, decimals: 6, amountAtomic: 20_000000,
  });
  const signature = await recipientAccount.signMessage({ message: tamperedStatement });
  const settled = await settleGiftClaim({
    record, token, recipientAddress, signature,
    recover: ({ message, signature: sig }) => recoverMessageAddress({ message, signature: sig }),
    claimedAt,
  });
  assert.equal(settled.result, CLAIM_RESULT.NOT_PROVEN_BY_SIGNATURE, JSON.stringify(settled));
});

// ═══ 7i. [A-711] issuance authority through the REAL main.js wiring (injected fake registry; product default stays null) ════
// Injection is by this file's copy of `const ISSUANCE_AUTHORITY = null;` only (see RAW_ADD_SRC). No network, no address from
// anywhere but this test. The fake mirrors IssuanceRegistry: write-once map + one Registered log per successful register.
const ISS_REGISTRY = `0x${"c0".repeat(20)}`;
function fakeIssuanceAuthority({ preflight = "ok", takenAddresses = [], onRegister = null } = {}) {
  const reg = new Map(takenAddresses.map((a) => [a.toLowerCase(), PLUS_PURPOSE]));
  let n = 0;
  const calls = { preflight: 0, isIssued: 0, register: [] };
  return {
    reg, calls,
    interfaceVersion: ISSUANCE_AUTHORITY_INTERFACE_VERSION,
    chainScope: CHAIN,
    registryAddress: ISS_REGISTRY,
    async preflight() { calls.preflight += 1; if (preflight === "throw") throw new Error("down"); return { ok: true, registryAddress: ISS_REGISTRY }; },
    async isIssued(address) { calls.isIssued += 1; return reg.has(address.toLowerCase()); },
    async register({ address, purpose, sequence, chainScope }) {
      calls.register.push({ address, purpose, sequence, chainScope });
      if (onRegister) await onRegister({ address, purpose });
      const tx = `0x${(++n).toString(16).padStart(64, "0")}`;
      if (reg.has(address.toLowerCase())) return { outcome: "submitted", txHash: tx, receipt: { transactionHash: tx, status: 0, finalized: true, logs: [] } };
      reg.set(address.toLowerCase(), purpose);
      return { outcome: "submitted", txHash: tx, receipt: { transactionHash: tx, status: 1, finalized: true, logs: [{ address: ISS_REGISTRY, topics: [REGISTERED_TOPIC0, `0x${"0".repeat(24)}${address.toLowerCase().slice(2)}`, purpose] }] } };
    },
  };
}
const ISS_GIFT_ID = `0x${"9a".repeat(32)}`;
async function issuanceGiftSetup(tag, authorityOptions) {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);
  const giftId = tag === "bytes32" ? ISS_GIFT_ID : `0x${crypto.randomBytes(32).toString("hex")}`;
  const { record, url, token } = await makeLink({ giftId });
  const recordSource = memoryRecordSource({ [giftId]: record });
  const authority = fakeIssuanceAuthority(authorityOptions);
  const app = openApp(storage, { href: url, address: first, giftRecordSource: recordSource, issuanceAuthority: authority });
  return { storage, client, first, giftId, record, token, recordSource, authority, app };
}

await check("7f. [A-711] product default null authority on testnet: beginGiftPiggy / beginAddPiggy are the unchanged A-695 flow (the new seam is inert)", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);
  const app = openApp(storage, { href: `${ORIGIN}/`, address: first, secondJourneyCompletedOnce: true });
  app.setRequestPrf(requestPrfWith(client));
  const out = await app.beginAddPiggy();
  assert.equal(out.started, true, JSON.stringify(out));
  assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.piggies.length, 2);
});

await check("7g. [A-711] Gift Piggy with an authority: registers the giftId as purpose BEFORE the row exists, commits only after, then the claim settles", async () => {
  const seenAtRegister = [];
  const ctxHolder = {};
  const setup = await issuanceGiftSetup("bytes32", { onRegister: async () => { seenAtRegister.push(loadMyPiggiesIndex(ctxHolder.storage, CHAIN).index.piggies.length); } });
  ctxHolder.storage = setup.storage;
  setup.app.setRequestPrf(requestPrfWith(setup.client));
  const out = await setup.app.beginGiftPiggy();
  assert.equal(out.started, true, JSON.stringify(out));
  assert.equal(out.giftAttempted, true);
  assert.deepEqual(seenAtRegister, [1], "at registration time the local index still has only the first Piggy");
  assert.equal(setup.authority.calls.register.length, 1);
  assert.equal(setup.authority.calls.register[0].purpose, ISS_GIFT_ID, "Gift purpose = giftId");
  assert.equal(setup.authority.calls.register[0].sequence, 1);
  assert.equal(loadMyPiggiesIndex(setup.storage, CHAIN).index.piggies.length, 2);
  assert.equal(setup.app.getLastGiftClaimSettlement().result, CLAIM_RESULT.OK);
  assert.equal(setup.app.getPendingGiftClaim(), null);
});

await check("7h. [A-711] Gift refused by the authority (unreachable / already registered): started:false, pending Gift preserved, no row, no settlement; unreachable = 0 requestPrf", async () => {
  // unreachable preflight -> refused before the passkey prompt
  const a = await issuanceGiftSetup("rand", { preflight: "throw" });
  let prfCalls = 0;
  a.app.setRequestPrf(async (c, o) => { prfCalls += 1; return requestPrfWith(a.client)(c, o); });
  const outA = await a.app.beginGiftPiggy();
  assert.deepEqual({ started: outA.started, reason: outA.reason }, { started: false, reason: ISSUANCE_REFUSAL.UNREACHABLE });
  assert.equal(prfCalls, 0);
  assert.equal(a.app.getPendingGiftClaim()?.token, a.token);
  assert.equal(a.app.getLastGiftClaimSettlement(), null);
  assert.equal(loadMyPiggiesIndex(a.storage, CHAIN).index.piggies.length, 1);
  // n=1's address already registered (e.g. a crash survivor) -> never adopted; pending kept; n burned; the retry takes n=2
  const b = await issuanceGiftSetup("rand", {});
  b.app.setRequestPrf(requestPrfWith(b.client));
  const addr1 = addressOf((await requestPrfWith(b.client)(null, { prfSalt: await modelASalt(1) })).prfOutput);
  b.authority.reg.set(addr1.toLowerCase(), PLUS_PURPOSE);
  const outB = await b.app.beginGiftPiggy();
  assert.deepEqual({ started: outB.started, reason: outB.reason }, { started: false, reason: ISSUANCE_REFUSAL.SEQUENCE_REGISTERED });
  assert.equal(b.app.getPendingGiftClaim()?.token, b.token, "pending Gift intent preserved");
  assert.equal(b.authority.calls.register.length, 0);
  assert.equal(loadMyPiggiesIndex(b.storage, CHAIN).index.piggies.length, 1);
  assert.equal(loadMyPiggiesIndex(b.storage, CHAIN).index.issuedThrough, 1);
  const retry = await b.app.beginGiftPiggy();
  assert.equal(retry.started, true, JSON.stringify(retry));
  assert.equal(b.authority.calls.register[0].sequence, 2);
  assert.notEqual(b.authority.calls.register[0].address.toLowerCase(), addr1.toLowerCase());
});

await check("7i. [A-711] plain +Piggy with an authority registers keccak256('plus') and never touches the pending Gift", async () => {
  const setup = await issuanceGiftSetup("rand", {});
  setup.app.state.secondJourneyCompletedOnce = true;
  setup.app.setRequestPrf(requestPrfWith(setup.client));
  const out = await setup.app.beginAddPiggy();
  assert.equal(out.started, true, JSON.stringify(out));
  assert.equal(setup.authority.calls.register.length, 1);
  assert.equal(setup.authority.calls.register[0].purpose, PLUS_PURPOSE);
  assert.equal(setup.app.getPendingGiftClaim()?.token, setup.token, "a plain +Piggy never takes the Gift");
});

await check("7j. [A-711] profile gate through the REAL main.js wiring: mainnet scope + the shipped null authority -> Gift Piggy and +Piggy refused BEFORE the passkey prompt, zero storage writes, pending Gift preserved; the same device data on testnet scope issues (A-695 path)", async () => {
  const LIVE = "monad-mainnet";
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client, { chain: LIVE });
  const giftId = `0x${crypto.randomBytes(32).toString("hex")}`;
  const { record, url, token } = await makeLink({ giftId });
  const recordSource = memoryRecordSource({ [giftId]: record });
  const app = openApp(storage, { href: url, address: first, giftRecordSource: recordSource, chainId: LIVE });   // issuanceAuthority: product default null
  let prfCalls = 0;
  app.setRequestPrf(async (c, o) => { prfCalls += 1; return requestPrfWith(client)(c, o); });
  const before = JSON.stringify(storage.dump());
  const gift = await app.beginGiftPiggy();
  assert.deepEqual({ started: gift.started, reason: gift.reason }, { started: false, reason: ISSUANCE_REFUSAL.UNCONFIGURED });
  assert.equal(prfCalls, 0, "no passkey prompt");
  assert.equal(JSON.stringify(storage.dump()), before, "zero storage writes");
  assert.equal(app.getPendingGiftClaim()?.token, token, "pending Gift intent preserved");
  assert.equal(app.getLastGiftClaimSettlement(), null);
  assert.deepEqual(plain(app.state.addPiggy), { status: "failed", reason: ISSUANCE_REFUSAL.UNCONFIGURED });
  app.state.secondJourneyCompletedOnce = true;
  const plus = await app.beginAddPiggy();
  assert.deepEqual({ started: plus.started, reason: plus.reason }, { started: false, reason: ISSUANCE_REFUSAL.UNCONFIGURED });
  assert.equal(prfCalls, 0);
  assert.equal(JSON.stringify(storage.dump()), before);
  assert.equal(loadMyPiggiesIndex(storage, LIVE).index.issuedThrough, 0);
  // contrast: the identical seed on the testnet scope with the same null authority issues n=1 (no authority dependency)
  const tStorage = createMemoryStorage();
  const tFirst = await seedFirstPiggy(tStorage, client);
  const tApp = openApp(tStorage, { href: `${ORIGIN}/`, address: tFirst, secondJourneyCompletedOnce: true });
  tApp.setRequestPrf(requestPrfWith(client));
  const tOut = await tApp.beginAddPiggy();
  assert.equal(tOut.started, true, JSON.stringify(tOut));
  assert.equal(loadMyPiggiesIndex(tStorage, CHAIN).index.issuedThrough, 1);
});

// ═══ 12. [A-734] the Gift Open UI entry → the REAL beginGiftPiggy ════════════════════════════
// Named reason for touching this file: A-734 gives beginGiftPiggy its first UI entry (the "a Piggy came for you." Open
// tap → startGiftOpen → openGiftForExistingPiggy). Only this harness has the record-source seam needed to prove that the
// entry reaches a NEW Gift Piggy + claim preparation (a734-gift-open-entry.mjs proves routing/markup/A-726 over stubs).
await check("12a. [A-734] existing-Piggy device: boot offers the 'came' paper; the Open entry (startGiftOpen) runs the REAL beginGiftPiggy → exactly one assertion, 0 creations, a NEW Gift Piggy bound + claim settled to it (never the existing Piggy) → that Piggy's Name it", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);
  const giftId = "gift-12a-entry";
  const { record, url, token } = await makeLink({ giftId });
  const recordSource = memoryRecordSource({ [giftId]: record });
  const app = openApp(storage, { href: url, address: first, giftRecordSource: recordSource });
  app.state.scene = "sendstay";
  assert.equal(app.offerGiftPaperAtBoot(), true);
  assert.equal(app.state.scene, "received");
  assert.equal(app.giftPaperKind(), "came");
  let prfCalls = 0;
  app.setRequestPrf(async (c, o) => { prfCalls += 1; return requestPrfWith(client)(c, o); });
  const out = await app.startGiftOpen();
  assert.equal(out.started, true, JSON.stringify(out));
  assert.equal(out.giftAttempted, true);
  assert.equal(prfCalls, 1);
  assert.equal(client.calls.create, 0);
  const settlement = app.getLastGiftClaimSettlement();
  assert.equal(settlement.result, CLAIM_RESULT.OK, JSON.stringify(settlement));
  assert.notEqual(settlement.claimParties.recipientAddress.toLowerCase(), first.toLowerCase(), "never the existing Piggy");
  assert.equal(out.piggyId, `piggy-${settlement.claimParties.recipientAddress.toLowerCase()}`);
  assert.deepEqual(plain(settlement.valueSubmission), { status: "claim_transport_unavailable" }, "live submit still null → value never faked");
  assert.deepEqual(app.calls.setScene.at(-1), ["name", "", ""]);
  assert.equal(app.giftPaperKind(), null);
  assert.equal(app.getPendingGiftClaim(), null);
  assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.piggies.length, 2);
  assert.equal(JSON.stringify(storage.dump()).includes(token), false);
});
await check("12b. [A-734] product default (no record source): the same Open entry stops at record_source_unavailable BEFORE auth → Home ('Piggy is home.'), 0 assertions, 0 new Piggies, intent kept in memory only", async () => {
  const storage = createMemoryStorage();
  const client = fakeClient(crypto.randomBytes(32));
  const first = await seedFirstPiggy(storage, client);
  const { url, token } = await makeLink({ giftId: "gift-12b-default" });
  const app = openApp(storage, { href: url, address: first });
  app.state.scene = "sendstay";
  app.offerGiftPaperAtBoot();
  let prfCalls = 0;
  app.setRequestPrf(async (c, o) => { prfCalls += 1; return requestPrfWith(client)(c, o); });
  const before = JSON.stringify(storage.dump());
  const out = await app.startGiftOpen();
  assert.equal(out.started, false);
  assert.equal(app.getLastGiftClaimSettlement().status, GIFT_ENTRY_STATUS.RECORD_SOURCE_UNAVAILABLE);
  assert.equal(prfCalls, 0);
  assert.deepEqual(app.calls.setScene.at(-1), ["sendstay", "Piggy is home.", ""]);
  assert.equal(app.giftPaperKind(), null);
  assert.equal(app.getPendingGiftClaim()?.token, token);
  assert.equal(JSON.stringify(storage.dump()), before, "zero storage writes");
});

// ═══ no raw secret anywhere (card TESTS item 9) ════════════════════════════════════════════
await check("no raw claim token / PRF / private key ever appears in storage or in the settled record", () => {
  const storageDump = JSON.stringify(sharedStorage.dump());
  const settledRecordDump = JSON.stringify(plain(claimedRecordFromTest4));
  const valueRecordDump = JSON.stringify(plain(claimedRecordFromTest10));
  for (const h of [storageDump, settledRecordDump, valueRecordDump]) {
    assert.equal(h.includes(tokenMain), false, "raw claim token leaked");
    assert.equal(/privateKey|prfOutput|mnemonic|seed/i.test(h), false, "secret-shaped field name leaked");
  }
});

console.log("NOTE  item 10 (real reload preserving only the approved non-secret pending-claim state) needs a real browser/CDP reload — sandboxed Chrome is EPERM here (see multi-piggy-browser-reopen.mjs's own note); not run, not faked.");

console.log(`\n${pass}/${pass} PASS`);
