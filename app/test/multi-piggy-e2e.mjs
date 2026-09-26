// [multi-piggy-e2e] One local, in-memory, end-to-end pass through the whole multi-Piggy stack:
//   my-piggies index (piggy-index.js) → Gate C selection/signer rules (piggy-session.js) →
//   permission envelope (permission-envelope.js).
//   node app/test/multi-piggy-e2e.mjs
//
// No network, no DOM, no existing file edited. One deterministic fake WebAuthn credential
// driving the real Mera path (getPasskeyPrfOutput → createSecp256k1SigningSession → getEvmAddress),
// exactly the harness pattern used by model-a-add-piggy.mjs and gate-c-signer.mjs.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress, MeraError } from "@category-labs/mera";
import {
  authRequestForPiggy, bindSigner, selectionContext, switchSelection,
} from "../src/piggy-session.js";
import { admitModelAPiggy, loadMyPiggiesIndex, myPiggiesIndexKey, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { authorize, consume, issuePermission, permissionNonce } from "../src/permission-envelope.js";
import { createMemoryStorage } from "../src/second-journey-state.js";

const CHAIN = "monad-testnet";
const AT = "2026-09-22T12:00:00.000Z";
const RP = "araso-e2e.local.test";
const DEST = "0x00000000000000000000000000000000000000a1";
const ROOT_ID_BYTES = new Uint8Array(Buffer.from("multi-piggy-root"));
const ROOT_ID = Buffer.from(ROOT_ID_BYTES).toString("base64url");
const ROOT = { credentialId: ROOT_ID };

// ── one deterministic fake credential: PRF = HMAC(secret, salt) ────────────────────────────
const secret = crypto.randomBytes(32);
function fakeClient({ fail = false } = {}) {
  return {
    async createCredential() { throw new Error("createCredential must never be called for + Piggy"); },
    async getCredential(req) {
      if (fail) throw new Error("NotAllowedError: user cancelled");
      return { credentialId: ROOT_ID_BYTES, prfOutput: new Uint8Array(crypto.createHmac("sha256", secret).update(Buffer.from(req.prfSalt)).digest()) };
    },
  };
}
const addressOf = (prf) => getEvmAddress(createSecp256k1SigningSession({ privateKey: prf }).publicKey);
const requestPrfWith = (client) => (credential, prfSalt) => getPasskeyPrfOutput({ rpId: RP, credential, prfSalt, webAuthnClient: client });

// direct serialization test-double, structurally FIFO like the real Web Locks API
function fifoLocks() {
  const tails = new Map();
  return {
    request(name, _opts, fn) {
      const prev = tails.get(name) || Promise.resolve();
      const run = prev.then(() => fn());
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}
const locks = globalThis.navigator?.locks || fifoLocks();

async function seedFirstPiggy(storage) {
  const prf = (await getPasskeyPrfOutput({ rpId: RP, webAuthnClient: fakeClient() })).prfOutput;
  const address = addressOf(prf);
  const out = registerControlledPiggy(storage, CHAIN, {
    id: `legacy-${address.toLowerCase()}`, name: "Honeybun", address, signerAddress: address,
    locator: { credentialId: ROOT_ID }, at: AT,
  });
  assert.equal(out.ok, true);
  return address;
}

const admit = (storage) => admitModelAPiggy({
  storage, chainId: CHAIN, locks, rootCredential: ROOT, requestPrf: requestPrfWith(fakeClient()), deriveAddress: addressOf, now: () => AT,
});

const reqFor = (piggyId, signerAddress) => ({ piggyId, signerAddress, action: "send_money", asset: "USDC", amount: "2.5", chain: CHAIN, destination: DEST });
function issueFor(piggyId, signerAddress, nowMs) {
  const intent = { piggyId, signerAddress, action: "send_money", asset: "USDC", amount: "2.5", chain: CHAIN, destination: DEST, destinationRequired: true };
  const auth = { method: "passkey", verified: true, verifiedAt: nowMs - 1000, credentialId: ROOT_ID };
  return issuePermission({ intent, auth, nonce: permissionNonce({ ...intent, at: String(nowMs) }), nowMs }).envelope;
}

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

const storage = createMemoryStorage();

// ── 1. first Piggy: default salt, no sequence ───────────────────────────────────────────
let firstAddress;
await check("1. first Piggy is indexed with the default salt and no sequence field", async () => {
  firstAddress = await seedFirstPiggy(storage);
  const { index } = loadMyPiggiesIndex(storage, CHAIN);
  assert.equal(index.piggies.length, 1);
  assert.equal("sequence" in index.piggies[0], false);
  assert.equal(index.issuedThrough, 0);
});

// ── 2. add Piggy #2 and #3 via admitModelAPiggy ─────────────────────────────────────────
let piggy2, piggy3;
await check("2. adding Piggy #2 and #3 yields distinct addresses, sequences 1 and 2, an advancing watermark, and rows that survive a fresh reload", async () => {
  const out2 = await admit(storage);
  assert.equal(out2.ok, true);
  piggy2 = out2.piggy;
  assert.equal(piggy2.sequence, 1);
  assert.notEqual(piggy2.address, firstAddress);
  assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.issuedThrough, 1);

  const out3 = await admit(storage);
  assert.equal(out3.ok, true);
  piggy3 = out3.piggy;
  assert.equal(piggy3.sequence, 2);
  assert.notEqual(piggy3.address, firstAddress);
  assert.notEqual(piggy3.address, piggy2.address);
  assert.equal(loadMyPiggiesIndex(storage, CHAIN).index.issuedThrough, 2);

  // simulated reload: fresh loadMyPiggiesIndex call against the same storage
  const reloaded = loadMyPiggiesIndex(storage, CHAIN).index;
  assert.equal(reloaded.piggies.length, 3);
  assert.deepEqual(reloaded.piggies.filter((p) => p.sequence).map((p) => p.sequence), [1, 2]);
  assert.equal(reloaded.piggies.find((p) => p.id === piggy2.id).address, piggy2.address);
  assert.equal(reloaded.piggies.find((p) => p.id === piggy3.id).address, piggy3.address);
});

// ── 3. rename #2, reload, name persists ─────────────────────────────────────────────────
await check("3. renaming Piggy #2 persists across a fresh reload", () => {
  const out = renameIndexedPiggy(storage, CHAIN, { id: piggy2.id, name: "Mochi" });
  assert.equal(out.ok, true);
  const reloaded = loadMyPiggiesIndex(storage, CHAIN).index;
  assert.equal(reloaded.piggies.find((p) => p.id === piggy2.id).name, "Mochi");
  assert.equal(reloaded.piggies.find((p) => p.id === piggy3.id).sequence, 2); // untouched neighbor
});

// ── 4. select #2 → salt-bound derive → bindSigner → issue → authorize → consume → replay rejected ──
let sel2, signer2, env2Used;
await check("4. selecting Piggy #2 authenticates with its own salt, binds, authorizes once, and rejects replay", async () => {
  sel2 = switchSelection(null, piggy2).selection;
  assert.deepEqual({ ...sel2 }, { id: piggy2.id, address: piggy2.address });

  const { request, error } = authRequestForPiggy(piggy2);
  assert.equal(error, null);
  assert.equal(request.credential.credentialId, ROOT_ID);
  assert.equal(bytesHex(request.prfSalt), piggy2.locator.prfSalt);

  const result = await requestPrfWith(fakeClient())(request.credential, request.prfSalt);
  const derived = addressOf(result.prfOutput);
  assert.equal(derived, piggy2.address);

  const bound = bindSigner(sel2, derived);
  assert.equal(bound.ok, true);
  signer2 = bound.signerAddress;

  const NOW = 1_800_000_000_000;
  env2Used = issueFor(piggy2.id, signer2, NOW);
  const ctx2 = selectionContext(sel2, signer2);
  const first = authorize(env2Used, reqFor(piggy2.id, signer2), { nowMs: NOW, context: ctx2 });
  assert.equal(first.ok, true);

  const consumedNonces = new Set();
  consume(env2Used, consumedNonces);
  const replay = authorize(env2Used, reqFor(piggy2.id, signer2), { nowMs: NOW, consumedNonces, context: ctx2 });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "permission_already_used");
});

// ── 5. switch to #3 while holding an unused #2 envelope → invalidate + revoke ──────────────
await check("5. switching selection to Piggy #3 while holding an unused Piggy #2 envelope invalidates it, and it cannot be authorized under the new context", async () => {
  const NOW = 1_800_000_100_000;
  const heldEnv = issueFor(piggy2.id, signer2, NOW); // fresh, never consumed
  const consumedNonces = new Set();

  const switched = switchSelection(sel2, piggy3, { heldEnvelope: heldEnv });
  assert.equal(switched.invalidate, true);
  assert.equal(switched.revokeNonce, heldEnv.nonce);
  if (switched.revokeNonce) consumedNonces.add(switched.revokeNonce);

  const { request } = authRequestForPiggy(piggy3);
  const result = await requestPrfWith(fakeClient())(request.credential, request.prfSalt);
  const signer3 = addressOf(result.prfOutput);
  assert.equal(signer3, piggy3.address);
  const bound3 = bindSigner(switched.selection, signer3);
  assert.equal(bound3.ok, true);

  const ctx3 = selectionContext(switched.selection, signer3);
  const out = authorize(heldEnv, reqFor(piggy2.id, signer2), { nowMs: NOW, consumedNonces, context: ctx3 });
  assert.equal(out.ok, false); // revoked nonce and/or selected-Piggy mismatch — either way, closed
});

// ── 6. signer mismatch: derive with #3's salt while #2 is selected ─────────────────────────
await check("6. deriving an address with Piggy #3's salt while Piggy #2 is the live selection is refused as signer_mismatch", async () => {
  const { request } = authRequestForPiggy(piggy3);
  const result = await requestPrfWith(fakeClient())(request.credential, request.prfSalt);
  const derivedFor3 = addressOf(result.prfOutput);
  assert.equal(derivedFor3, piggy3.address);
  const out = bindSigner(sel2, derivedFor3); // sel2 is still Piggy #2's selection
  assert.equal(out.ok, false);
  assert.equal(out.reason, "signer_mismatch");
});

// ── 7. cancel mid-admission → no row, watermark unchanged ──────────────────────────────────
await check("7. a cancelled admission (NotAllowedError) leaves no row and does not advance the watermark", async () => {
  const before = loadMyPiggiesIndex(storage, CHAIN).index;
  const out = await admitModelAPiggy({
    storage, chainId: CHAIN, locks, rootCredential: ROOT, requestPrf: requestPrfWith(fakeClient({ fail: true })), deriveAddress: addressOf, now: () => AT,
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "auth_cancelled");
  const after = loadMyPiggiesIndex(storage, CHAIN).index;
  assert.equal(after.issuedThrough, before.issuedThrough);
  assert.equal(after.piggies.length, before.piggies.length);
  assert.deepEqual(after.piggies.map((p) => p.id).sort(), before.piggies.map((p) => p.id).sort());
});

function bytesHex(bytes) {
  return bytes ? [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("") : null;
}

console.log(`\n${pass}/${pass} PASS`);
