// [A-711 W1] Issuance-authority client gate. NETWORK 0 · REAL FACE ID 0 · NO LIVE AUTHORITY · fake in-memory registry only.
//   node app/test/a711-issuance-authority.mjs
//
// Proves (A-700 / A-708 client rules R0-R4, A-708 REVIEW M-2):
//   P  profile gate       testnet = no authority dependency; live scope requires one; main.js ships it null
//   R0 null / bad / unreachable / not-ready authority  -> refuse BEFORE requestPrf, zero local writes
//   R1 already-registered address is never adopted (same purpose too) -> n burned, no row
//   R2 success = OUR OWN finalized status-1 receipt with exactly one matching registry log; table of 16 refusals
//   C2 crash after registration / missing local commit -> next attempt skips n, never reuses it
//   B6/B7 whole-index rollback and forged local state never re-issue an address
//   RC recovery / restore stays ungated; Gift purpose = giftId, +Piggy purpose = keccak256("plus")
//   S  source pins: admitSequencedPiggy byte-identical, the issuance module touches no network
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { keccak256, toBytes, toEventSelector } from "viem";
import {
  ISSUANCE_REFUSAL, PLUS_PURPOSE, REGISTERED_TOPIC0, ISSUANCE_AUTHORITY_INTERFACE_VERSION,
  resolveIssuancePurpose, validateIssuanceAuthority, verifyOwnRegistration,
} from "../src/issuance-authority.js";
import { issuanceAuthorityRequiredForScope } from "../src/chain-profile.js";
import { admitIssuedPiggy, admitModelAPiggy, admitSequencedPiggy, loadMyPiggiesIndex, markBornPiggyIssuance, myPiggiesIndexKey, registerControlledPiggy } from "../src/piggy-index.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const INDEX_SRC = readFileSync(new URL("../src/piggy-index.js", import.meta.url), "utf8");
const AUTH_SRC = readFileSync(new URL("../src/issuance-authority.js", import.meta.url), "utf8");
const PROFILE_SRC = readFileSync(new URL("../src/chain-profile.js", import.meta.url), "utf8");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 8).join("\n      ")}`); fail += 1; }
}
function bodyOf(src, name) {
  const m = new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, "m").exec(src);
  if (!m) throw new Error(`function missing: ${name}`);
  let k = src.indexOf("(", m.index);
  for (let pd = 0; k < src.length; k += 1) { if (src[k] === "(") pd += 1; else if (src[k] === ")") { pd -= 1; if (pd === 0) break; } }
  let depth = 0;
  let inStr = null;
  for (let i = src.indexOf("{", k); i < src.length; i += 1) {
    const c = src[i];
    if (inStr) { if (c === "\\") { i += 1; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// ── constants ───────────────────────────────────────────────────────────────────────────────
const TESTNET = "monad-testnet";
const MAINNET = "monad-mainnet";
const REGISTRY = "0x" + "c0".repeat(20);                       // a FAKE pin for this test only — not a deployment
const OTHER_EMITTER = "0x" + "d1".repeat(20);
const GIFT_ID = "0x" + "9a".repeat(32);
const AT = "2026-10-03T00:00:00.000Z";
const ROOT = { credentialId: "ROOT", transports: ["internal"] };
const pad = (addr) => `0x${"0".repeat(24)}${addr.toLowerCase().slice(2)}`;

// ── fake device ──────────────────────────────────────────────────────────────────────────────
function memStorage(events = []) {
  const m = new Map();
  const s = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (s.failWrites) throw new Error("storage write failed (simulated crash)"); events.push("write"); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    failWrites: false,
    snapshot: () => JSON.stringify([...m.entries()]),
    restore: (snap) => { m.clear(); for (const [k, v] of JSON.parse(snap)) m.set(k, v); },
    _m: m,
  };
  return s;
}
function originStorage(chain, events = []) {
  const s = memStorage(events);
  const address = "0x" + "a1".repeat(20);
  assert.equal(registerControlledPiggy(s, chain, { address, signerAddress: address, locator: { credentialId: "ROOT" }, at: AT }).ok, true);
  assert.equal(markBornPiggyIssuance(s, chain, { address }).ok, true);
  s.events = events;
  s.events.length = 0;
  return s;
}
const locks = { request: (_n, _o, fn) => fn() };
function prfProvider(events = []) {
  const bufs = [];
  const calls = [];
  const requestPrf = async (credential, salt) => {
    events.push("prf");
    calls.push(Buffer.from(salt).toString("hex"));
    const out = new Uint8Array(32);
    out.set(createHash("sha256").update(`${credential.credentialId}|${Buffer.from(salt).toString("hex")}`).digest());
    bufs.push(out);
    return { credentialId: credential.credentialId, prfOutput: out };
  };
  const deriveAddress = (prf) => { events.push("derive"); return "0x" + Buffer.from(prf.slice(0, 20)).toString("hex"); };
  return { requestPrf, deriveAddress, bufs, calls };
}

// ── fake registry + authority (in memory; stands in for IssuanceRegistry; NO network) ───────────
function fakeChain({ chainScope = TESTNET, events = [] } = {}) {
  const reg = new Map();                                  // address(lower) -> purpose   (the write-once mapping)
  let txSeq = 0;
  const hash = () => "0x" + (++txSeq).toString(16).padStart(64, "0");
  const knobs = {
    preflight: "ok",            // ok | throw | hang | notok | wrongaddr | garbage
    isIssued: "truth",          // truth | throw | hang | garbage | lieFree | lieTaken
    register: "honest",         // honest | throw | hang | not_submitted | garbage
    frontRun: null,             // { purpose } -> an observer registers the same address first (same tx ordering)
    mutate: null,               // (receipt, ctx) => receipt   — corrupts the receipt the adapter hands back
    otherReceipt: null,         // () => {txHash, receipt}     — adapter returns somebody else's evidence
  };
  const calls = { preflight: 0, isIssued: 0, register: 0, args: [] };
  const successes = [];                                   // [{address, purpose, tx}] of registrations that really landed from OUR register()
  const logOf = (address, purpose, emitter = REGISTRY, topic0 = REGISTERED_TOPIC0) => ({ address: emitter, topics: [topic0, pad(address), purpose], data: "0x" });
  const authority = {
    interfaceVersion: ISSUANCE_AUTHORITY_INTERFACE_VERSION,
    chainScope,
    registryAddress: REGISTRY,
    async preflight() {
      calls.preflight += 1; events.push("preflight");
      if (knobs.preflight === "throw") throw new Error("rpc down");
      if (knobs.preflight === "hang") return new Promise(() => {});
      if (knobs.preflight === "notok") return { ok: false };
      if (knobs.preflight === "wrongaddr") return { ok: true, registryAddress: OTHER_EMITTER };
      if (knobs.preflight === "garbage") return "yes";
      return { ok: true, registryAddress: REGISTRY };
    },
    async isIssued(address) {
      calls.isIssued += 1; events.push("isIssued");
      if (knobs.isIssued === "throw") throw new Error("rpc down");
      if (knobs.isIssued === "hang") return new Promise(() => {});
      if (knobs.isIssued === "garbage") return "false";
      if (knobs.isIssued === "lieFree") return false;
      if (knobs.isIssued === "lieTaken") return true;
      return reg.has(address.toLowerCase());
    },
    async register({ address, purpose, sequence, chainScope: cs }) {
      calls.register += 1; events.push("register"); calls.args.push({ address, purpose, sequence, chainScope: cs });
      if (knobs.register === "throw") throw new Error("submit failed");
      if (knobs.register === "hang") return new Promise(() => {});
      if (knobs.register === "not_submitted") return { outcome: "not_submitted", reason: "no_funds" };
      if (knobs.register === "garbage") return { ok: true };
      if (knobs.frontRun) reg.set(address.toLowerCase(), knobs.frontRun.purpose);           // attacker lands first
      if (knobs.otherReceipt) return knobs.otherReceipt();
      const tx = hash();
      let receipt;
      if (reg.has(address.toLowerCase())) {
        receipt = { transactionHash: tx, status: 0, finalized: true, to: REGISTRY, logs: [] };    // revert: AlreadyRegistered
      } else {
        reg.set(address.toLowerCase(), purpose);
        successes.push({ address, purpose, tx });
        receipt = { transactionHash: tx, status: 1, finalized: true, to: REGISTRY, logs: [logOf(address, purpose)] };
      }
      if (knobs.mutate) receipt = knobs.mutate(receipt, { address, purpose, tx, logOf });
      return { outcome: "submitted", txHash: tx, receipt };
    },
  };
  return { authority, knobs, calls, reg, successes, logOf, setPurpose: (a, p) => reg.set(a.toLowerCase(), p) };
}

async function admit({ storage, chain, authority, purpose = null, prf, timeouts = { preflight: 40, register: 40 } }) {
  return admitModelAPiggy({
    storage, chainId: chain, locks, rootCredential: ROOT, requestPrf: prf.requestPrf, deriveAddress: prf.deriveAddress,
    now: () => AT, issuanceAuthority: authority, issuancePurpose: purpose, authorityTimeouts: timeouts,
  });
}
const rowsOf = (s, chain) => loadMyPiggiesIndex(s, chain).index.piggies;
const watermark = (s, chain) => loadMyPiggiesIndex(s, chain).index.issuedThrough;
const rawOf = (s, chain) => s.getItem(myPiggiesIndexKey(chain));

// ═══ P. profile gate ═══════════════════════════════════════════════════════════════════════════
await check("P1. profile gate: only the exact testnet scope is exempt; the live scope and EVERY other value (unknown, misspelt, blocked, non-string) require an authority (fail closed)", () => {
  assert.equal(issuanceAuthorityRequiredForScope(TESTNET), false);
  assert.equal(issuanceAuthorityRequiredForScope(MAINNET), true);
  assert.equal(issuanceAuthorityRequiredForScope("143"), true);
  for (const other of ["", "1", "10143", "other-chain", "MONAD-MAINNET", " monad-mainnet", "monad-testnet ", "MONAD-TESTNET", undefined, null, 143, 10143]) assert.equal(issuanceAuthorityRequiredForScope(other), true, String(other));
});

await check("P1-b. unknown scope + null authority (a fixture / future profile that is not exactly testnet) refuses before PRF with zero writes — no silent ungated issuance", async () => {
  for (const chain of ["other-chain", "143", "10143"]) {
    const events = [];
    const storage = originStorage(chain, events);
    const before = storage.snapshot();
    const prf = prfProvider(events);
    const r = await admit({ storage, chain, authority: null, prf });
    assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: ISSUANCE_REFUSAL.UNCONFIGURED }, chain);
    assert.deepEqual(events, [], chain);
    assert.equal(storage.snapshot(), before, chain);
  }
});

await check("P2. product default: main.js ships the authority null, passes it through the one admission helper, and the registry/provider is nowhere configured", () => {
  assert.equal((MAIN.match(/^const ISSUANCE_AUTHORITY = null;$/gm) || []).length, 1, "exactly one literal-null declaration");
  assert.equal((MAIN.match(/ISSUANCE_AUTHORITY\b/g) || []).length, 2, "declaration + the one pass-through in the admission helper, nothing else reads it");
  const helper = bodyOf(MAIN, "runModelAAdmission");
  assert.match(helper, /issuanceAuthority: ISSUANCE_AUTHORITY,/);
  assert.match(helper, /issuancePurpose: purpose,/);
  assert.match(bodyOf(MAIN, "beginAddPiggy"), /await runModelAAdmission\(root\.credential\)/, "plain +Piggy passes no purpose (default = plus)");
  assert.match(bodyOf(MAIN, "beginGiftPiggy"), /purpose: \{ kind: "gift", giftId: intent\?\.giftId \}/);
  assert.equal(/import\s[^;]*issuance-authority/.test(MAIN), false, "main.js does not import the adapter module: nothing can be built from it");
  assert.equal(/\b0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/.test(stripComments(AUTH_SRC)), false, "issuance-authority.js contains no address");
});

await check("P3. the two pinned constants are the real keccak values (purpose 'plus', Registered topic0) and the Gift purpose is the giftId itself", () => {
  assert.equal(PLUS_PURPOSE, keccak256(toBytes("plus")));
  assert.equal(REGISTERED_TOPIC0, toEventSelector("Registered(address,bytes32,uint256)"));
  assert.deepEqual(resolveIssuancePurpose(null), { purpose: PLUS_PURPOSE, kind: "plus", error: null });
  assert.deepEqual(resolveIssuancePurpose({ kind: "plus" }), { purpose: PLUS_PURPOSE, kind: "plus", error: null });
  assert.equal(resolveIssuancePurpose({ kind: "gift", giftId: GIFT_ID.toUpperCase().replace("0X", "0x") }).purpose, GIFT_ID);
  for (const bad of [{ kind: "gift" }, { kind: "gift", giftId: "0x" + "00".repeat(32) }, { kind: "gift", giftId: "0x12" }, { kind: "gift", giftId: 5 }, { kind: "x" }, "plus", [], 7]) {
    assert.equal(resolveIssuancePurpose(bad).error, ISSUANCE_REFUSAL.PURPOSE_INVALID, JSON.stringify(bad));
  }
});

// ═══ T. testnet unchanged ══════════════════════════════════════════════════════════════════════
await check("T1. testnet, authority null (the shipped default): the A-695 path — no authority code runs, row + watermark commit exactly as before", async () => {
  const storage = originStorage(TESTNET);
  const prf = prfProvider();
  const r1 = await admit({ storage, chain: TESTNET, authority: null, prf });
  assert.equal(r1.ok, true);
  assert.equal(r1.piggy.sequence, 1);
  assert.equal(watermark(storage, TESTNET), 1);
  const r2 = await admit({ storage, chain: TESTNET, authority: undefined, prf });
  assert.equal(r2.piggy.sequence, 2);
  assert.equal(prf.calls.length, 2, "one assertion per admission");
  // identical to the pre-A-711 entry point driven directly
  const direct = originStorage(TESTNET);
  const prf2 = prfProvider();
  const d1 = await admitSequencedPiggy({ storage: direct, chainId: TESTNET, sequence: 1, rootCredential: ROOT, requestPrf: prf2.requestPrf, deriveAddress: prf2.deriveAddress, now: () => AT, requireNext: true });
  assert.deepEqual(d1.piggy, r1.piggy);
});

await check("T2. testnet keeps the A-695 provenance gate (no index / no provenance -> refused before PRF) with or without an authority", async () => {
  const bare = memStorage();
  const prf = prfProvider();
  const f = fakeChain({ chainScope: TESTNET });
  for (const authority of [null, f.authority]) {
    const r = await admit({ storage: bare, chain: TESTNET, authority, prf });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "origin_index_missing");
  }
  assert.equal(prf.calls.length, 0);
  assert.equal(f.calls.preflight, 0, "the origin gate runs before any authority call");
});

// ═══ R0. null / bad / unreachable -> refuse before PRF ═════════════════════════════════════════
await check("R0-a. live scope + null authority: refused BEFORE requestPrf, zero local writes, zero authority calls", async () => {
  for (const authority of [null, undefined]) {
    const events = [];
    const storage = originStorage(MAINNET, events);
    const before = storage.snapshot();
    const prf = prfProvider(events);
    const r = await admit({ storage, chain: MAINNET, authority, prf });
    assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: ISSUANCE_REFUSAL.UNCONFIGURED });
    assert.equal(prf.calls.length, 0);
    assert.deepEqual(events, [], "no prf, no write");
    assert.equal(storage.snapshot(), before, "storage byte-identical");
  }
});

await check("R0-b. live scope: malformed / wrong-chain / wrong-version / unpinned authority -> refused before PRF", async () => {
  const f = fakeChain({ chainScope: MAINNET });
  const good = f.authority;
  const cases = [
    [{ ...good, interfaceVersion: 2 }, ISSUANCE_REFUSAL.INVALID],
    [{ ...good, registryAddress: "0x" + "00".repeat(20) }, ISSUANCE_REFUSAL.INVALID],
    [{ ...good, registryAddress: "0x12" }, ISSUANCE_REFUSAL.INVALID],
    [{ ...good, register: undefined }, ISSUANCE_REFUSAL.INVALID],
    [{ ...good, preflight: "x" }, ISSUANCE_REFUSAL.INVALID],
    [{ ...good, chainScope: TESTNET }, ISSUANCE_REFUSAL.CHAIN_MISMATCH],
    [{ ...good, chainScope: "" }, ISSUANCE_REFUSAL.CHAIN_MISMATCH],
    [[], ISSUANCE_REFUSAL.INVALID],
    ["authority", ISSUANCE_REFUSAL.INVALID],
  ];
  for (const [authority, reason] of cases) {
    const storage = originStorage(MAINNET);
    const before = storage.snapshot();
    const prf = prfProvider();
    const r = await admit({ storage, chain: MAINNET, authority, prf });
    assert.equal(r.reason, reason, JSON.stringify(Object.keys(authority || {})));
    assert.equal(prf.calls.length, 0);
    assert.equal(storage.snapshot(), before);
  }
  assert.equal(validateIssuanceAuthority(good, MAINNET).ok, true);
});

await check("R0-c. preflight throws / hangs (timeout) / says not-ok / names another registry / answers garbage -> refused before PRF, zero writes, register never called", async () => {
  const expect = { throw: ISSUANCE_REFUSAL.UNREACHABLE, hang: ISSUANCE_REFUSAL.UNREACHABLE, notok: ISSUANCE_REFUSAL.NOT_READY, wrongaddr: ISSUANCE_REFUSAL.NOT_READY, garbage: ISSUANCE_REFUSAL.NOT_READY };
  for (const [mode, reason] of Object.entries(expect)) {
    const f = fakeChain({ chainScope: MAINNET });
    f.knobs.preflight = mode;
    const storage = originStorage(MAINNET);
    const before = storage.snapshot();
    const prf = prfProvider();
    const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
    assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason }, mode);
    assert.equal(prf.calls.length, 0, mode);
    assert.equal(f.calls.register, 0, mode);
    assert.equal(storage.snapshot(), before, mode);
  }
});

await check("R0-d. invalid purpose is refused before PRF too (a Gift without a bytes32 giftId can never reach the registry)", async () => {
  const f = fakeChain({ chainScope: MAINNET });
  const storage = originStorage(MAINNET);
  const prf = prfProvider();
  const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf, purpose: { kind: "gift", giftId: undefined } });
  assert.equal(r.reason, ISSUANCE_REFUSAL.PURPOSE_INVALID);
  assert.equal(prf.calls.length, 0);
  assert.equal(f.calls.preflight, 0);
});

// ═══ ordering + happy path ═════════════════════════════════════════════════════════════════════
await check("O1. state order on success: preflight -> prf -> derive -> isIssued -> register -> write (commit only after OUR registration)", async () => {
  const events = [];
  const storage = originStorage(MAINNET, events);
  const f = fakeChain({ chainScope: MAINNET, events });
  const prf = prfProvider(events);
  const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
  assert.equal(r.ok, true);
  assert.deepEqual(events, ["preflight", "prf", "derive", "isIssued", "register", "write"]);
  assert.equal(r.piggy.sequence, 1);
  assert.equal(f.successes.length, 1);
  assert.equal(f.successes[0].address.toLowerCase(), r.piggy.address.toLowerCase());
  assert.deepEqual(f.calls.args[0], { address: r.piggy.address, purpose: PLUS_PURPOSE, sequence: 1, chainScope: MAINNET });
  assert.equal(prf.bufs.every((b) => b.every((x) => x === 0)), true, "PRF output zeroed (A-669) on the issuance path too");
});

// ═══ R1. already registered -> never adopted ═══════════════════════════════════════════════════
await check("R1. an address registered before this attempt is never adopted — not with another purpose, not with the SAME purpose; n is burned, no row, no register call; the next attempt takes n+1", async () => {
  for (const preRegisteredPurpose of ["0x" + "77".repeat(32), PLUS_PURPOSE]) {
    const events = [];
    const storage = originStorage(MAINNET, events);
    const f = fakeChain({ chainScope: MAINNET, events });
    const prf = prfProvider(events);
    // learn addr_1 without issuing, then pre-register it (a crash survivor / a griefer / an old install)
    const probe = prfProvider();
    const addr1 = probe.deriveAddress((await probe.requestPrf(ROOT, new Uint8Array(await (await import("../src/piggy-session.js")).modelASalt(1)))).prfOutput);
    f.setPurpose(addr1, preRegisteredPurpose);
    const rowsBefore = rowsOf(storage, MAINNET).length;
    const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
    assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: ISSUANCE_REFUSAL.SEQUENCE_REGISTERED });
    assert.equal(f.calls.register, 0, "never even tries to register what is taken");
    assert.equal(rowsOf(storage, MAINNET).length, rowsBefore, "no row for the taken address");
    assert.equal(watermark(storage, MAINNET), 1, "n=1 burned");
    assert.equal(rowsOf(storage, MAINNET).some((p) => p.address.toLowerCase() === addr1.toLowerCase()), false);
    const next = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
    assert.equal(next.ok, true);
    assert.equal(next.piggy.sequence, 2, "n+1 — n=1 is never reused");
    assert.notEqual(next.piggy.address.toLowerCase(), addr1.toLowerCase());
  }
});

await check("R1-b. isIssued unreachable / garbage -> refused after PRF with no commit and no burn (nothing is known); isIssued lying 'free' is still caught by the revert (own-receipt rule)", async () => {
  for (const mode of ["throw", "hang", "garbage"]) {
    const f = fakeChain({ chainScope: MAINNET });
    f.knobs.isIssued = mode;
    const storage = originStorage(MAINNET);
    const prf = prfProvider();
    const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
    assert.equal(r.reason, ISSUANCE_REFUSAL.UNREACHABLE, mode);
    assert.equal(f.calls.register, 0, mode);
    assert.equal(rowsOf(storage, MAINNET).length, 1, mode);
    assert.equal(watermark(storage, MAINNET), 0, `${mode}: n not burned`);
  }
  // lieFree on a TAKEN address: register reverts -> no own success
  const f = fakeChain({ chainScope: MAINNET });
  f.knobs.isIssued = "lieFree";
  const storage = originStorage(MAINNET);
  const prf = prfProvider();
  const a1 = prfProvider();
  const taken = a1.deriveAddress((await a1.requestPrf(ROOT, new Uint8Array(await (await import("../src/piggy-session.js")).modelASalt(1)))).prfOutput);
  f.setPurpose(taken, PLUS_PURPOSE);
  const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
  assert.equal(r.reason, ISSUANCE_REFUSAL.REGISTRATION_UNVERIFIED);
  assert.equal(rowsOf(storage, MAINNET).length, 1);
  assert.equal(watermark(storage, MAINNET), 1);
});

// ═══ R2. own-receipt rule ══════════════════════════════════════════════════════════════════════
await check("R2-a. front-run with the SAME (piggy, purpose): registry says purposeOf==ours and the attacker's matching log exists, but OUR tx reverted -> refused, no row, n burned (A-708 M-2)", async () => {
  const f = fakeChain({ chainScope: MAINNET });
  f.knobs.isIssued = "lieFree";                       // the observer lands between our view and our tx
  f.knobs.frontRun = { purpose: PLUS_PURPOSE };
  const storage = originStorage(MAINNET);
  const prf = prfProvider();
  const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
  assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: ISSUANCE_REFUSAL.REGISTRATION_UNVERIFIED });
  assert.equal(f.successes.length, 0, "nothing of ours landed");
  assert.equal(f.reg.size, 1, "...yet the registry now holds the address with OUR purpose (the naive success signal)");
  assert.equal(rowsOf(storage, MAINNET).length, 1);
  assert.equal(watermark(storage, MAINNET), 1);
});

await check("R2-b. adapter hands back somebody else's evidence (their tx hash + their matching log) -> refused; same tuple, finalized, status 1 — only the tx-hash binding fails", async () => {
  const f = fakeChain({ chainScope: MAINNET });
  f.knobs.isIssued = "lieFree";
  let theirs = null;
  f.knobs.otherReceipt = () => {
    const stolen = "0x" + "ee".repeat(32);
    theirs = stolen;
    return { outcome: "submitted", txHash: "0x" + "11".repeat(32), receipt: { transactionHash: stolen, status: 1, finalized: true, to: REGISTRY, logs: [f.logOf(f.calls.args.at(-1).address, f.calls.args.at(-1).purpose)] } };
  };
  const storage = originStorage(MAINNET);
  const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf: prfProvider() });
  assert.equal(r.reason, ISSUANCE_REFUSAL.REGISTRATION_UNVERIFIED);
  assert.ok(theirs);
  assert.equal(rowsOf(storage, MAINNET).length, 1);
  assert.equal(watermark(storage, MAINNET), 1);
});

const BAD = "0x" + "bb".repeat(32);
const MUTATIONS = [
  ["status 0 (revert)", (r) => ({ ...r, status: 0 })],
  ["status '0x0'", (r) => ({ ...r, status: "0x0" })],
  ["status missing", (r) => { const { status, ...rest } = r; return rest; }],
  ["not finalized (false)", (r) => ({ ...r, finalized: false })],
  ["not finalized (missing)", (r) => { const { finalized, ...rest } = r; return rest; }],
  ["finalized truthy string", (r) => ({ ...r, finalized: "yes" })],
  ["other tx hash in receipt", (r) => ({ ...r, transactionHash: BAD })],
  ["receipt.to is not the registry", (r) => ({ ...r, to: OTHER_EMITTER })],
  ["no logs", (r) => ({ ...r, logs: [] })],
  ["logs missing", (r) => { const { logs, ...rest } = r; return rest; }],
  ["log from another emitter only", (r, c) => ({ ...r, logs: [c.logOf(c.address, c.purpose, OTHER_EMITTER)] })],
  ["two registry logs", (r, c) => ({ ...r, logs: [c.logOf(c.address, c.purpose), c.logOf(c.address, c.purpose)] })],
  ["wrong topic0", (r, c) => ({ ...r, logs: [c.logOf(c.address, c.purpose, REGISTRY, BAD)] })],
  ["log for another piggy", (r, c) => ({ ...r, logs: [c.logOf("0x" + "12".repeat(20), c.purpose)] })],
  ["log with another purpose", (r, c) => ({ ...r, logs: [c.logOf(c.address, "0x" + "55".repeat(32))] })],
  ["log with too few topics", (r, c) => ({ ...r, logs: [{ address: REGISTRY, topics: [REGISTERED_TOPIC0, pad(c.address)] }] })],
];
await check(`R2-c. own-receipt table: ${MUTATIONS.length} corruptions of an otherwise honest receipt are each refused, burn n, write no row`, async () => {
  for (const [name, mutate] of MUTATIONS) {
    const f = fakeChain({ chainScope: MAINNET });
    f.knobs.mutate = (receipt, ctx) => mutate(receipt, ctx);
    const storage = originStorage(MAINNET);
    const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf: prfProvider() });
    assert.deepEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: ISSUANCE_REFUSAL.REGISTRATION_UNVERIFIED }, name);
    assert.equal(rowsOf(storage, MAINNET).length, 1, name);
    assert.equal(watermark(storage, MAINNET), 1, `${name}: n burned`);
  }
});

await check("R2-d. register() throws / times out / answers garbage after a possible submission -> AMBIGUOUS, n burned, no row; 'not_submitted' -> refused WITHOUT burning n", async () => {
  for (const mode of ["throw", "hang", "garbage"]) {
    const f = fakeChain({ chainScope: MAINNET });
    f.knobs.register = mode;
    const storage = originStorage(MAINNET);
    const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf: prfProvider() });
    assert.equal(r.reason, ISSUANCE_REFUSAL.REGISTRATION_AMBIGUOUS, mode);
    assert.equal(rowsOf(storage, MAINNET).length, 1, mode);
    assert.equal(watermark(storage, MAINNET), 1, `${mode}: burned`);
  }
  const f = fakeChain({ chainScope: MAINNET });
  f.knobs.register = "not_submitted";
  const storage = originStorage(MAINNET);
  const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf: prfProvider() });
  assert.equal(r.reason, ISSUANCE_REFUSAL.NOT_SUBMITTED);
  assert.equal(watermark(storage, MAINNET), 0, "nothing was sent -> n stays");
  assert.equal(rowsOf(storage, MAINNET).length, 1);
});

await check("R2-e. verifyOwnRegistration is pure and honest: only the exact own/final/status-1/one-log shape passes; tx hash comparison is case-insensitive", () => {
  const address = "0x" + "ab".repeat(20);
  const txHash = "0x" + "AB".repeat(32);
  const good = { txHash, receipt: { transactionHash: txHash.toLowerCase(), status: "success", finalized: true, logs: [{ address: REGISTRY.toUpperCase().replace("0X", "0x"), topics: [REGISTERED_TOPIC0, pad(address), PLUS_PURPOSE] }] } };
  assert.equal(verifyOwnRegistration(good, { registryAddress: REGISTRY, address, purpose: PLUS_PURPOSE }).ok, true);
  assert.equal(verifyOwnRegistration(null, { registryAddress: REGISTRY, address, purpose: PLUS_PURPOSE }).ok, false);
  assert.equal(verifyOwnRegistration({ txHash: "0x1", receipt: good.receipt }, { registryAddress: REGISTRY, address, purpose: PLUS_PURPOSE }).ok, false);
  assert.equal(verifyOwnRegistration(good, { registryAddress: REGISTRY, address, purpose: "0x12" }).ok, false);
  assert.equal(verifyOwnRegistration({ ...good, receipt: undefined }, { registryAddress: REGISTRY, address, purpose: PLUS_PURPOSE }).ok, false);
});

// ═══ C2. crash after registration / local commit missing ═══════════════════════════════════════
await check("C2. registration landed, local commit lost (storage write fails = crash): no row, n unchanged locally; the next attempt sees it registered, skips n (burn), and n+1 is a different address — n is never reused or adopted", async () => {
  const storage = originStorage(MAINNET);
  const f = fakeChain({ chainScope: MAINNET });
  const prf = prfProvider();
  storage.failWrites = true;
  const crashed = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
  assert.equal(crashed.ok, false);
  assert.equal(crashed.reason, "storage_write_failed");
  assert.equal(f.successes.length, 1, "the registration DID land");
  const addr1 = f.successes[0].address;
  storage.failWrites = false;
  assert.equal(rowsOf(storage, MAINNET).length, 1, "no local row");
  assert.equal(watermark(storage, MAINNET), 0, "local still believes n=1 is free");
  const again = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
  assert.deepEqual({ ok: again.ok, reason: again.reason }, { ok: false, reason: ISSUANCE_REFUSAL.SEQUENCE_REGISTERED });
  assert.equal(f.calls.register, 1, "no second registration of n=1");
  assert.equal(rowsOf(storage, MAINNET).some((p) => p.address.toLowerCase() === addr1.toLowerCase()), false, "the registered address was NOT adopted");
  assert.equal(watermark(storage, MAINNET), 1, "n=1 burned");
  const third = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
  assert.equal(third.ok, true);
  assert.equal(third.piggy.sequence, 2);
  assert.notEqual(third.piggy.address.toLowerCase(), addr1.toLowerCase());
});

await check("C2-b. a process death between register() and the commit (the lock callback never resumes) leaves the same recoverable state", async () => {
  const storage = originStorage(MAINNET);
  const f = fakeChain({ chainScope: MAINNET });
  const prf = prfProvider();
  // The 'crash' is a throw out of the commit itself AFTER the authority returned success.
  const dying = { ...storage, setItem: () => { throw new Error("killed"); }, getItem: storage.getItem, removeItem: storage.removeItem };
  const r = await admit({ storage: dying, chain: MAINNET, authority: f.authority, prf });
  assert.equal(r.ok, false);
  const after = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
  assert.equal(after.reason, ISSUANCE_REFUSAL.SEQUENCE_REGISTERED);
  assert.equal(f.successes.length, 1);
});

await check("C2-c. the burn write itself fails (storage dies right after the registry said 'taken'): still refused, no row; the next attempt re-derives n, the registry still says taken, never adopted", async () => {
  const storage = originStorage(MAINNET);
  const f = fakeChain({ chainScope: MAINNET });
  const prf = prfProvider();
  storage.failWrites = true;
  assert.equal((await admit({ storage, chain: MAINNET, authority: f.authority, prf })).reason, "storage_write_failed");   // registration landed, commit lost
  const addr1 = f.successes[0].address.toLowerCase();
  const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf });                                       // burn write also fails
  assert.equal(r.reason, ISSUANCE_REFUSAL.SEQUENCE_REGISTERED);
  storage.failWrites = false;
  assert.equal(watermark(storage, MAINNET), 0, "burn could not be written");
  const again = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
  assert.equal(again.reason, ISSUANCE_REFUSAL.SEQUENCE_REGISTERED, "the authority, not the lost burn, keeps n=1 closed");
  assert.equal(rowsOf(storage, MAINNET).some((p) => p.address.toLowerCase() === addr1), false);
  assert.equal(f.calls.register, 1);
});

// ═══ D. duplicate issuance across copies of the same data (A-695 F2 copy case, A-708 REVIEW L-2) ═══
await check("D1. two devices holding a byte-copy of the same index + the same root: the first issues n=1; the copy derives the SAME address, the registry says taken, it is never adopted, the copy moves to n=2 — no address is ever on two rows' successes", async () => {
  const a = originStorage(MAINNET);
  const b = memStorage();
  b.restore(a.snapshot());
  const f = fakeChain({ chainScope: MAINNET });
  const ra = await admit({ storage: a, chain: MAINNET, authority: f.authority, prf: prfProvider() });
  assert.equal(ra.ok, true);
  const rb = await admit({ storage: b, chain: MAINNET, authority: f.authority, prf: prfProvider() });
  assert.deepEqual({ ok: rb.ok, reason: rb.reason }, { ok: false, reason: ISSUANCE_REFUSAL.SEQUENCE_REGISTERED });
  assert.equal(rowsOf(b, MAINNET).some((p) => p.address.toLowerCase() === ra.piggy.address.toLowerCase()), false, "copy never adopts A's Piggy as its own issuance");
  const rb2 = await admit({ storage: b, chain: MAINNET, authority: f.authority, prf: prfProvider() });
  assert.equal(rb2.ok, true);
  assert.equal(rb2.piggy.sequence, 2);
  assert.notEqual(rb2.piggy.address.toLowerCase(), ra.piggy.address.toLowerCase());
  assert.equal(f.successes.length, 2);
  assert.equal(new Set(f.successes.map((s) => s.address.toLowerCase())).size, 2, "no address registered twice");
});

await check("D2. the copy races A on the wire (both saw 'free'): the loser's own tx reverts -> refused + burned, never adopted, even though the registry holds the loser's own purpose", async () => {
  const a = originStorage(MAINNET);
  const b = memStorage();
  b.restore(a.snapshot());
  const f = fakeChain({ chainScope: MAINNET });
  assert.equal((await admit({ storage: a, chain: MAINNET, authority: f.authority, prf: prfProvider() })).ok, true);
  f.knobs.isIssued = "lieFree";                       // B read 'free' before A's tx landed
  const rb = await admit({ storage: b, chain: MAINNET, authority: f.authority, prf: prfProvider() });
  assert.deepEqual({ ok: rb.ok, reason: rb.reason }, { ok: false, reason: ISSUANCE_REFUSAL.REGISTRATION_UNVERIFIED });
  assert.equal(rowsOf(b, MAINNET).length, 1);
  assert.equal(watermark(b, MAINNET), 1, "n burned on the copy");
  assert.equal(f.successes.length, 1);
});

// ═══ B6 / B7. rollback and forged local state ══════════════════════════════════════════════════
await check("B6. whole-index rollback to every earlier snapshot: the registry refuses every re-derivation, every refusal burns, and no address is ever registered twice", async () => {
  const storage = originStorage(MAINNET);
  const f = fakeChain({ chainScope: MAINNET });
  const prf = prfProvider();
  const snaps = [storage.snapshot()];
  const issued = new Set();
  for (let i = 0; i < 4; i += 1) {
    const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
    assert.equal(r.ok, true);
    issued.add(r.piggy.address.toLowerCase());
    snaps.push(storage.snapshot());
  }
  assert.equal(issued.size, 4);
  for (let k = 0; k < snaps.length - 1; k += 1) {
    storage.restore(snaps[k]);
    const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
    assert.equal(r.ok, false, `rollback to snapshot ${k} must not re-issue`);
    assert.equal(r.reason, ISSUANCE_REFUSAL.SEQUENCE_REGISTERED);
    assert.equal(watermark(storage, MAINNET), k + 1);
    assert.equal(rowsOf(storage, MAINNET).length, k + 1);
  }
  storage.restore(snaps[0]);
  for (let i = 0; i < 4; i += 1) assert.equal((await admit({ storage, chain: MAINNET, authority: f.authority, prf })).ok, false, "burning forward through n=1..4");
  const fresh = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.piggy.sequence, 5);
  assert.equal(issued.has(fresh.piggy.address.toLowerCase()), false);
  assert.equal(f.successes.length, new Set(f.successes.map((s) => s.address.toLowerCase())).size, "no address registered twice");
  assert.equal(f.successes.length, 5);
});

await check("B7. forged local state is no authority either way: a forged low watermark cannot re-issue, and a forged 'issued' row neither blocks nor satisfies the registry", async () => {
  const storage = originStorage(MAINNET);
  const f = fakeChain({ chainScope: MAINNET });
  const prf = prfProvider();
  assert.equal((await admit({ storage, chain: MAINNET, authority: f.authority, prf })).ok, true);
  // (1) tamper: lower the stored watermark and drop the row, keep a valid-looking index
  const parsed = JSON.parse(rawOf(storage, MAINNET));
  const forgedLow = { ...parsed, issuedThrough: 0, piggies: parsed.piggies.filter((p) => !p.sequence) };
  storage.setItem(myPiggiesIndexKey(MAINNET), JSON.stringify(forgedLow));
  const r = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
  assert.equal(r.reason, ISSUANCE_REFUSAL.SEQUENCE_REGISTERED, "the registry, not the cache, says n=1 is taken");
  // (2) forged local commit (A-708 B7): a valid-looking n=2 row for an address nobody registered, written through the ungated restore path
  const forgedAddr = "0x" + "fe".repeat(20);
  const forged = await admitSequencedPiggy({
    storage, chainId: MAINNET, sequence: 2, rootCredential: ROOT, now: () => AT,
    requestPrf: async (c) => ({ credentialId: c.credentialId, prfOutput: new Uint8Array(32) }), deriveAddress: () => forgedAddr,
  });
  assert.equal(forged.ok, true);
  assert.equal(watermark(storage, MAINNET), 2);
  const registersBefore = f.calls.register;
  const own = await admit({ storage, chain: MAINNET, authority: f.authority, prf });
  assert.equal(own.ok, true);
  assert.equal(own.piggy.sequence, 3);
  assert.equal(f.calls.register, registersBefore + 1, "the forged row neither registered anything nor stood in for registration");
  assert.equal(f.reg.has(forgedAddr), false, "the forged address is still unregistered: a local row is not authority");
});

// ═══ gift / plus purposes ══════════════════════════════════════════════════════════════════════
await check("G1. purposes on the wire: +Piggy registers keccak256('plus'); a Gift Piggy registers its giftId; the matching log must carry THAT purpose", async () => {
  const f = fakeChain({ chainScope: MAINNET });
  const storage = originStorage(MAINNET);
  const prf = prfProvider();
  assert.equal((await admit({ storage, chain: MAINNET, authority: f.authority, prf })).ok, true);
  assert.equal((await admit({ storage, chain: MAINNET, authority: f.authority, prf, purpose: { kind: "gift", giftId: GIFT_ID } })).ok, true);
  assert.equal((await admit({ storage, chain: MAINNET, authority: f.authority, prf, purpose: { kind: "plus" } })).ok, true);
  assert.deepEqual(f.calls.args.map((a) => a.purpose), [PLUS_PURPOSE, GIFT_ID, PLUS_PURPOSE]);
  // a log carrying the OTHER kind's purpose does not satisfy the gift attempt
  const g = fakeChain({ chainScope: MAINNET });
  g.knobs.mutate = (receipt, c) => ({ ...receipt, logs: [c.logOf(c.address, PLUS_PURPOSE)] });
  const s2 = originStorage(MAINNET);
  const r = await admit({ storage: s2, chain: MAINNET, authority: g.authority, prf: prfProvider(), purpose: { kind: "gift", giftId: GIFT_ID } });
  assert.equal(r.reason, ISSUANCE_REFUSAL.REGISTRATION_UNVERIFIED);
});

// ═══ RC. recovery / restore / known piggies are ungated ════════════════════════════════════════
await check("RC1. restore/recovery path (admitSequencedPiggy, requireNext absent) on the live scope: no authority needed, none called, rows restored", async () => {
  const f = fakeChain({ chainScope: MAINNET });
  const storage = originStorage(MAINNET);
  const prf = prfProvider();
  for (const n of [1, 2]) {
    const r = await admitSequencedPiggy({ storage, chainId: MAINNET, sequence: n, rootCredential: ROOT, requestPrf: prf.requestPrf, deriveAddress: prf.deriveAddress, now: () => AT });
    assert.equal(r.ok, true, `restore n=${n}`);
  }
  assert.equal(watermark(storage, MAINNET), 2);
  assert.deepEqual([f.calls.preflight, f.calls.isIssued, f.calls.register], [0, 0, 0]);
});

await check("RC2. source: index-backup.js and gate-b-recovery.js never reference the authority module or requireNext; the only requireNext:true call is the testnet/no-authority branch of admitModelAPiggy", () => {
  for (const f of ["index-backup.js", "gate-b-recovery.js"]) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.equal(/issuance-authority|admitIssuedPiggy|requireNext|issuanceAuthority/.test(src), false, f);
  }
  const code = stripComments(INDEX_SRC);
  assert.equal((code.match(/requireNext: true/g) || []).length, 1);
  assert.match(bodyOf(INDEX_SRC, "admitModelAPiggy"), /if \(authorityRequired\) return refuse\(ISSUANCE_REFUSAL\.UNCONFIGURED\);[\s\S]*requireNext: true/);
  // admitIssuedPiggy cannot be entered without an authority and never silently degrades to the ungated path
  const issued = stripComments(bodyOf(INDEX_SRC, "admitIssuedPiggy"));
  assert.match(issued, /authority === null \|\| authority === undefined\) return refuse\(ISSUANCE_REFUSAL\.UNCONFIGURED\)/);
  assert.equal(/requireNext: true/.test(issued), false);
});

await check("RC3. admitIssuedPiggy called directly without an authority refuses (no ungated fallback), before PRF", async () => {
  const storage = originStorage(MAINNET);
  const prf = prfProvider();
  const r = await admitIssuedPiggy({ storage, chainId: MAINNET, sequence: 1, rootCredential: ROOT, requestPrf: prf.requestPrf, deriveAddress: prf.deriveAddress, now: () => AT });
  assert.equal(r.reason, ISSUANCE_REFUSAL.UNCONFIGURED);
  assert.equal(prf.calls.length, 0);
});

await check("RC4. PRF/auth failures on the issuance path keep the old reasons and write nothing: cancel -> auth_*, wrong credential -> root_credential_mismatch, derive throws -> derive_failed", async () => {
  const f = fakeChain({ chainScope: MAINNET });
  const mk = () => originStorage(MAINNET);
  let s = mk();
  let r = await admit({ storage: s, chain: MAINNET, authority: f.authority, prf: { requestPrf: async () => { throw new Error("NotAllowedError"); }, deriveAddress: () => "0x" } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /^auth_/);
  s = mk();
  const p = prfProvider();
  r = await admit({ storage: s, chain: MAINNET, authority: f.authority, prf: { requestPrf: async (c, salt) => ({ ...(await p.requestPrf(c, salt)), credentialId: "OTHER" }), deriveAddress: p.deriveAddress } });
  assert.equal(r.reason, "root_credential_mismatch");
  s = mk();
  const p2 = prfProvider();
  r = await admit({ storage: s, chain: MAINNET, authority: f.authority, prf: { requestPrf: p2.requestPrf, deriveAddress: () => { throw new Error("x"); } } });
  assert.equal(r.reason, "derive_failed");
  assert.equal(f.calls.isIssued + f.calls.register, 0);
  assert.equal(p2.bufs.every((b) => b.every((x) => x === 0)), true);
});

// ═══ S. source pins ════════════════════════════════════════════════════════════════════════════
// Hashes of the working tree BEFORE A-711 (dirty tree on top of f2d75d6). A change here needs a named reason.
await check("S1. admitSequencedPiggy (restore / first-open shared path; also pinned by A-669) is byte-identical to its pre-A-711 text", () => {
  assert.equal(sha(bodyOf(INDEX_SRC, "admitSequencedPiggy")), "04a2df8b7d3ecf93f59a97e3e6fb6314260212f811306f09b2e2af2cd8950a4e");
  // [A-768 re-pin, named reason: 99e M-F-1] writeControlledPiggy now refuses ("index_unreadable") when the index load errored with
  // anything but "absent" instead of rewriting a clean one-row index; nothing else in the body changed (pre-A-768 8df85e78…).
  assert.equal(sha(bodyOf(INDEX_SRC, "writeControlledPiggy")), "8f48e4375890e5af7161f40ae40c1936a9cc049adf8a8afd41402b6015743df1");
  assert.equal(sha(bodyOf(INDEX_SRC, "checkOriginDeviceIndex")), "0faa926e5fd315f082d3d19b4e3590317f7a0bd7f0db3f74481cc4af6f4e1151");
  assert.equal((INDEX_SRC.match(/await modelASalt\(/g) || []).length, 1, "still exactly one sequence-salt derivation (A-669)");
});

// Baseline = the tree after A-707 (money lock) + A-710 landed and before A-711 (main.js f35f9d8b…). sendPiggyOnce was
// re-pinned from the pre-A-707 draft value b7c47a07… because A-707 legitimately changed it; A-711 does not touch it.
await check("S2. untouched protected functions: render(), sendPiggyOnce(), beginAddPiggy() byte-identical to pre-A-711", () => {
  assert.equal(sha(bodyOf(MAIN, "render")), "866133cf607110939b5ce2b05ad9ff253ee7ab77f8448b3977faa974a9d3e27c");
  // [A-756 re-pin, named reason: Owner decision lock (A) copy only] away line "Can go out once, up to $5." -> "Can go out once." — the A-707 r2 body
  // (6430b5e0…) with exactly that string replaced hashes to the value below. A-711 still does not touch sendPiggyOnce.
  // [A-768 re-pin, named reason: 99e M-L-1] post-deposit redeem reads moved into prepareRedeemAfterDeposit + lag keeps "still out."
  // (pre-A-768 6feadb01…). A-711 still does not touch sendPiggyOnce.
  // [A-896 re-pin, named reason: 99e M-L-2 60 s signer margin] one entry check added to sendPiggyOnce; A-711 still does not touch it.
  // pre-A-896 baseline: sendPiggyOnce 01ee727da9fc2def3d057d939c42b9cf69a95ace97f4c9af81500bd3fef9646b [A-896 R1 re-pin: + monotonic performance.now stamp/check; prior A-896 value was the old pin]
  assert.equal(sha(bodyOf(MAIN, "sendPiggyOnce")), "0120bd9896880837c5fbb0e10a47b73efedeff3b9077f9877cbaae82b4e7955e");
  assert.equal(sha(bodyOf(MAIN, "beginAddPiggy")), "2850f629cff4bf470ff482dbb70a9280b7bd0c2bf033dd885b680a84d18e718e");
});

await check("S3. issuance-authority.js is network-free and search-free: no fetch/ws/rpc/import(), no localStorage, and none of the non-signals (view read of the address, log queries) appear in code", () => {
  const code = stripComments(AUTH_SRC);
  for (const banned of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /\bimport\s*\(/, /^\s*import\s/m, /localStorage|sessionStorage|indexedDB/, /purposeOf/, /getLogs|getContractEvents|getFilterLogs|eth_getLogs|watchContractEvent|readContract|\beth_/, /https?:\/\//, /process\.env|import\.meta/]) {
    assert.equal(banned.test(code), false, String(banned));
  }
  assert.equal(/\.issued\b|\bissued\(/.test(code.replace(/isIssued|queryIssued/g, "")), false, "no registry 'issued' read");
});

await check("S4. no card id / _private path in chain-profile.js (a653 N18 shipped-string rule) and the profile gate adds no import", () => {
  assert.equal(/\bA-\d{3}\b/.test(PROFILE_SRC) || /_private/.test(PROFILE_SRC), false);
  assert.equal((PROFILE_SRC.match(/^import /gm) || []).length, 1);
});

console.log(`\nA-711: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
