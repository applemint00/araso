// A-734 [GIFT CLAIM ROUTE + GIFT OPEN ENTRY · LOCAL ONLY] — regression contract.
//   node app/test/a734-gift-open-entry.mjs                  (Part S + Part N + Part B)
//   A734_NODE_ONLY=1 node app/test/a734-gift-open-entry.mjs (Part S + Part N only — no port/browser)
//
// Part S (static): vercel.json /claim → /index.html rewrite with the catch-all security headers untouched (and matching
//   /claim) and /api/grant untouched · the claim URL contract `/claim#g=..&t=..&v=1` · live Gift configs still null ·
//   the pinned auth/recovery/Gift primitives byte-identical (comment-stripped) to the pre-A-734 tree · the only UI caller
//   of beginGiftPiggy is the Gift Open paper · new code reads/writes no storage and logs nothing.
// Part N (node:vm): cuts the ACTUAL main.js text of the Gift Open entry (giftPaperKind / offerGiftPaperAtBoot /
//   startGiftOpen / openGiftForExistingPiggy / openGiftInvite) together with the REAL startPiggyOpen / checkPiggy /
//   recoverPiggy / openPiggy / take/restorePendingGiftClaim (a726 technique) over deterministic WebAuthn stubs, and the
//   REAL Invite markup functions (renderReceived & co.).
// Part B (Playwright + CDP virtual authenticator, local vite `--mode a172-local --strictPort` on 5827): the REAL app,
//   unstubbed, opened at `/claim#g=..&t=..&v=1` — no-Piggy path, existing-Piggy path, A-726 fresh device + existing
//   passkey + gift link, fragment secrecy (storage / network / console / DOM / URL).
//   Env: A734_NODE_ONLY=1 skips Part B (prints SKIP, not PASS); A734_BASE_URL reuses a running dev server;
//        A734_PORT overrides 5827; A734_MAIN_PATH / A734_VERCEL_PATH point Parts S/N at a mutant copy (mutation evidence only).
// Network 0 (vite on 127.0.0.1 only) · real passkey 0 · keys 0 · tx 0.
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaimUrl, createClaimLink, parseClaimUrl } from "../src/gift-piggy-claim-link.js";
import { GIFT_ENTRY_STATUS, readClaimFragment } from "../src/gift-claim-entry.js";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)
import { restorePreA1051 } from "./helpers/a1051-restore.mjs"; // [A-1051 RE-PIN] protected-body pins compare pre-A-1051 text

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(process.env.A734_MAIN_PATH || path.join(REPO, "app/src/main.js"), "utf8");
const BEFORE_PATH = privatePath("ops/receipts/A734_gift_open_entry/before/main.js");
const BEFORE = existsSync(BEFORE_PATH) ? readFileSync(BEFORE_PATH, "utf8") : null;
const VERCEL = JSON.parse(readFileSync(process.env.A734_VERCEL_PATH || path.join(REPO, "vercel.json"), "utf8"));
const norm = (x) => JSON.parse(JSON.stringify(x) ?? "null");
const deq = (a, b, msg) => assert.deepEqual(norm(a), norm(b), msg);
let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").slice(0, 8).join("\n      ")}`); fail += 1; }
}
function fnBodyOf(src, name) {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", src.indexOf(")", m.index)); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}
const fnBody = (name) => fnBodyOf(MAIN, name);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };
const CODE = stripComments(MAIN);

// A valid link exactly as the sender side mints it (gift-piggy-claim-link.js — not reimplemented).
function mintLink(origin, giftId) {
  const made = createClaimLink({ giftId, senderAddress: "0x00000000000000000000000000000000000000a1", chainId: "monad-testnet", createdAt: "2026-10-04T00:00:00.000Z" });
  if (!made.ok) throw new Error(`STOP createClaimLink: ${made.reason}`);
  return { token: made.token, url: buildClaimUrl(origin, { giftId, token: made.token }) };
}

// ═══ Part S — static ══════════════════════════════════════════════════════════════════════════
// Catch-all header rule exactly as shipped before A-734 (deploy-headers.mjs owns the semantic contract; this pins bytes).
const EXPECTED_HEADER_RULE = {
  source: "/(.*)",
  headers: [
    // pre-A-859 baseline: connect-src 'self' https://testnet-rpc.monad.xyz;
    { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self' https://testnet-rpc.monad.xyz https://rpc.monad.xyz https://accurate-perception-production-5423.up.railway.app; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'none'; manifest-src 'self'" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Permissions-Policy", value: "publickey-credentials-create=(self), publickey-credentials-get=(self), accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), usb=(), interest-cohort=()" },
  ],
};
// Vercel `source` patterns are path-to-regexp; this file only admits the two forms used here — a literal path and the
// catch-all `/(.*)` — and S1/S2 fail if any other form appears.
const vercelMatch = (source, p) => {
  if (source === "/(.*)") return /^\/(.*)$/.test(p);
  if (/^\/[a-z][a-z0-9]*$/.test(source)) return source === p; // [A-946 RE-PIN] digits allowed after the first letter ("/j2"). pre-A-946: /^\/[a-z]+$/
  throw new Error(`unexpected vercel source form: ${source}`);
};

await check("S1 vercel.json: rewrites /claim and /j2 → /index.html (SPA); nothing rewrites /api/*; root and /?i= stay unrewritten", () => {
  // [A-946 RE-PIN] + /j2 (the shared-fork boot path). pre-A-946: exactly [{ source: "/claim", destination: "/index.html" }]
  deq(VERCEL.rewrites, [{ source: "/claim", destination: "/index.html" }, { source: "/j2", destination: "/index.html" }]);
  for (const p of ["/api/grant", "/api/grant/", "/api", "/", "/index.html", "/assets/x.js", "/claimx", "/claim/x"]) {
    assert.equal(VERCEL.rewrites.some((r) => vercelMatch(r.source, p)), false, `rewrite must not match ${p}`);
  }
  assert.equal(vercelMatch("/claim", "/claim"), true);
  assert.equal(vercelMatch("/j2", "/j2"), true); assert.equal(VERCEL.rewrites.some((r) => vercelMatch(r.source, "/j2/x")), false); // [A-946]
  assert.equal(VERCEL.redirects, undefined, "no redirects (a redirect would drop/expose nothing, but none is needed)");
});
await check("S2 vercel.json: security headers byte-identical to pre-A-734 and the catch-all source matches /claim (headers apply to the rewritten route) and /api/grant", () => {
  deq(VERCEL.headers, [EXPECTED_HEADER_RULE]);
  for (const p of ["/claim", "/api/grant", "/", "/index.html"]) assert.equal(vercelMatch(VERCEL.headers[0].source, p), true, p);
});
await check("S3 vercel.json: /api/grant function config, build/output/install untouched", () => {
  deq({ b: VERCEL.buildCommand, o: VERCEL.outputDirectory, i: VERCEL.installCommand, f: VERCEL.functions },
    { b: "npm run build", o: "dist", i: "npm ci", f: { "api/grant.js": { includeFiles: "relayer/src/policy.mjs" },
      "api/gift-sponsor.js": { maxDuration: 60, includeFiles: "relayer/src/**" }, "api/gift-sponsor-reconcile.js": { maxDuration: 60, includeFiles: "relayer/src/**" } } }); // pre-A-913 baseline: only "api/grant.js"
  deq(Object.keys(VERCEL).sort(), ["buildCommand", "crons", "functions", "headers", "installCommand", "outputDirectory", "rewrites"]); // pre-A-913 baseline: no "crons"
});
await check("S4 claim URL contract: buildClaimUrl → fragment-only identity plus optional display metadata; query never carries it", () => {
  const { token, url } = mintLink("https://arasoo.vercel.app", "gift s4/é");
  assert.match(url, /^https:\/\/arasoo\.vercel\.app\/claim#g=gift%20s4%2F%C3%A9&t=[^&]+&v=1$/);
  const u = new URL(url);
  assert.equal(u.pathname, "/claim");
  assert.equal(u.search, "");
  assert.equal(u.hash.includes(token), true);
  deq(parseClaimUrl(url), { ok: true, giftId: "gift s4/é", token, note: "", amountUsd: null });
  deq(readClaimFragment(`https://x.test/claim?i=tester01${url.slice(url.indexOf("#"))}`), { status: GIFT_ENTRY_STATUS.READY, giftId: "gift s4/é", token, note: "", amountUsd: null }, "?i= + #g coexist");
});
await check("S5 live Gift stays fail-closed: GIFT_RECORD_CONFIG / GIFT_CLAIM_SUBMIT_CONFIG / ISSUANCE_AUTHORITY are null literals; source/submitter derive only from them", () => {
  assert.match(CODE, /^const GIFT_RECORD_CONFIG = null;/m);
  assert.match(CODE, /^const GIFT_CLAIM_SUBMIT_CONFIG = null;/m);
  assert.match(CODE, /^const ISSUANCE_AUTHORITY = null;/m);
  assert.match(CODE, /const GIFT_RECORD_SOURCE = GIFT_RECORD_CONFIG\n\s+\? createGiftRecordSource\(/);
  assert.match(CODE, /const GIFT_CLAIM_SUBMITTER = GIFT_CLAIM_SUBMIT_CONFIG && GIFT_RECORD_CONFIG\n\s+\? createGiftClaimSubmitter\(GIFT_CLAIM_SUBMIT_CONFIG\)\n\s+: null;/);
  assert.equal((CODE.match(/GIFT_RECORD_CONFIG\s*=/g) || []).length, 1, "assigned once");
  assert.equal((CODE.match(/GIFT_CLAIM_SUBMIT_CONFIG\s*=/g) || []).length, 1, "assigned once");
});
// Comment-stripped sha256 prefixes of the pre-A-734 tree (= $ARASO_PRIVATE_BASE/.../before/main.js, app_before.sha b22bec79…).
const PINNED = {
  startPiggyOpen: "a982f3a9f680db89", openPiggy: "974d37202d48b60d",
  recoverPiggy: "9159f2d83c77a8a6", beginGiftPiggy: "456da2932a6d47f4", beginAddPiggy: "64181c00827e6e5b", runModelAAdmission: "bc651294b7e95f27",
  admitAddedPiggy: "7df6b6e87ee3bffd", settleBoundGiftClaim: "2af8e4ff6f54cbc2", stripClaimFragmentFromUrl: "f6fb046b2a3e64c3",
  takePendingGiftClaim: "2c23bd8d2dc551e2", restorePendingGiftClaim: "7ebcc20ee13d1803", knownPiggyAddresses: "b6e3fc976ec22ce6",
  render: "90c49e8703c8e197", setInvitePhase: "fab5e5a04f1269ee", unlockApp: "28db2c0e98b8de1b", settleUnlock: "e61e55dd5cfae86f",
  // [A-1007 RE-PIN] startTesterIntro only: A-995 ③ adds the approved eye binding; every other primitive stays pinned.
  renderAuthCard: "f875d207380637d3", startTesterIntro: "f0e15c6020350860", readTesterInviteParam: "c721a03a8d12a206", stripTesterInviteFromUrl: "2b37487591e69107",
};
await check("S6 auth/recovery/Gift/A-733 primitives outside the explicitly retimed Invite entry are byte-identical (comment-stripped) to the pre-A-734 tree", () => {
  const PRE1051 = restorePreA1051(MAIN); // [A-1051 RE-PIN] pre-A-1051: fnBody(n) on MAIN
  const drift = Object.entries(PINNED).filter(([n, h]) => sha(stripComments(fnBodyOf(PRE1051, n)).replace(/\s*if \(holdInviteAuthPresentation\(\)\) return;/, "")) !== h).map(([n]) => n);
  deq(drift, []);
  const recovery = stripComments(fnBody("checkPiggy"));
  assert.doesNotMatch(recovery, /setScene\("name"/, "existing Piggy recovery never forces Name it");
  assert.match(recovery, /setScene\("sendstay", "Piggy is home\.", "Same place, same Piggy\."\);/);
});
await check("S7 the only UI caller of beginGiftPiggy is openGiftForExistingPiggy; Gift Open starts its branch in the tap call stack", () => {
  const calls = (re) => [...CODE.matchAll(re)].length;
  assert.equal(calls(/(?<!function )\bbeginGiftPiggy\(/g), 1, "one call site");
  assert.ok(stripComments(fnBody("openGiftForExistingPiggy")).includes("await beginGiftPiggy()"));
  assert.equal(calls(/(?<!function )\bstartGiftOpen\(/g), 1);
  assert.match(stripComments(fnBody("openGiftInvite")), /setInvitePhase\("checking"\);\s*return withInviteAuthPresentation\(async \(\) => \{\s*const out = await startGiftOpen\(\);/);
  assert.equal(calls(/(?<!function )\bopenGiftInvite\(/g), 1);
  assert.match(stripComments(fnBody("handleGiftOpenActivate")), /closest\?\.\("#giftOpenButton"\)\) return;\s*openGiftInvite\(\);/);
  assert.match(CODE, /document\.addEventListener\("click", handleGiftOpenActivate\);/);
  assert.equal(calls(/giftOpenButton/g), 2, "markup id + listener selector");
  // the paper never routes a Gift to an existing Piggy: recovery / plain +Piggy still never touch the intent
  for (const n of ["checkPiggy", "recoverPiggy", "beginAddPiggy", "runModelAAdmission"]) {
    for (const bad of ["pendingGiftClaim", "takePendingGiftClaim", "bindGiftToNewPiggy", "settleBoundGiftClaim", "giftPaper"]) assert.equal(stripComments(fnBody(n)).includes(bad), false, `${n} ↛ ${bad}`);
  }
  // [A-897 re-pin · pre-A-897 P1 baseline: 2] a third site = a897GiftOpenPromotion (same-#1 promotion, case 2); openPiggy + beginGiftPiggy unchanged.
  assert.equal(calls(/await settleBoundGiftClaim\(/g), 3, "settle sites: openPiggy + beginGiftPiggy + a897GiftOpenPromotion (same-#1)");
});
await check("S8 new entry code: no storage, no network, no logging, no token/giftId handling, no Hatch, no create", () => {
  const NEW = ["giftPaperKind", "offerGiftPaperAtBoot", "startGiftOpen", "openGiftForExistingPiggy", "openGiftInvite", "handleGiftOpenActivate"].map((n) => stripComments(fnBody(n))).join("\n");
  for (const bad of ["localStorage", "sessionStorage", "indexedDB", "setItem", "removeItem", "fetch(", "XMLHttpRequest", "sendBeacon", "console.", "recordSafeError", ".token", "giftId", "takePendingGiftClaim", "createPasskeyWithPrfOutput", "requestPrf", "openPiggy(", 'setScene("hatch"', "history.", "location."]) {
    assert.equal(NEW.includes(bad), false, `new entry code contains ${bad}`);
  }
  // copy = canon strings only (A-567 'a Piggy for you' / 'a Piggy came for you.'), Open = canon tap name
  const lines = MAIN.match(/const GIFT_PAPER_LINES = \{\n\s+for: \["a Piggy", "for you"\],\n\s+came: \["a Piggy came", "for you\."\],\n\};/);
  assert.ok(lines, "GIFT_PAPER_LINES literal");
  assert.match(stripComments(fnBody("inviteFace")), /\$\{gift \? "Open" : "Face ID"\}/);
});
await check("S9 boot order: fragment read+strip unchanged → A-633 lock → A-733 tester decision → offerGiftPaperAtBoot → first render (tester intro never sees an existing-Piggy device's Gift paper)", () => {
  const at = (s) => { const i = MAIN.indexOf(s); assert.ok(i > 0, s); return i; };
  const order = [
    "if (state.credential && (state.scene === \"name\" || state.scene === \"sendstay\") && appLockSurface()) {",
    "const pendingRead = readClaimFragment(location.href);",
    "testerIntroPending = testerInvite.valid && state.scene === \"received\"",
    "if (offerGiftPaperAtBoot()) homeLifeLeft = !HOME_LIFE_SCENES.includes(state.scene);",
    "\nrender();\nstartTesterIntro();",
  ].map(at);
  deq(order, [...order].sort((a, b) => a - b));
  assert.match(MAIN, /if \(pendingRead\.status === GIFT_ENTRY_STATUS\.READY\) \{\n\s+pendingGiftClaim = \{ giftId: pendingRead\.giftId, token: pendingRead\.token \};\n\s+stripClaimFragmentFromUrl\(\);\n\s+\}/);
  // A-733 block (START..END) carries no Gift symbol
  const block = MAIN.slice(MAIN.indexOf("const TESTER_INTRO_SEEN_KEY"), MAIN.indexOf("// [A-654] A page that opens away from Home"));
  assert.equal(/gift|Gift/.test(stripComments(block)), false);
});

// ═══ Part N — vm over the real main.js text ══════════════════════════════════════════════════
const KEYS = {
  cred: (MAIN.match(/const PASSKEY_STORAGE_KEY = "([^"]+)"/) || [])[1],
  recv: (MAIN.match(/const PIGGY_RECEIVED_KEY = "([^"]+)"/) || [])[1],
  name: (MAIN.match(/const PIGGY_NAME_KEY = "([^"]+)"/) || [])[1],
  birth: (MAIN.match(/const BIRTH_PLAYED_KEY = "([^"]+)"/) || [])[1],
  addr: "araso.address",
  salt: "araso.prfSalt",
};
const WAIT_MS = Number((MAIN.match(/const UNLOCK_UI_WAIT_MS = ([\d_]+);/) || [])[1]?.replace(/_/g, ""));
const FNS = [
  "endSignerSession", "endActiveSession", "touchAppSession", "armSignerExpiry", "activateSigningSession",
  "namedAuthError", "identityStorageKeys", "snapshotIdentity", "restoreIdentity", "commitIdentity",
  "beginAuthAttempt", "boundAuthAttempt", "finishAuthAttempt", "trackPlatformAuth",
  "isCancelledAuthError", "recoverPiggy", "noteRecoverSuccess", "noteRecoverFailure", "openPiggy", "startPiggyOpen", "checkPiggy",
  "hasPlayedBirth", "readPiggyName", "hasReceivedPiggy", "takePendingGiftClaim", "restorePendingGiftClaim",
  "clearInviteTimers", "withInviteAuthPresentation", "playInviteTimelineAfterAuth", "openInvite",
  // A-734 entry (the code under test)
  "giftPaperKind", "offerGiftPaperAtBoot", "startGiftOpen", "openGiftForExistingPiggy", "openGiftInvite",
].map(fnBody).join("\n");
const INVITE_TIMELINE_SRC = (MAIN.match(/const INVITE_TIMELINE = \[[\s\S]*?\];/) || [])[0];
const FRESH_FLAG = /const FRESH_DEVICE_RECOVERY_FIRST = (true|false);/.exec(MAIN)?.[1] === "true";
function meraError(causeName) { const e = new Error("passkey"); e.__mera = true; e.code = "PASSKEY_OPERATION_FAILED"; e.cause = { name: causeName }; return e; }
const key = (n) => new Uint8Array(32).fill(n);
const addrOf = (k) => `0xADDR${k[0]}`;
const GIFT = { giftId: "gift-n", token: "TOKEN-N-SECRET" };

// device: { name, cred } — cred=true seeds an existing local Piggy (credential + address + received).
function device({ name = "", cred = false, scene = "received", gift = GIFT, beginGift = null } = {}) {
  const store = new Map();
  if (name) store.set(KEYS.name, name);
  if (cred) { store.set(KEYS.cred, JSON.stringify({ credentialId: "LOCAL" })); store.set(KEYS.addr, "0xADDR9"); store.set(KEYS.recv, "1"); }
  const calls = { get: [], create: 0, scenes: [], errors: [], bind: [], settle: [], beginGift: 0, logs: [] };
  const pending = { get: [], create: [] };
  let nextTimer = 1; let now = 1_000_000; const timers = new Map();
  const clock = { advance(ms) { const target = now + ms; for (;;) { let pick = null; for (const [id, t] of timers) if (t.at <= target && (!pick || t.at < pick[1].at)) pick = [id, t]; if (!pick) break; timers.delete(pick[0]); now = pick[1].at; pick[1].fn(); } now = target; } };
  const board = { dataset: { phase: "closed" } };
  const ctx = {
    console: { log: (...a) => calls.logs.push(a), warn: (...a) => calls.logs.push(a), error: (...a) => calls.logs.push(a), info: (...a) => calls.logs.push(a) },
    Uint8Array, JSON, Promise, Error, Map, Set, String,
    Date: { now: () => now },
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    document: { querySelector: (sel) => (sel === ".invite" && ctx.state.scene === "received" ? board : null) },
    setInvitePhase: (phase) => { board.dataset.phase = phase; },
    PASSKEY_STORAGE_KEY: KEYS.cred, PIGGY_RECEIVED_KEY: KEYS.recv, PIGGY_NAME_KEY: KEYS.name, BIRTH_PLAYED_KEY: KEYS.birth,
    UNLOCK_UI_WAIT_MS: WAIT_MS, FRESH_DEVICE_RECOVERY_FIRST: FRESH_FLAG, INDEX_BACKUP_ADAPTER: null,
    GIFT_ENTRY_STATUS: { REFUSED: "refused" },
    state: {
      scene, message: "", detail: "", authPhase: "idle", authCancelled: false,
      credential: cred ? { credentialId: "LOCAL" } : null, address: cred ? "0xADDR9" : "", activeSignerAddress: "", recoverFailures: 0, noPiggy: false,
      freshRecoveryTried: false, appLock: null, addPiggy: null,
    },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } },
    isMeraError: (e) => !!e && e.__mera === true,
    isAllowedPiggyRpId: () => true,
    webAuthnUnsupported: () => false,
    storedPrfSalt: () => null,
    getRpId: () => "localhost",
    localTestWebAuthnOption: () => ({}),
    localTestPrfSaltOption: () => ({}),
    toHex: (b) => Buffer.from(b).toString("hex"),
    requestPrf: (credential) => new Promise((resolve, reject) => { calls.get.push(credential); pending.get.push({ resolve, reject }); }),
    createPasskeyWithPrfOutput: () => { calls.create += 1; return new Promise((resolve, reject) => { pending.create.push({ resolve, reject }); }); },
    createSecp256k1SigningSession: ({ privateKey }) => ({ publicKey: new Uint8Array(privateKey), end() {} }),
    toViemAccount: (s) => ({ address: addrOf(s.publicKey) }),
    getEvmAddress: (pk) => addrOf(pk),
    indexControlledPiggy: () => ({ ok: true }),
    setScene: (s, message = "", detail = "") => {
      calls.scenes.push([s, message, detail]);
      Object.assign(ctx.state, { scene: s, message, detail });
      if (s === "received") board.dataset.phase = "closed";
    },
    finishHatch: () => { calls.scenes.push(["finishHatch"]); },
    knownPiggyAddresses: () => new Set(ctx.state.address ? [ctx.state.address.toLowerCase()] : []),
    bindGiftToNewPiggy: (args) => { calls.bind.push({ giftId: args.intent?.giftId, address: args.piggy?.address, pre: [...args.preExistingAddresses] }); return { ok: true, binding: { giftId: args.intent.giftId, recipientAddress: args.piggy.address } }; },
    // product default: no record source → the real settle stops at record_source_unavailable (gift-product-entry §9 proves the real one)
    settleBoundGiftClaim: async (binding, claim) => { calls.settle.push({ to: binding.recipientAddress, giftId: claim.giftId }); return { status: "record_source_unavailable" }; },
    beginGiftPiggy: async () => { calls.beginGift += 1; return beginGift ? beginGift(ctx) : { started: false, reason: "record_source_unavailable" }; },
    recordSafeError: (phase, e) => { calls.errors.push([phase, e?.name]); },
    readCredential: () => { try { return JSON.parse(store.get(KEYS.cred) || "null"); } catch { return null; } },
    lockAppAfterIdle: () => false,
  };
  vm.createContext(ctx);
  vm.runInContext(`let activeSession = null; let activeAccount = null; let idleTimer = null; let signerExpiryTimer = null; let authAttempt = null;
let platformAuthInflight = null; let lateCreatedCredential = null; let bornPiggyPending = null; let inviteTimers = []; let inviteAuthPresentation = false; let lastGiftClaimSettlement = null;
let pendingGiftClaim = null; let giftPaperOffered = false; let giftOpenRunning = false;
${INVITE_TIMELINE_SRC}
${FNS}
this.api = { startPiggyOpen, startGiftOpen, openGiftForExistingPiggy, offerGiftPaperAtBoot, giftPaperKind, openGiftInvite, openInvite, hasPlayedBirth,
  setPending: (p) => { pendingGiftClaim = p; }, pending: () => pendingGiftClaim, offered: () => giftPaperOffered };`, ctx);
  if (gift) ctx.api.setPending({ ...gift });
  const markers = () => Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, store.has(v)]));
  // the explicit Open tap on the Gift paper starts its real branch immediately.
  const tapGiftOpen = async () => { ctx.api.openGiftInvite(); await flush(); };
  ctx.clock = clock;
  return { ctx, store, calls, pending, clock, board, state: ctx.state, api: ctx.api, markers, tapGiftOpen };
}
const trace = (d) => d.calls.scenes.map((s) => s[0]).join(">");

await check("N1 boot: markerless device + Gift link → the first Invite IS the Gift paper ('for'); no WebAuthn, no scene change", async () => {
  const d = device();
  assert.equal(d.api.offerGiftPaperAtBoot(), true);
  assert.equal(d.state.scene, "received");
  assert.equal(d.api.giftPaperKind(), "for");
  deq([d.calls.get.length, d.calls.create, d.calls.scenes.length], [0, 0, 0]);
});
await check("N2 boot: existing-Piggy device with Home destination → 'came' paper; lock (A-633) is left exactly as set; Name/Away/birth destinations and no-Gift boots are untouched", async () => {
  const d = device({ cred: true, scene: "sendstay", name: "Honeybun" });
  d.state.appLock = { phase: "waiting", cancelled: false };
  assert.equal(d.api.offerGiftPaperAtBoot(), true);
  deq([d.state.scene, d.api.giftPaperKind(), d.state.appLock], ["received", "came", { phase: "waiting", cancelled: false }]);
  for (const scene of ["name", "away", "birth", "explore"]) {
    const o = device({ cred: true, scene });
    assert.equal(o.api.offerGiftPaperAtBoot(), false, scene);
    deq([o.state.scene, o.api.giftPaperKind()], [scene, null]);
  }
  const none = device({ gift: null });
  assert.equal(none.api.offerGiftPaperAtBoot(), false);
  assert.equal(none.api.giftPaperKind(), null);
});
await check("N3 no-Piggy path (genuine new user): Gift Open → find-first looks only (A-533) → Make new → same Gift paper → Open → ONE create, the Gift intent is taken at start and bound to the NEW address → Hatch", async () => {
  const d = device();
  d.api.offerGiftPaperAtBoot();
  await d.tapGiftOpen();
  deq({ get: d.calls.get, create: d.calls.create }, { get: [null], create: 0 }, "first Open = one discoverable get");
  d.pending.get[0].reject(meraError("NotAllowedError"));
  await flush();
  deq(d.calls.scenes.at(-1).slice(0, 2), ["birth", "Chog could not find Piggy here."]);
  assert.equal(d.api.pending()?.token, GIFT.token, "intent untouched by the failed look");
  d.ctx.setScene("received", "", "");               // Make new (#authTryAgainButton) → Invite
  assert.equal(d.api.giftPaperKind(), "for", "the same Gift paper comes back");
  await d.tapGiftOpen();
  deq({ get: d.calls.get.length, create: d.calls.create }, { get: 1, create: 1 }, "explicit second Open creates");
  assert.equal(d.api.pending(), null, "intent taken at the START of the creating flow");
  d.pending.create[0].resolve({ credentialId: "NEW", transports: ["internal"], prfOutput: key(55), prfSalt: key(2) });
  await flush();
  assert.equal(d.state.scene, "received", "successful create precedes the preserved Invite timeline");
  d.clock.advance(5900); await flush();
  deq(d.calls.bind, [{ giftId: "gift-n", address: "0xADDR55", pre: [] }], "bound to exactly the new address");
  deq(d.calls.settle, [{ to: "0xADDR55", giftId: "gift-n" }]);
  assert.equal(d.calls.scenes.at(-1)[0], "hatch", trace(d));
  assert.equal(d.calls.beginGift, 0);
  assert.equal(d.api.giftPaperKind(), null, "paper gone once the intent is consumed");
});
await check("N4 [A-726 × Gift] markerless device + EXISTING passkey + Gift link, name present: first Gift Open = recovery only (get 1 · create 0 · no Hatch · intent NOT consumed/bound) → 'a Piggy came for you.' → second Open → new Gift Piggy flow (beginGiftPiggy), still create 0", async () => {
  const d = device({ name: "Honeybun", beginGift: (ctx) => { ctx.setScene("name", "", ""); return { started: true, piggyId: "piggy-new", giftAttempted: true }; } });
  d.api.offerGiftPaperAtBoot();
  await d.tapGiftOpen();
  d.pending.get[0].resolve({ credentialId: "EXISTING", prfOutput: key(44) });
  await flush();
  assert.equal(d.state.scene, "received", "recovered Piggy replays the existing Gift paper timeline");
  d.clock.advance(5900); await flush();
  deq({ get: d.calls.get.length, create: d.calls.create }, { get: 1, create: 0 });
  assert.equal(d.calls.scenes.some((s) => s[0] === "hatch" || s[0] === "finishHatch"), false, trace(d));
  assert.equal(d.calls.scenes.some((s) => s[0] === "sendstay" && s[1] === "Piggy is home."), true, trace(d));
  assert.equal(d.calls.scenes.at(-1)[0], "received", trace(d));
  deq([d.calls.bind.length, d.calls.settle.length, d.calls.beginGift], [0, 0, 0], "recovery never binds/settles the Gift");
  assert.equal(d.api.pending()?.token, GIFT.token);
  assert.equal(d.api.giftPaperKind(), "came");
  assert.equal(d.store.has(KEYS.birth), false);
  await d.tapGiftOpen();
  deq({ get: d.calls.get.length, create: d.calls.create, beginGift: d.calls.beginGift }, { get: 1, create: 0, beginGift: 1 });
  d.clock.advance(5900); await flush();
  assert.equal(d.calls.scenes.at(-1)[0], "name");
  assert.equal(d.api.offered(), false);
  assert.equal(d.calls.scenes.some((s) => s[0] === "hatch"), false);
});
await check("N5 [A-726 × Gift] no name: recovery never forces Name/Hatch; Gift remains pending and returns as the same-Piggy paper", async () => {
  const d = device();
  d.api.offerGiftPaperAtBoot();
  await d.tapGiftOpen();
  d.pending.get[0].resolve({ credentialId: "EXISTING", prfOutput: key(44) });
  await flush();
  d.clock.advance(5900); await flush();
  assert.equal(d.calls.scenes.some((s) => s[0] === "name" || s[0] === "hatch"), false, trace(d));
  assert.equal(d.calls.scenes.at(-1)[0], "received", trace(d));
  deq([d.calls.create, d.calls.bind.length, d.calls.settle.length, d.calls.beginGift], [0, 0, 0, 0]);
  assert.equal(d.api.pending()?.token, GIFT.token);
});
await check("N6 [A-726 × Gift] cancel/failure on the first Gift Open of a markerless device: failure card, create 0 on that tap, no marker written, intent kept", async () => {
  for (const err of [meraError("NotAllowedError"), Object.assign(new Error("x"), { name: "UnknownError" })]) {
    const d = device();
    d.api.offerGiftPaperAtBoot();
    await d.tapGiftOpen();
    d.pending.get[0].reject(err);
    await flush();
    deq({ get: d.calls.get.length, create: d.calls.create }, { get: 1, create: 0 });
    deq(d.calls.scenes.at(-1).slice(0, 2), ["birth", "Chog could not find Piggy here."]);
    deq(d.markers(), { cred: false, recv: false, name: false, birth: false, addr: false, salt: false });
    assert.equal(d.api.pending()?.token, GIFT.token);
  }
});
await check("N7 existing-Piggy path: Open → beginGiftPiggy only (startPiggyOpen/checkPiggy/openPiggy never run → no get/create from this entry); success → new Piggy's Name, paper retired", async () => {
  const d = device({ cred: true, scene: "sendstay", name: "Honeybun", beginGift: (ctx) => { ctx.setScene("name", "", ""); return { started: true, piggyId: "piggy-gift", giftAttempted: true }; } });
  d.api.offerGiftPaperAtBoot();
  await d.tapGiftOpen();
  d.clock.advance(5900); await flush();
  deq({ get: d.calls.get.length, create: d.calls.create, beginGift: d.calls.beginGift }, { get: 0, create: 0, beginGift: 1 });
  assert.equal(d.calls.scenes.at(-1)[0], "name", trace(d));
  assert.equal(d.calls.scenes.some((s) => s[0] === "received"), true, "existing Invite art replayed after auth");
  assert.equal(d.api.offered(), false);
});
await check("N8 existing-Piggy path, product default (live claim null → record_source_unavailable BEFORE auth): Home, paper retired, no new Piggy, no success copy", async () => {
  const d = device({ cred: true, scene: "sendstay", name: "Honeybun" });
  d.api.offerGiftPaperAtBoot();
  await d.tapGiftOpen();
  deq({ get: d.calls.get.length, create: d.calls.create, beginGift: d.calls.beginGift }, { get: 0, create: 0, beginGift: 1 });
  deq(d.calls.scenes, [["sendstay", "Piggy is home.", ""]]);
  deq([d.api.offered(), d.api.giftPaperKind()], [false, null]);
  assert.equal(d.api.pending()?.token, GIFT.token, "beginGiftPiggy keeps the intent in memory (unchanged A-579 behaviour)");
});
await check("N9 existing-Piggy path, auth cancelled inside the admission (intent restored): back to the same 'came' paper for an explicit retry — no auto retry", async () => {
  const d = device({ cred: true, scene: "sendstay", beginGift: (ctx) => { ctx.state.addPiggy = { status: "failed", reason: "cancelled" }; return { started: false, reason: "cancelled" }; } });
  d.api.offerGiftPaperAtBoot();
  await d.tapGiftOpen();
  deq(d.calls.scenes, [["received", "", ""]]);
  assert.equal(d.api.giftPaperKind(), "came");
  assert.equal(d.calls.beginGift, 1);
  d.clock.advance(60_000); await flush();
  assert.equal(d.calls.beginGift, 1, "no automatic second attempt");
});
await check("N10 double tap: the envelope only opens from 'closed' and a running Gift admission is not re-entered", async () => {
  let release;
  const d = device({ cred: true, scene: "sendstay", beginGift: () => new Promise((r) => { release = r; }) });
  d.api.offerGiftPaperAtBoot();
  d.api.openGiftInvite(); d.api.openGiftInvite();
  await flush();
  assert.equal(d.calls.beginGift, 1);
  deq(await d.api.openGiftForExistingPiggy(), { started: false, reason: "already_running" });
  release({ started: false, reason: "record_source_unavailable" }); await flush();
  assert.equal(d.calls.beginGift, 1);
});
await check("N11 the new entry never logs (console 0) and never writes storage on any path above", async () => {
  const d = device({ cred: true, scene: "sendstay" });
  const before = JSON.stringify([...d.store]);
  d.api.offerGiftPaperAtBoot(); await d.tapGiftOpen();
  assert.equal(JSON.stringify([...d.store]), before);
  deq(d.calls.logs, []);
});

// ── the REAL Invite markup functions ──────────────────────────────────────────────────────────
function markupWith(src, { kind = "mobile", gift = null, cred = false } = {}) {
  const fns = ["inviteHero", "inviteFace", "inviteHoles", ...(/function trialPhaseStamp\(/.test(src) ? ["trialPhaseStamp"] : []), ...(/function inviteExplanation\(/.test(src) ? ["inviteExplanation"] : []), "inviteMobile", "inviteWide", "renderReceived"].map((n) => fnBodyOf(src, n)).join("\n");
  const hasGiftFns = /function giftPaperKind\(/.test(src);
  const ctx = {
    INVITE_EGG_SVG: "<svg data-egg></svg>", arasoBrandMarkup: () => "<i data-brand></i>", chogInviteMarkup: () => "<i data-chog></i>", wantedInviteKind: () => kind,
    readCredential: () => (cred ? { credentialId: "X" } : null), hasReceivedPiggy: () => cred, state: { address: cred ? "0x1" : "" }, Array,
  };
  vm.createContext(ctx);
  vm.runInContext(`let inviteKind = null; let pendingGiftClaim = ${gift ? JSON.stringify(gift) : "null"}; let giftPaperOffered = ${gift ? "true" : "false"};
${hasGiftFns ? (MAIN.match(/const GIFT_PAPER_LINES = \{[\s\S]*?\n\};/) || [])[0] + "\n" + fnBodyOf(src, "giftPaperKind") : ""}
${fns}
this.out = renderReceived();`, ctx);
  return ctx.out;
}
await check("N12 no Gift: the Invite markup (mobile + wide) is byte-identical to the pre-A-734 renderReceived", () => {
  for (const kind of ["mobile", "wide"]) {
    const now = markupWith(MAIN, { kind });
    assert.ok(now.includes('id="inviteFaceButton"') && now.includes("something small") && now.includes("just for you") && !now.includes("giftOpenButton") && !now.includes("data-gift-paper"));
    // pre-A-912 baseline: assert.equal(now, markupWith(BEFORE, { kind }), kind). [A-912 re-pin, Cowork-approved] A-912 removes the mobile Invite line `it's safe. only you can open it.` (invite__copy); that one line is removed from the pre-A-734 side.
    if (BEFORE) assert.equal(now, markupWith(BEFORE, { kind }).replace(/\n\s*<p class="invite__copy">it's safe\. only you can open it\.<\/p>/, ""), kind);
  }
  if (!BEFORE) console.log("      note N12: pre-A-734 snapshot absent (public checkout) — content checks only");
});
await check("N13 Gift papers: same Invite board, canon copy only ('a Piggy for you' / 'a Piggy came for you.'), button 'Open' (#giftOpenButton, same .invite__face shell); no token/giftId; nothing to pick an existing Piggy with", () => {
  const gift = { giftId: "gift-secret-id-77", token: "TOKEN-SECRET-77" };
  for (const kind of ["mobile", "wide"]) {
    for (const [cred, want, l1, l2] of [[false, "for", "a Piggy", "for you"], [true, "came", "a Piggy came", "for you."]]) {
      const m = markupWith(MAIN, { kind, gift, cred });
      assert.ok(m.includes(`data-gift-paper="${want}"`), `${kind}/${want}`);
      assert.ok(m.includes(`<span class="invite__line1">${l1}</span>`) && m.includes(`<span class="invite__line2">${l2}</span>`));
      assert.ok(m.includes('<button class="invite__face" id="giftOpenButton">') && m.includes('<span class="invite__faceLabel">Open</span>'));
      assert.equal(m.includes("inviteFaceButton"), false);
      for (const bad of [gift.token, gift.giftId, "<select", "radio", "checkbox", "homePaper", "piggyList", "data-piggy-id", "Honeybun", "Mochi"]) assert.equal(m.includes(bad), false, `${kind}/${want} contains ${bad}`);
      // the rest of the board is the plain Invite with only the two hand lines + button id/label swapped
      // A-1224 explicitly adds this copy to ordinary invites only; Gift keeps its original board.
      assert.equal(m.includes('invite__explain'), false);
      const plain = markupWith(MAIN, { kind }).replace('<p class="invite__explain">Your Piggy keeps your money.<br>Tap Face ID. It hatches!</p>', '');
      const swap = (s) => s.replace(/data-gift-paper="\w+"/, "").replace(/<span class="invite__line1">[^<]*<\/span>/, "L1").replace(/<span class="invite__line2">[^<]*<\/span>/, "L2").replace(/id="(giftOpenButton|inviteFaceButton)"/, "ID").replace(/<span class="invite__faceLabel">[^<]*<\/span>/, "LBL").replace(/"\s*>/, '">');
      assert.equal(swap(m).replace(/\s+/g, " "), swap(plain).replace(/\s+/g, " "), `${kind}/${want}: no other markup difference`);
    }
  }
});

console.log(`\nPart S+N: ${pass}/${pass + fail} PASS`);

// ═══ Part B — the real app in Chromium ═══════════════════════════════════════════════════════
const PORT = Number(process.env.A734_PORT || 5827);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AUTH_OPTS = { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true };
const INIT = `(() => {
  const wa = window.__wa = { create: 0, get: 0, mode: "pass", scenes: [], getOpts: [] };
  const c = navigator.credentials;
  if (c) {
    const oc = c.create.bind(c), og = c.get.bind(c);
    c.create = (o) => { wa.create++; return oc(o); };
    c.get = (o) => {
      wa.get++;
      wa.getOpts.push({ allow: (o && o.publicKey && o.publicKey.allowCredentials || []).length });
      if (wa.mode === "reject") return Promise.reject(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"));
      return og(o);
    };
  }
  const seen = () => document.querySelectorAll("[data-scene]").forEach((el) => {
    const s = el.dataset.scene + (el.dataset.giftPaper ? ":" + el.dataset.giftPaper : "");
    if (wa.scenes[wa.scenes.length - 1] !== s) wa.scenes.push(s);
  });
  new MutationObserver(seen).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-scene", "data-gift-paper"] });
})();`;

async function runBrowser() {
  if (!existsSync(privatePath())) { console.log("SKIP  Part B — local browser harness absent (public checkout)"); return; }
  let chromium;
  try { ({ chromium } = createRequire(privatePath("ops/harness/package.json"))("playwright")); }
  catch (e) { await check("B0 playwright available (private harness)", () => { throw e; }); return; }
  let server = null;
  let BASE = process.env.A734_BASE_URL || "";
  if (!BASE) {
    server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", String(PORT), "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let errText = "";
    server.stderr.on("data", (d) => { errText += String(d); });
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("vite start timeout")), 20000);
        server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
        server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
      });
    } catch (e) {
      await check(`B0 vite dev server on 127.0.0.1:${PORT}`, () => { throw new Error(`${e.message}\n${errText.split("\n").slice(0, 4).join("\n")}`); });
      server.kill("SIGTERM");
      return;
    }
    BASE = `http://localhost:${PORT}/`;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    await giftJourney(browser, BASE);
    await freshDeviceExistingPasskeyWithGift(browser, BASE);
    await plainAndMalformed(browser, BASE);
    await mobileLockFirst(browser, BASE);
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

async function newDevice(browser, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(INIT);
  const p = await context.newPage();
  const errors = []; const consoleText = []; const net = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => consoleText.push(m.text()));
  p.on("request", (r) => net.push(`${r.method()} ${r.url()} ${r.postData() || ""}`));
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTH_OPTS });
  return { context, p, cdp, authenticatorId, errors, consoleText, net };
}
const sceneOf = (p) => p.evaluate(() => { const el = document.querySelector("[data-scene]"); return el ? el.dataset.scene + (el.dataset.giftPaper ? ":" + el.dataset.giftPaper : "") : null; });
const waOf = (p) => p.evaluate(() => ({ get: window.__wa.get, create: window.__wa.create, scenes: [...window.__wa.scenes], getOpts: window.__wa.getOpts }));
async function waitScene(p, want, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await sceneOf(p).catch(() => null);
    if (want.includes(s) && (s !== "birth" || await p.locator("#authTryAgainButton, #checkButton").count())) return s;
    await sleep(150);
  }
  return `TIMEOUT:${await sceneOf(p).catch(() => null)}`;
}
async function nameAndHome(p, name) {
  for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
    const v = await p.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden && getComputedStyle(e).visibility !== "hidden"; }; return { input: vis("#piggyNameInput"), ok: vis(".nameCard__okBtn") }; });
    if (v.input) break;
    if (v.ok) { await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(900); continue; }
    await sleep(300);
  }
  await p.locator("#piggyNameInput").fill(name); await sleep(150);
  await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
  for (let t0 = Date.now(); Date.now() - t0 < 12000; await sleep(200)) if ((await sceneOf(p)) === "sendstay") break;
  return sceneOf(p);
}
async function secrecy(d, token, giftId, label) {
  const dump = await d.p.evaluate(async () => {
    const all = (s) => { const o = {}; for (let i = 0; i < s.length; i += 1) { const k = s.key(i); o[k] = s.getItem(k); } return o; };
    let idb = [];
    try { idb = (await indexedDB.databases()).map((x) => x.name); } catch {}
    return { ls: all(localStorage), ss: all(sessionStorage), idb, href: location.href, hist: history.length, html: document.documentElement.outerHTML };
  });
  const cookies = JSON.stringify(await d.context.cookies());
  const where = [];
  const scan = (name, text) => { if (String(text).includes(token)) where.push(name); };
  scan("localStorage", JSON.stringify(dump.ls)); scan("sessionStorage", JSON.stringify(dump.ss)); scan("indexedDB names", JSON.stringify(dump.idb));
  scan("cookies", cookies); scan("location.href", dump.href); scan("DOM", dump.html);
  scan("console", d.consoleText.join("\n"));
  // the ONLY network request allowed to carry the fragment is none: a browser never sends #… — check every URL/body
  scan("network", d.net.join("\n"));
  deq(where, [], `${label}: raw token found in ${where.join(", ")}`);
  assert.equal(dump.href.includes("#"), false, `${label}: fragment stripped from the address bar (${dump.href.replace(token, "<token>")})`);
  assert.equal(JSON.stringify(dump.ls).includes(giftId), false, `${label}: giftId not persisted`);
  return dump;
}

async function giftJourney(browser, BASE) {
  const origin = new URL(BASE).origin;
  const g1 = mintLink(origin, "gift-b1-first");
  const g2 = mintLink(origin, "gift-b2-existing");
  const d = await newDevice(browser);
  let created = null;
  await check("B1 no-Piggy path at /claim#g=..&t=..&v=1: SPA served, fragment stripped (path /claim kept), 'a Piggy for you' paper → Open → find-first look → Make new → same paper → Open → ONE create → Hatch → Name → Home; token nowhere", async () => {
    await d.p.goto(g1.url, { waitUntil: "networkidle" });
    assert.equal(new URL(d.p.url()).pathname, "/claim");
    await d.p.waitForSelector("#giftOpenButton", { timeout: 15000 });
    assert.equal(await sceneOf(d.p), "received:for");
    const copy = await d.p.evaluate(() => ({ l1: document.querySelector(".invite__line1").textContent, l2: document.querySelector(".invite__line2").textContent, btn: document.querySelector("#giftOpenButton .invite__faceLabel").textContent, plain: !!document.querySelector("#inviteFaceButton") }));
    deq(copy, { l1: "a Piggy", l2: "for you", btn: "Open", plain: false });
    await secrecy(d, g1.token, "gift-b1-first", "B1 after boot");
    deq([(await waOf(d.p)).get, (await waOf(d.p)).create], [0, 0], "no WebAuthn on load");
    await d.p.locator("#giftOpenButton").click();
    const first = await waitScene(d.p, ["birth", "hatch", "name", "sendstay"], 30000);
    assert.equal(first, "birth", `trace ${(await waOf(d.p)).scenes.join(">")}`);
    deq([(await waOf(d.p)).get, (await waOf(d.p)).create], [1, 0], "first Open only looks (A-533 find-first)");
    await d.p.locator("#authTryAgainButton").click();
    await d.p.waitForSelector("#giftOpenButton", { timeout: 15000 });
    assert.equal(await sceneOf(d.p), "received:for", "Make new returns to the same Gift paper");
    await d.p.locator("#giftOpenButton").click();
    const second = await waitScene(d.p, ["hatch", "name", "birth"], 30000);
    const w = await waOf(d.p);
    assert.ok(["hatch", "name"].includes(second) && w.scenes.includes("hatch"), `Hatch rendered; trace ${w.scenes.join(">")}`);
    deq([w.get, w.create], [1, 1], "exactly one create, on the explicit Open");
    assert.equal(await nameAndHome(d.p, "Honeybun"), "sendstay");
    created = await d.p.evaluate(() => localStorage.getItem("araso.address"));
    assert.match(String(created), /^0x[0-9a-fA-F]{40}$/);
    await secrecy(d, g1.token, "gift-b1-first", "B1 at Home");
    deq(d.errors, [], "pageerror 0");
  });
  await check("B2 existing-Piggy path (same device, second link): 'a Piggy came for you.' → Open → live claim is config-null → refused BEFORE auth → Home; WebAuthn 0, no new Piggy, first Piggy unchanged, nothing to pick; token nowhere", async () => {
    assert.ok(created, "B1 must have created the first Piggy");
    // A link opened from Messages/Mail is a NEW document load. Without about:blank first, goto(/claim#…) from the already
    // stripped `/claim` URL is a same-document fragment navigation (no reload → boot never runs) — a harness artifact
    // (first coordinator browser run: B2 timeout), see WRITER_NOTES "same-tab fragment navigation".
    await d.p.goto("about:blank");
    await d.p.goto(g2.url, { waitUntil: "networkidle" });
    const wBoot = await waOf(d.p);
    deq([wBoot.get, wBoot.create], [0, 0], "desktop returning device: no lock, no WebAuthn on load");
    await d.p.waitForSelector("#giftOpenButton", { timeout: 15000 });
    assert.equal(await sceneOf(d.p), "received:came");
    const paper = await d.p.evaluate(() => ({
      l1: document.querySelector(".invite__line1").textContent, l2: document.querySelector(".invite__line2").textContent,
      btn: document.querySelector("#giftOpenButton .invite__faceLabel").textContent,
      pickers: document.querySelectorAll("select, input[type=radio], input[type=checkbox], [data-piggy-id], .homePaper").length,
      text: document.body.innerText,
    }));
    deq({ l1: paper.l1, l2: paper.l2, btn: paper.btn, pickers: paper.pickers }, { l1: "a Piggy came", l2: "for you.", btn: "Open", pickers: 0 });
    assert.equal(paper.text.includes("Honeybun"), false, "the existing Piggy is not offered on the paper");
    await secrecy(d, g2.token, "gift-b2-existing", "B2 after boot");
    const ls0 = await d.p.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
    await d.p.locator("#giftOpenButton").click();
    const landed = await waitScene(d.p, ["sendstay", "name", "birth"], 20000);
    await sleep(1500);
    const w = await waOf(d.p);
    assert.equal(landed, "sendstay", `trace ${w.scenes.join(">")}`);
    deq([w.get, w.create], [0, 0], "refused before any WebAuthn (record_source_unavailable)");
    assert.equal(await d.p.evaluate(() => localStorage.getItem("araso.address")), created, "first Piggy unchanged");
    const ls1 = await d.p.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
    assert.equal(ls1, ls0, "no storage write at all from the refused Gift Open");
    assert.equal(w.scenes.includes("hatch"), false);
    await secrecy(d, g2.token, "gift-b2-existing", "B2 at Home");
    deq(d.errors, [], "pageerror 0");
  });
  await d.context.close();
}

async function freshDeviceExistingPasskeyWithGift(browser, BASE) {
  await check("B3 [A-726 × Gift] fresh profile + existing discoverable passkey + Gift link: 'a Piggy for you' → Open → ONE discoverable get, create 0, NO Hatch → same Piggy at Home → 'a Piggy came for you.' → Open → refused before auth (config-null) → Home; create 0 throughout", async () => {
    const d = await newDevice(browser);
    // mint the existing passkey through the plain new-user flow (no Gift), then wipe every app store (= fresh device)
    await d.p.goto(BASE, { waitUntil: "networkidle" });
    await d.p.waitForSelector("#inviteFaceButton", { timeout: 15000 });
    await d.p.locator("#inviteFaceButton").click();
    assert.equal(await waitScene(d.p, ["birth", "hatch", "name"], 30000), "birth");
    await d.p.locator("#authTryAgainButton").click();
    await d.p.waitForSelector("#inviteFaceButton", { timeout: 15000 });
    await d.p.locator("#inviteFaceButton").click();
    assert.ok(["hatch", "name"].includes(await waitScene(d.p, ["hatch", "name", "birth"], 30000)));
    const address = await d.p.evaluate(() => localStorage.getItem("araso.address"));
    await d.p.goto("about:blank");
    await d.cdp.send("Storage.clearDataForOrigin", { origin: new URL(BASE).origin, storageTypes: "all" });
    await d.p.goto(BASE, { waitUntil: "networkidle" });
    await d.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem("araso.piggyName", "Honeybun"); });
    const g = mintLink(new URL(BASE).origin, "gift-b3-fresh");
    await d.p.goto("about:blank");
    await d.p.goto(g.url, { waitUntil: "networkidle" });
    await d.p.waitForSelector("#giftOpenButton", { timeout: 15000 });
    assert.equal(await sceneOf(d.p), "received:for");
    const w0 = await waOf(d.p);
    deq([w0.get, w0.create], [0, 0]);
    await d.p.locator("#giftOpenButton").click();
    const landed = await waitScene(d.p, ["received:came", "sendstay", "name", "hatch", "birth"], 30000);
    const w1 = await waOf(d.p);
    assert.equal(landed, "received:came", `trace ${w1.scenes.join(">")}`);
    deq([w1.get, w1.create], [1, 0], "recovery only");
    deq(w1.getOpts, [{ allow: 0 }], "discoverable request");
    assert.equal(w1.scenes.includes("hatch"), false, `no Hatch: ${w1.scenes.join(">")}`);
    assert.equal((await d.p.evaluate(() => localStorage.getItem("araso.address"))).toLowerCase(), address.toLowerCase(), "same Piggy");
    assert.equal(await d.p.evaluate(() => localStorage.getItem("araso.birthPlayed")), null);
    await d.p.waitForFunction(() => document.querySelector(".invite")?.dataset.phase === "closed", null, { timeout: 10000 });
    await d.p.locator("#giftOpenButton").click();
    const home = await waitScene(d.p, ["sendstay", "name", "birth"], 20000);
    const w2 = await waOf(d.p);
    assert.equal(home, "sendstay", `trace ${w2.scenes.join(">")}`);
    deq([w2.get, w2.create], [1, 0], "config-null Gift refused before auth; still no create");
    assert.equal(w2.scenes.includes("hatch"), false);
    await secrecy(d, g.token, "gift-b3-fresh", "B3");
    deq(d.errors, [], "pageerror 0");
    await d.context.close();
  });
}

async function plainAndMalformed(browser, BASE) {
  await check("B4 /claim without a fragment = plain Invite (SPA, no Gift paper); a malformed fragment is ignored and left as-is (existing rule); / unchanged", async () => {
    const d = await newDevice(browser);
    for (const [url, keepHash] of [[`${BASE}claim`, false], [`${BASE}claim#g=x&t=short&v=1`, true], [BASE, false]]) {
      await d.p.goto(url, { waitUntil: "networkidle" });
      await d.p.waitForSelector("#inviteFaceButton", { timeout: 15000 });
      assert.equal(await sceneOf(d.p), "received", url);
      assert.equal(await d.p.locator("#giftOpenButton").count(), 0);
      deq(await d.p.evaluate(() => [document.querySelector(".invite__line1").textContent, document.querySelector(".invite__line2").textContent]), ["something small", "just for you"]);
      assert.equal(d.p.url().includes("#"), keepHash, url);
    }
    deq(d.errors, [], "pageerror 0");
    await d.context.close();
  });
}

async function mobileLockFirst(browser, BASE) {
  await check("B5 phone width, existing Piggy + Gift link: the A-633 lock still comes first (no Gift paper, no WebAuthn on load) → existing unlock (1 pinned get) → 'a Piggy came for you.' → Open → refused before auth → Home; create 0, no new Piggy; token nowhere", async () => {
    const d = await newDevice(browser, { width: 390, height: 844 });
    await d.p.goto(BASE, { waitUntil: "networkidle" });
    await d.p.waitForSelector("#inviteFaceButton", { timeout: 15000 });
    await d.p.locator("#inviteFaceButton").click();
    assert.equal(await waitScene(d.p, ["birth", "hatch", "name"], 30000), "birth");
    await d.p.locator("#authTryAgainButton").click();
    await d.p.waitForSelector("#inviteFaceButton", { timeout: 15000 });
    await d.p.locator("#inviteFaceButton").click();
    await waitScene(d.p, ["hatch", "name"], 30000);
    assert.equal(await nameAndHome(d.p, "Mochi"), "sendstay");
    const g = mintLink(new URL(BASE).origin, "gift-b5-lock");
    await d.p.goto("about:blank");
    await d.p.goto(g.url, { waitUntil: "networkidle" });
    await sleep(800);
    const s = await d.p.evaluate(() => ({ lock: !!document.querySelector("[data-app-lock], .stage--loginCheck"), gift: !!document.querySelector("#giftOpenButton") }));
    deq(s, { lock: true, gift: false });
    const w = await waOf(d.p);
    deq([w.get, w.create], [0, 0]);
    await secrecy(d, g.token, "gift-b5-lock", "B5 locked");
    // the existing unlock (one pinned get) → the lock's destination is the Gift paper → Open → refused before auth → Home
    await d.p.locator("#loginChogButton").click();
    await d.p.waitForSelector("#giftOpenButton", { timeout: 20000 });
    assert.equal(await sceneOf(d.p), "received:came");
    const wu = await waOf(d.p);
    deq([wu.get, wu.create], [1, 0], "exactly the existing unlock assertion");
    deq(wu.getOpts.at(-1), { allow: 1 }, "unlock is pinned to the stored credential");
    const address = await d.p.evaluate(() => localStorage.getItem("araso.address"));
    await d.p.locator("#giftOpenButton").click();
    const home = await waitScene(d.p, ["sendstay", "name", "birth"], 20000);
    const w2 = await waOf(d.p);
    assert.equal(home, "sendstay", `trace ${w2.scenes.join(">")}`);
    deq([w2.get, w2.create], [1, 0], "config-null Gift refused before auth");
    assert.equal(await d.p.evaluate(() => localStorage.getItem("araso.address")), address, "no new Piggy");
    await secrecy(d, g.token, "gift-b5-lock", "B5 after unlock");
    deq(d.errors, [], "pageerror 0");
    await d.context.close();
  });
}

function finish() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}
if (process.env.A734_NODE_ONLY === "1") {
  console.log("SKIP  Part B (A734_NODE_ONLY=1) — browser scenarios not run");
  finish();
} else {
  await runBrowser();
  finish();
}
