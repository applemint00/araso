// [A-558 Lane B] Direct behavioral coverage of the ACTUAL main.js `proveFundingTargetControl` —
// the one real function that produces the `controlProof` `beginFundingForPiggy`/
// `verifyFundingTargetProof` require (residual noted in both A-555 and A-556 receipts: this
// helper had 0 direct test before this file). Technique (same as gate-c-signer.mjs:150-176 /
// funding-runtime-core.mjs's `fundingSigner`, A-048 lineage): the real function text is cut
// straight out of main.js and run in an isolated node:vm context, with a deterministic fake
// WebAuthn client + the real Mera SDK (getPasskeyPrfOutput/createSecp256k1SigningSession/
// getEvmAddress/toViemAccount) doing the actual signing. `getRpId`/`localTestWebAuthnOption` are
// the two browser/env-primitive readers `requestPrf` itself calls (window.location / import.meta
// feature flag) — those are stubbed as injected primitives, same as `isAllowedPiggyRpId` is
// stubbed in session-lifetime.mjs; `proveFundingTargetControl`'s own logic is never reimplemented.
// Network 0 · real device Face ID 0 · real tx 0.
//   node app/test/funding-target-control.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { recoverMessageAddress } from "viem";
import { getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { authRequestForPiggy, bindSigner, fundingTargetChallenge, verifyFundingTargetProof } from "../src/piggy-session.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function cut(startMarker, endMarker) {
  const start = MAIN.indexOf(startMarker);
  if (start < 0) throw new Error(`main.js 에서 못 찾음(시작): ${startMarker}`);
  const end = MAIN.indexOf(endMarker, start);
  if (end < 0) throw new Error(`main.js 에서 못 찾음(끝): ${endMarker}`);
  return MAIN.slice(start, end);
}

// Brace-matched cut for one standalone function — robust against a hand-picked end marker
// accidentally colliding with a nearby comment (this file cuts several small functions
// individually, unlike the one wide proven block session-lifetime.mjs cuts with plain markers).
function cutFn(startMarker) {
  const start = MAIN.indexOf(startMarker);
  if (start < 0) throw new Error(`main.js 에서 못 찾음: ${startMarker}`);
  // startMarker must end with the body-opening "{" itself — indexOf("{", start) is not safe
  // here (a destructuring default parameter like `{ prfSalt = null }` has its own "{" earlier
  // in the signature, which would be found first and wreck the brace count).
  const braceStart = start + startMarker.length - 1;
  if (MAIN[braceStart] !== "{") throw new Error(`시작 마커가 '{' 로 끝나야 함: ${startMarker}`);
  let depth = 0;
  let i = braceStart;
  for (; i < MAIN.length; i += 1) {
    const c = MAIN[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) { i += 1; break; }
    }
  }
  return MAIN.slice(start, i);
}

// Same two cuts session-lifetime.mjs already uses and proves for the A-556 timer functions —
// reused verbatim rather than re-derived.
const SESSION_DECLS_SRC = cut("let activeSession = null;", "function readCredential()");
const SESSION_TIMERS_SRC = cut("function endSignerSession() {", "// --- 씬 정리 (A-292 번호 9)");
const TOHEX_SRC = cutFn("function toHex(bytes) {");
const REQUEST_PRF_SRC = cutFn("function requestPrf(credential, { prfSalt = null } = {}) {");
const SCOPE_SRC = cutFn("function secondJourneyScope() {");
const PROVE_SRC = cutFn("async function proveFundingTargetControl(piggy) {");

for (const [name, src] of [
  ["endSignerSession", SESSION_TIMERS_SRC], ["endActiveSession", SESSION_TIMERS_SRC],
  ["touchAppSession", SESSION_TIMERS_SRC], ["armSignerExpiry", SESSION_TIMERS_SRC],
  ["activateSigningSession", SESSION_TIMERS_SRC],
  ["toHex", TOHEX_SRC], ["requestPrf", REQUEST_PRF_SRC], ["secondJourneyScope", SCOPE_SRC],
  ["proveFundingTargetControl", PROVE_SRC],
]) {
  if (!src.includes(`function ${name}`) && !src.includes(`async function ${name}`)) {
    throw new Error(`잘라낸 구간에 ${name} 없음 — 마커가 main.js 구조와 어긋남`);
  }
}

// ── [A-558 item 2/6] the slice itself proves the two source-level requirements before any
// behavioral test runs: a bindSigner pre-check exists before signing, and the finally tears down
// the signer only (endSignerSession), not the whole app session (endActiveSession would also
// clear the 10m app-idle timer — the thing this card says a funding-target proof must not do). ──
assert.match(PROVE_SRC, /const bound = bindSigner\(piggy, address\);/, "proveFundingTargetControl 에 bindSigner pre-check 없음");
assert.match(PROVE_SRC, /if \(!bound\.ok\) return \{ proof: null, error: bound\.reason \};/, "bindSigner 불일치가 서명 전에 fail-closed 하지 않음");
{
  // comment lines are stripped first — the rationale comments above this code intentionally
  // discuss/name `endActiveSession()` in prose, so a raw substring/regex check on the whole
  // block would false-positive on the comment text, not the actual call being made.
  const financallyBlock = PROVE_SRC.slice(PROVE_SRC.lastIndexOf("finally"))
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.match(financallyBlock, /endSignerSession\(\);/, "finally 가 endSignerSession() 을 부르지 않음");
  assert.equal(/endActiveSession\(\)/.test(financallyBlock), false, "finally 가 여전히 endActiveSession()(전체 teardown)을 부르면 A-558 item 6 위반");
}
// bindSigner runs strictly before the challenge is built/signed (textual order inside the try).
assert.ok(PROVE_SRC.indexOf("const bound = bindSigner") < PROVE_SRC.indexOf("fundingTargetChallenge("), "bindSigner 검사가 challenge/서명보다 먼저와야 한다");
// [A-558 item 7] still 0 product callers.
assert.equal((MAIN.match(/proveFundingTargetControl\(/g) || []).length, 1, "proveFundingTargetControl 은 자기 정의 하나뿐이어야 한다(제품 호출자 0, funding UI 는 여전히 WAIT_DESIGN_MERGE)");

// ── deterministic fake clock (no real timer ever fires — only records the requested delay) ──────
function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout: (fn, delayMs) => { const id = nextId += 1; timers.set(id, delayMs); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    pending: () => [...timers.values()].sort((a, b) => a - b),
  };
}

// ── deterministic fake WebAuthn — same shape as gate-c-signer.mjs's fakeWebAuthn /
// funding-runtime-core.mjs's fundingSigner: getCredential always receives a real 32-byte
// prfSalt (Mera's getPasskeyPrfOutput fills in its own default salt when none is given — see
// node_modules/@category-labs/mera/dist/passkey.js), and returns a deterministic prfOutput
// derived from {secret, label, salt} via HMAC — nothing about Mera's own signing/derivation is
// reimplemented, only the WebAuthn ceremony itself is faked. ────────────────────────────────────
function fakeWebAuthnClient(secret, label) {
  return {
    async createCredential() { throw new Error("not used"); },
    async getCredential(req) {
      const salt = req?.prfSalt;
      if (!(salt instanceof Uint8Array) || salt.length !== 32) throw new Error("prfSalt must be 32 bytes");
      return {
        credentialId: new Uint8Array(Buffer.from(label)),
        prfOutput: new Uint8Array(crypto.createHmac("sha256", secret).update(label).update(Buffer.from(salt)).digest()),
      };
    },
  };
}
function deriveAddress(secret, label, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  const prfOutput = new Uint8Array(crypto.createHmac("sha256", secret).update(label).update(salt).digest());
  return getEvmAddress(createSecp256k1SigningSession({ privateKey: prfOutput }).publicKey);
}
function locatorFor(label, saltHex) {
  return { credentialId: Buffer.from(label).toString("base64url"), prfSalt: saltHex };
}

// ── one vm app = one fresh module scope (fresh activeSession/activeAccount/timers), same
// close/reopen model the other session-lifetime-derived tests use. The injected WebAuthn client
// is swappable per call via setClient() so a single app instance can exercise several
// credential/salt/Piggy combinations exactly like a real running app would see them in sequence. ─
function openApp() {
  const state = { address: "" }; // secondJourneyScope() reads state.address only
  const localStorage = { setItem() {}, getItem() { return null; }, removeItem() {} };
  const timers = fakeTimers();
  let currentClient = null;
  const ctx = {
    state, console, Set, Map, Array, Object, Date, JSON, Promise, Uint8Array,
    crypto: globalThis.crypto,
    localStorage,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    // real Mera SDK — nothing here is reimplemented
    getPasskeyPrfOutput, createSecp256k1SigningSession, getEvmAddress, toViemAccount,
    // real piggy-session.js exports
    authRequestForPiggy, bindSigner, fundingTargetChallenge,
    // browser/env primitives requestPrf() itself reads — stubbed, not reimplemented logic
    getRpId: () => "araso-harness.local.test",
    localTestWebAuthnOption: () => (currentClient ? { webAuthnClient: currentClient } : {}),
  };
  vm.createContext(ctx);
  vm.runInContext(
    `${SESSION_DECLS_SRC}\n${SESSION_TIMERS_SRC}\n${TOHEX_SRC}\n${REQUEST_PRF_SRC}\n${SCOPE_SRC}\n${PROVE_SRC}\n` +
      `globalThis.__prove = proveFundingTargetControl;\n` +
      `globalThis.__get = () => ({ hasSigner: !!activeAccount, address: activeAccount ? activeAccount.address : null });`,
    ctx,
  );
  return {
    state, timers,
    get: ctx.__get,
    prove: ctx.__prove,
    setClient: (c) => { currentClient = c; },
  };
}

const recover = ({ message, signature }) => recoverMessageAddress({ message, signature });
const FIVE_MIN = 5 * 60 * 1000;
const TEN_MIN = 10 * 60 * 1000;

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

// ══ 1. genuine credential + matching salt + correct stored address → a real, verifiable proof ══
await check("1. genuine derive → proof verifies for real via piggy-session.js's own verifyFundingTargetProof", async () => {
  const secret = crypto.randomBytes(32);
  const salt = "11".repeat(32);
  const address = deriveAddress(secret, "honeybun", salt);
  const piggy = { id: "honeybun", address, locator: locatorFor("honeybun", salt) };
  const app = openApp();
  app.setClient(fakeWebAuthnClient(secret, "honeybun"));

  const out = await app.prove(piggy);
  assert.equal(out.error, null, `unexpected error: ${out.error}`);
  assert.equal(out.proof.address, address);
  assert.equal(out.proof.piggyId, "honeybun");
  assert.equal(out.proof.chainId, "monad-testnet");
  assert.equal(typeof out.proof.signature, "string");

  const verified = await verifyFundingTargetProof(out.proof, {
    piggy, chainId: "monad-testnet", recover, consumedNonces: new Set(),
  });
  assert.equal(verified.ok, true, "a genuinely-derived proof must pass the real downstream verifier");
});

// ══ item 6: teardown — signer cleared, app-idle timer survives ═══════════════════════════════
await check("6. after a successful proof, the temporary signer is gone but the app-idle timer is untouched (endSignerSession, not endActiveSession)", async () => {
  const secret = crypto.randomBytes(32);
  const salt = "33".repeat(32);
  const address = deriveAddress(secret, "mochi", salt);
  const piggy = { id: "mochi", address, locator: locatorFor("mochi", salt) };
  const app = openApp();
  app.setClient(fakeWebAuthnClient(secret, "mochi"));

  assert.deepEqual(app.timers.pending(), []);
  const out = await app.prove(piggy);
  assert.equal(out.error, null);
  assert.equal(app.get().hasSigner, false, "the temporary proof signer does not survive the call");
  assert.deepEqual(app.timers.pending(), [TEN_MIN], "exactly the 10m app-idle timer survives — the 5m signer-absolute timer was cleared with the signer, app-idle was NOT touched by teardown");
});

// ══ 2. wrong root credential — different underlying secret derives a different address ═════════
await check("2. wrong root credential (different secret, same label+salt) → helper fails closed before signing, no usable proof", async () => {
  const rightSecret = crypto.randomBytes(32);
  const wrongSecret = crypto.randomBytes(32);
  const salt = "44".repeat(32);
  const address = deriveAddress(rightSecret, "honeybun", salt); // the address on record for this Piggy
  const piggy = { id: "honeybun", address, locator: locatorFor("honeybun", salt) };
  const app = openApp();
  app.setClient(fakeWebAuthnClient(wrongSecret, "honeybun")); // a different root credential answers the ceremony

  const out = await app.prove(piggy);
  assert.equal(out.proof, null, "no usable proof — must not fall back to any ambient signer/address");
  assert.equal(out.error, "signer_mismatch");
  assert.equal(app.get().hasSigner, false, "the mismatched temporary signer is still torn down");
  assert.deepEqual(app.timers.pending(), [TEN_MIN], "activateSigningSession still ran (it derived a real, live, just-wrong signer) — app-idle survives, signer timer cleared, same as the success path");
});

// ══ 3. wrong salt — same root credential, but the locator's own salt derives a different key ═══
await check("3. wrong salt on the locator (stale/corrupted index row) → helper fails closed before signing", async () => {
  const secret = crypto.randomBytes(32);
  const saltOnRecord = "55".repeat(32);
  const saltAsked = "66".repeat(32); // what the (corrupted) locator actually asks for
  const address = deriveAddress(secret, "honeybun", saltOnRecord); // address was born under saltOnRecord
  const piggy = { id: "honeybun", address, locator: locatorFor("honeybun", saltAsked) }; // but locator now points at a different salt
  const app = openApp();
  app.setClient(fakeWebAuthnClient(secret, "honeybun"));

  const out = await app.prove(piggy);
  assert.equal(out.proof, null);
  assert.equal(out.error, "signer_mismatch");
  assert.equal(app.get().hasSigner, false);
});

// ══ 4. wrong Piggy — the local record's own address field simply doesn't match anything real ═══
await check("4. wrong Piggy (piggy.address ≠ what this credential/salt actually derives) → helper fails closed before signing", async () => {
  const secret = crypto.randomBytes(32);
  const salt = "77".repeat(32);
  const OTHER_ADDR = `0x${"0".repeat(38)}ab`;
  const piggy = { id: "honeybun", address: OTHER_ADDR, locator: locatorFor("honeybun", salt) };
  const app = openApp();
  app.setClient(fakeWebAuthnClient(secret, "honeybun"));

  const out = await app.prove(piggy);
  assert.equal(out.proof, null);
  assert.equal(out.error, "signer_mismatch");
  assert.equal(app.get().hasSigner, false);
});

// ══ 5b. a forged/tampered proof is still rejected by verifyFundingTargetProof independently ════
// (defense in depth: even if a genuine proof existed for one Piggy, it cannot be repointed at
// another by editing its fields after the fact — the signature no longer matches the recomputed
// challenge for the new target.)
await check("5b. a genuine proof, tampered to claim a different Piggy id, is rejected by the downstream verifier too", async () => {
  const secret = crypto.randomBytes(32);
  const salt = "88".repeat(32);
  const address = deriveAddress(secret, "honeybun", salt);
  const piggy = { id: "honeybun", address, locator: locatorFor("honeybun", salt) };
  const app = openApp();
  app.setClient(fakeWebAuthnClient(secret, "honeybun"));

  const out = await app.prove(piggy);
  assert.equal(out.error, null);
  const tampered = { ...out.proof, piggyId: "some-other-piggy" };
  const verified = await verifyFundingTargetProof(tampered, {
    piggy: { id: "some-other-piggy", address }, chainId: "monad-testnet", recover, consumedNonces: new Set(),
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, "funding_target_unproven");
});

// ══ item 4 — future-dated issuedAt is rejected, and rejection never consumes the nonce ══════════
// Built with a standalone real signer (same technique funding-runtime-core.mjs's fundingSigner
// uses for its own §11 proof tests) — this exercises verifyFundingTargetProof's own contract
// directly, independent of the helper, since the helper always stamps issuedAt = Date.now().
async function rawSigner(label) {
  const secret = crypto.randomBytes(32);
  const client = fakeWebAuthnClient(secret, label);
  const salt = crypto.randomBytes(32);
  const { prfOutput } = await getPasskeyPrfOutput({ rpId: "araso-harness.local.test", prfSalt: salt, webAuthnClient: client });
  const session = createSecp256k1SigningSession({ privateKey: prfOutput });
  const account = toViemAccount(session);
  const address = getEvmAddress(session.publicKey);
  return {
    address,
    async proveFor({ piggyId, chainId = "monad-testnet", issuedAt = Date.now(), nonce = crypto.randomBytes(8).toString("hex") }) {
      const { challenge, error } = fundingTargetChallenge({ chainId, piggyId, address, issuedAt, nonce });
      assert.equal(error, null, `fundingTargetChallenge error: ${error}`);
      const signature = await account.signMessage({ message: challenge });
      return { chainId, piggyId, address, issuedAt, nonce, signature };
    },
  };
}

await check("item4. issuedAt in the future → funding_target_unproven, nonce NOT consumed; the same nonce with a valid-time proof is then accepted exactly once", async () => {
  const signer = await rawSigner("future-issued-at");
  const piggy = { id: "p-future", address: signer.address };
  const consumed = new Set();

  const futureProof = await signer.proveFor({ piggyId: "p-future", issuedAt: Date.now() + 5 * 60 * 1000 });
  const rejected = await verifyFundingTargetProof(futureProof, { piggy, chainId: "monad-testnet", recover, consumedNonces: consumed });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "funding_target_unproven");
  assert.equal(consumed.has(futureProof.nonce), false, "a rejected (future-dated) proof must not consume its nonce");

  // same nonce, corrected (valid) issuedAt — must be re-signed, since issuedAt is inside the
  // signed challenge string; this proves the nonce alone was never the gate.
  const validProof = await signer.proveFor({ piggyId: "p-future", issuedAt: Date.now(), nonce: futureProof.nonce });
  const accepted = await verifyFundingTargetProof(validProof, { piggy, chainId: "monad-testnet", recover, consumedNonces: consumed });
  assert.equal(accepted.ok, true, "the untouched nonce is still available for a genuinely valid-time proof");
  assert.equal(consumed.has(futureProof.nonce), true);

  const replay = await verifyFundingTargetProof(validProof, { piggy, chainId: "monad-testnet", recover, consumedNonces: consumed });
  assert.equal(replay.ok, false, "the nonce is single-use once an actual accept happens");
});

console.log(`\n${pass}/${pass} PASS`);
