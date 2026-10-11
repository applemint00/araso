// [A-960] Invite link → first grant — app side + Journey 2 entry over Upstash parts. Node only, network 0 (fetch = in-process shims into
// api/grant.js on a FAKE Upstash; RPC stub). Rows: `#invite=` taken out of the fragment with `#g=` kept byte-for-byte (item 5 coexistence) ·
// stored once per device · invite-bind text checked before signing · bindInviteBeforeGrant → server bind → grant · the main.js [A-960] block
// run with stubs (boot strip, requestGrant wrapper, harness skip, silent failure, once per Piggy) · block = no screen/copy · main.js outside
// the block byte-equal to the pre-card copy · fork entry with Upstash invites binds once and refuses another Piggy.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, keccak256, parseAbi, parseTransaction } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { fakeUpstash } from "./helpers/a960-fake-upstash.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
// [A-977 RE-PIN] the later [A-977] Job 10 fork block is cut before the preservation compares (pre-A-977: MAIN as is)
const A977_CUT = (s) => s.replace(/^\/\/ ── \[A-977\] Job 10 on the shared fork[\s\S]*?^\/\/ ── \[A-977\] end Job 10 on the shared fork ──\n/m, "");
// [A-1023 RE-PIN] (Owner 10-11 14:1x: only the approved post-ee4fa91 hunks are cut; no whole-card exclusion) receipts/A1023_pin_attribution/ATTRIBUTION.md.
// The delimited [A-979 ④] badge block is cut by its markers; every other approved hunk (A-979 ④ import · A-995 ①②③ · A-995-b) is restored to its
// exact ee4fa91 text and only when it occurs exactly once — anything else stays in place, so any other main.js change still fails this pin.
const A1023_RESTORES = [["A-995 ②③ / A-995-b imports","import { registerA995InlineFace, syncA995GiftEyes } from \"./a995-eye-look.js\";\nimport { mountA995bLoadingPiggy } from \"./a995b-loading-piggy.js\";\n",""],["A-979 ④ import","import { mountForkVirtualMoneyBadge } from \"./fork-virtual-money-badge.js\";\n",""],["A-995 ① breath comment","// [A-995 ①] persistent breath: Owner-selected Sleep strength (x .0091 / y .026) on the existing 4.4 s loop, scaled about the\n","// [A-841 UI-27] persistent subtle breath: the first-arrival values (HOME_T_BREATHE sx 1-.008, sy 1+.014) on a slow loop, scaled about the\n"],["A-995 ① breath coefficients","  el.style.transform = `scale(${(1 - 0.0091 * b).toFixed(5)}, ${(1 + 0.026 * b).toFixed(5)})`;\n","  el.style.transform = `scale(${(1 - 0.008 * b).toFixed(5)}, ${(1 + 0.014 * b).toFixed(5)})`;\n"],["A-995 ② gift eyes (unchanged render)","  if (root && s.html === html) { a911Layout(); void syncA995GiftEyes(root); return; } // nothing changed: leave the DOM (focus, scroll, running transitions) alone\n","  if (root && s.html === html) { a911Layout(); return; } // nothing changed: leave the DOM (focus, scroll, running transitions) alone\n"],["A-995 ② gift eyes (sync)","  void syncA995GiftEyes(a911Root() || document);\n",""],["A-995 ③ tester intro face","  const face = el.querySelector(\".testerIntro__face\");\n  registerA995InlineFace(face);\n",""],["A-995 ③ tester intro blink","    setTimeout(() => el.classList.remove(\"is-closed\"), TESTER_INTRO_BLINK_MS - 120),\n",""],["A-995-b loading bridge","// [A-995-b] Same-turn PWA splash -> loading bridge. The browser cannot paint the first render\n// before this module task ends, so the approved 3.6 s overlay remains the first visible surface.\nmountA995bLoadingPiggy();\n",""]];
const A1023_CUT = (s) => { s = s.replace(/^\/\/ ── \[A-979 ④\] Fork virtual-money badge\.[\s\S]*?^\/\/ ── \[A-979 ④\] end ──\n/m, ""); for (const [, from, to] of A1023_RESTORES) if (s.split(from).length === 2) s = s.replace(from, () => to); return s; };
const PRE = path.join(REPO, "_private/wt/a960d/pre");

const STUB_RPC = "http://a960-app-stub-rpc.invalid";
process.env.MONAD_RPC_URL = STUB_RPC;
const KEY = generatePrivateKey();
const RELAYER = privateKeyToAccount(KEY).address;
let netCalls = 0;
const sent = [];
const receipts = new Map();
const balances = new Map([[RELAYER.toLowerCase(), 10n ** 21n]]);
let nonce = 0;
const hex = (n) => `0x${BigInt(n).toString(16)}`;
let appFetch = null; // the in-process "/api/grant" the app calls
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u === "/api/grant" && appFetch) return appFetch(init);
  if (!u.startsWith(STUB_RPC)) { netCalls += 1; throw new Error(`a960: network forbidden (${u})`); }
  const payload = JSON.parse(init.body);
  const one = (req) => { try { return { jsonrpc: "2.0", id: req.id, result: answer(req.method, req.params ?? []) }; } catch (e) { return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: String(e.message) } }; } };
  return new Response(JSON.stringify(Array.isArray(payload) ? payload.map(one) : one(payload)), { status: 200, headers: { "content-type": "application/json" } });
};
function answer(method, params) {
  switch (method) {
    case "eth_chainId": return hex(10143);
    case "eth_getBalance": return hex(balances.get(params[0].toLowerCase()) ?? 0n);
    case "eth_getTransactionCount": return hex(nonce);
    case "eth_blockNumber": return hex(100);
    case "eth_gasPrice": case "eth_maxPriorityFeePerGas": return hex(1_000_000_000);
    case "eth_estimateGas": return hex(21000);
    case "eth_getBlockByNumber": return { number: hex(100), hash: `0x${"ab".repeat(32)}`, baseFeePerGas: hex(1_000_000_000), timestamp: hex(1), transactions: [], gasLimit: hex(30_000_000), gasUsed: "0x0" };
    case "eth_sendRawTransaction": { const tx = parseTransaction(params[0]); const h = keccak256(params[0]); nonce += 1; sent.push(tx.to.toLowerCase()); receipts.set(h, tx.to); return h; }
    case "eth_getTransactionReceipt": { const h = params[0]; if (!receipts.has(h)) return null; return { transactionHash: h, status: "0x1", blockNumber: hex(100), blockHash: `0x${"ab".repeat(32)}`, transactionIndex: "0x0", from: RELAYER, to: receipts.get(h), cumulativeGasUsed: hex(21000), gasUsed: hex(21000), effectiveGasPrice: hex(1), logs: [], logsBloom: `0x${"00".repeat(256)}`, type: "0x2", contractAddress: null }; }
    default: throw new Error(`stub: ${method}`);
  }
}
const origLog = console.log; console.log = (...a) => { if (!/^(grant|invite) /.test(String(a[0]))) origLog(...a); };

const C = await import("../src/fork-entry-client.js");
const G = await import("../../api/grant.js");
const R = await import("../../api/_lib/grant-redis-store.js");
const I = await import("../../api/_lib/invite-redis-store.js");
const A = await import("../../api/_lib/fork-auth.js");
const E = await import("../../api/_lib/fork-entry.js");
const { parseClaimUrl } = await import("../src/gift-piggy-claim-link.js");

let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; origLog(`PASS  ${n}`); } catch (e) { fail += 1; origLog(`FAIL  ${n}\n      ${String((e && e.message) || e).split("\n")[0]}`); } };
const APP = "https://arasoo.vercel.app";
globalThis.location = { origin: APP };
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const TOKEN = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE"; // 43 chars, base64url shape

// ---- app → in-process /api/grant on a fake Upstash ----
function rig() {
  const kv = fakeUpstash();
  const cmd = R.createUpstashRest({ url: kv.url, token: kv.token, fetchImpl: kv.fetchImpl });
  const p = { grant: R.createUpstashGrantStore({ cmd }), invites: I.createUpstashInviteStore({ cmd, now: () => kv.clock.t }), challenges: A.createRedisChallengeStore({ cmd }) };
  const h = G.createGrantHandler({ store: p.grant, policy: { globalCap: 20 }, invite: { invites: p.invites, challenges: p.challenges, appOrigin: APP } });
  const seen = [];
  appFetch = async (init) => {
    const headers = { ...Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])), origin: APP, "sec-fetch-site": "same-origin" };
    seen.push({ headers, body: JSON.parse(init.body) });
    const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = b; } };
    await h({ method: init.method, headers, body: JSON.parse(init.body), async *[Symbol.asyncIterator]() {} }, res);
    return { status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json: async () => JSON.parse(res.body) };
  };
  return { kv, p, h, seen };
}
process.env.ARASO_GRANT_ENABLED = "1"; process.env.RELAYER_PRIVATE_KEY = KEY;

// ==== fragment rule ====
await check("5 #invite= leaves the fragment; #g=…&t=…&v=… stays byte-for-byte (either order); Gift parse unchanged; malformed invite still removed", () => {
  const gift = "g=0x" + "1f".repeat(32) + "&t=" + "Q".repeat(43) + "&v=1";
  assert.deepEqual(C.takeInviteFromHash(`#invite=${TOKEN}`), { found: true, token: TOKEN, hash: "" });
  assert.deepEqual(C.takeInviteFromHash(`#${gift}&invite=${TOKEN}`), { found: true, token: TOKEN, hash: `#${gift}` });
  assert.deepEqual(C.takeInviteFromHash(`#invite=${TOKEN}&${gift}`), { found: true, token: TOKEN, hash: `#${gift}` });
  assert.deepEqual(C.takeInviteFromHash(`#${gift}`), { found: false, token: null, hash: `#${gift}` });
  assert.deepEqual(C.takeInviteFromHash("#invite=short"), { found: true, token: null, hash: "" });
  assert.deepEqual(C.takeInviteFromHash("#invite=%E0%A4%A"), { found: true, token: null, hash: "" });
  assert.deepEqual(C.takeInviteFromHash(""), { found: false, token: null, hash: "" });
  const base = "https://arasoo.vercel.app/claim";
  assert.deepEqual(parseClaimUrl(base + C.takeInviteFromHash(`#invite=${TOKEN}&${gift}`).hash), parseClaimUrl(`${base}#${gift}`));
  assert.equal(parseClaimUrl(`${base}#${gift}`).ok, true);
});
await check("5 device slot: storeInvite → FORK_INVITE_KEY (the Journey 2 slot) · newest link wins and clears the bound mark · same link keeps it", () => {
  const s = memStorage();
  assert.equal(C.storeInvite(TOKEN, s), true); assert.equal(C.readForkInvite(s), TOKEN);
  C.markInviteBound(s, "0x" + "ab".repeat(20)); assert.equal(C.inviteBoundFor(s, "0x" + "AB".repeat(20)), true);
  C.storeInvite(TOKEN, s); assert.equal(C.inviteBoundFor(s, "0x" + "ab".repeat(20)), true, "same link: mark kept");
  C.storeInvite(TOKEN.replace("A", "B"), s); assert.equal(C.inviteBoundFor(s, "0x" + "ab".repeat(20)), false, "new link: mark cleared");
  assert.equal(C.storeInvite("bad", s), false);
});
await check("5 invite-bind text: only this origin · chain 10143 · this Piggy + nonce · ≤ 2 min; a fork-entry text never passes", () => {
  const acct = privateKeyToAccount(generatePrivateKey()); const piggy = acct.address.toLowerCase();
  const mem = A.createMemoryChallengeStore();
  const c = A.issueChallenge({ store: mem, purpose: "invite-bind", uri: APP, chainId: 10143, testerId: "tester-0123456789abcdef", piggyAddress: piggy, now: 1000 });
  const ok = { origin: APP, piggyAddress: piggy, nonce: c.nonce, expiresAt: c.expiresAt, now: 1000 };
  assert.equal(C.inviteBindTextOk(c.message, ok), true);
  assert.equal(C.inviteBindTextOk(c.message, { ...ok, origin: "https://evil.example" }), false);
  assert.equal(C.inviteBindTextOk(c.message, { ...ok, piggyAddress: "0x" + "cd".repeat(20) }), false);
  assert.equal(C.inviteBindTextOk(c.message, { ...ok, nonce: "f".repeat(32) }), false);
  assert.equal(C.inviteBindTextOk(c.message, { ...ok, now: c.expiresAt }), false);
  assert.equal(C.inviteBindTextOk(c.message.replace("chainId: 10143", "chainId: 143"), ok), false);
  const f = A.issueChallenge({ store: mem, uri: APP, chainId: 31337143, testerId: "tester-1", piggyAddress: piggy, forkInstanceId: "fork-1", now: 1000 });
  assert.equal(C.inviteBindTextOk(f.message, { ...ok, nonce: f.nonce, expiresAt: f.expiresAt }), false);
  assert.equal(C.challengeTextOk(c.message, { ...ok }), false, "and the fork-entry checker refuses the invite text");
});
await check("5 bindInviteBeforeGrant → server bind → grant 200; token only in the x-araso-invite header (never in a body); wrong Origin refused", async () => {
  const { p, seen } = rig();
  const t = await p.invites.issue();
  const acct = privateKeyToAccount(generatePrivateKey()); const piggy = acct.address.toLowerCase();
  const r = await C.bindInviteBeforeGrant({ url: "/api/grant", invite: t.token, piggyAddress: piggy, signMessage: (message) => acct.signMessage({ message }) });
  assert.deepEqual(r, { bound: true });
  assert.ok(seen.every((x) => x.headers["x-araso-invite"] === t.token && !JSON.stringify(x.body).includes(t.token)));
  const g = await fetch("/api/grant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: acct.address }) });
  assert.equal(g.status, 200); assert.equal(sent.at(-1), piggy);
  const other = privateKeyToAccount(generatePrivateKey());
  assert.equal((await C.bindInviteBeforeGrant({ url: "/api/grant", invite: t.token, piggyAddress: other.address, signMessage: (m) => other.signMessage({ message: m }) })).reason, "invite_bound_to_other_piggy");
  assert.equal((await C.bindInviteBeforeGrant({ url: "/api/grant", invite: "x".repeat(43), piggyAddress: piggy, signMessage: () => "0x" })).reason, "not invited");
  assert.equal((await C.bindInviteBeforeGrant({ url: "/api/grant", invite: t.token, piggyAddress: piggy })).reason, "no_live_signer");
  // a server answering a text for another origin is never signed
  let signed = 0;
  const saved = globalThis.location; globalThis.location = { origin: "https://other.example" };
  const r2 = await C.bindInviteBeforeGrant({ url: "/api/grant", invite: t.token, piggyAddress: piggy, signMessage: async (m) => { signed += 1; return acct.signMessage({ message: m }); } });
  globalThis.location = saved;
  assert.equal(r2.reason, "challenge_shape"); assert.equal(signed, 0);
});

// ==== main.js [A-960] block ====
const BLOCK_RE = /^\/\/ ── \[A-960\] invite link → first grant\.[\s\S]*?^\/\/ ── \[A-960\] end invite link → first grant ──\n/m;
const block = (MAIN.match(BLOCK_RE) || [""])[0];
await check("main.js: exactly one contiguous [A-960] block, after the [A-956] block and before the Gift fragment boot read; every [A-960] mark inside", () => {
  assert.ok(block.length > 0);
  assert.equal([...MAIN.matchAll(/\[A-960\]/g)].length, [...block.matchAll(/\[A-960\]/g)].length);
  const at = MAIN.indexOf(block);
  assert.ok(at > MAIN.indexOf("// ── [A-956] end Journey 2 entry ──"));
  assert.ok(at < MAIN.indexOf("const pendingRead = readClaimFragment(location.href);"));
});
await check("main.js outside the [A-960] block is byte-equal to the pre-card copy (private workspace)", () => {
  const pre = path.join(PRE, "app_src_main.js");
  if (!existsSync(pre)) { origLog("      (pre-card copy is private-workspace only — skipped)"); return; }
  assert.equal(A1023_CUT(A977_CUT(MAIN)) /* [A-1023 RE-PIN] pre-A-1023: A977_CUT(MAIN) */.replace(BLOCK_RE, "").replace(/^\/\/ ── \[A-966\] Gift on the shared fork[\s\S]*?^\/\/ ── \[A-966\] end Gift on the shared fork ──\n/m, "") /* [A-966 re-pin] the later [A-966] fork Gift block is cut too; pre-A-966: MAIN.replace(BLOCK_RE, "") */.replace(/^\/\/ ── \[A-974\] Fork app entry[\s\S]*?^\/\/ ── \[A-974\] end fork app entry ──\n/m, "") /* [A-974 re-pin] the later [A-974] fork entry block too; pre-A-974: no third cut */, readFileSync(pre, "utf8"));
});
await check("block content: no screen / copy / scene / render / DOM; no [A-956] marks; grant path still the existing requestGrant", () => {
  const code = block.replace(/^\s*\/\/.*$/gm, "");
  for (const bad of [/textContent|innerHTML|setScene\(|render\(|createElement|a891ChogSay|querySelector/, /\[A-956\]/, /console\./]) assert.doesNotMatch(code, bad);
  assert.match(code, /return a960BaseRequestGrant\(address\);/);
});
function runBlock({ hash = "", storage = memStorage(), account = null, relayer = "/api", harness = false } = {}) {
  const calls = { replace: [], base: [] };
  const loc = { pathname: "/", search: "?i=abc", hash };
  const hist = { replaceState: (_s, _t, url) => { calls.replace.push(url); const i = url.indexOf("#"); loc.hash = i >= 0 ? url.slice(i) : ""; } };
  const code = block.replace(/^import [^\n]*\n/m, "");
  const names = ["a960BindInviteBeforeGrant", "a960InviteBoundFor", "a960MarkInviteBound", "a960ReadInvite", "a960StoreInvite", "a960TakeInviteFromHash", "location", "history", "safeLocalStorage", "RELAYER_URL", "isLocalDevRpId", "__base", "__acct"];
  const fn = new Function(...names, `let requestGrant = __base; let activeAccount = __acct(); ${code}\nreturn { requestGrant: (a) => requestGrant(a) };`);
  const api = fn(C.bindInviteBeforeGrant, C.inviteBoundFor, C.markInviteBound, C.readForkInvite, C.storeInvite, C.takeInviteFromHash, loc, hist, () => storage, harness ? "__HARNESS_NO_GRANT__" : relayer, () => harness,
    async (a) => { calls.base.push(a); return { granted: true, txHash: "0x1" }; }, () => account);
  return { api, calls, loc, storage };
}
await check("block boot: `#invite=` stored + removed at once, `#g=` kept for the Gift read; no fragment / no invite = no replaceState", () => {
  const gift = "g=0x" + "2e".repeat(32) + "&t=" + "R".repeat(43) + "&v=1";
  const a = runBlock({ hash: `#${gift}&invite=${TOKEN}` });
  assert.deepEqual(a.calls.replace, [`/?i=abc#${gift}`]); assert.equal(C.readForkInvite(a.storage), TOKEN);
  const b = runBlock({ hash: `#${gift}` }); assert.equal(b.calls.replace.length, 0); assert.equal(C.readForkInvite(b.storage), null);
  const c = runBlock({ hash: "" }); assert.equal(c.calls.replace.length, 0);
  const d = runBlock({ hash: `#invite=${TOKEN}` }); assert.deepEqual(d.calls.replace, ["/?i=abc"]);
});
await check("block grant: invite + live signer → bind then the existing grant call; once per Piggy; no invite / harness / bind failure → grant call unchanged", async () => {
  const { p, seen } = rig();
  const t = await p.invites.issue();
  const acct = privateKeyToAccount(generatePrivateKey());
  const s = memStorage(); C.storeInvite(t.token, s);
  const x = runBlock({ storage: s, account: acct });
  await x.api.requestGrant(acct.address);
  assert.deepEqual(seen.map((q) => q.body.action), ["invite_challenge", "invite_bind"]); assert.deepEqual(x.calls.base, [acct.address]);
  assert.equal(C.inviteBoundFor(s, acct.address), true);
  await x.api.requestGrant(acct.address);
  assert.equal(seen.length, 2, "bound mark: no second bind"); assert.equal(x.calls.base.length, 2);
  seen.length = 0;
  const n = runBlock({ account: acct }); await n.api.requestGrant(acct.address); assert.equal(seen.length, 0); assert.equal(n.calls.base.length, 1);
  const s2 = memStorage(); C.storeInvite(t.token, s2);
  const hz = runBlock({ storage: s2, account: acct, harness: true }); await hz.api.requestGrant(acct.address); assert.equal(seen.length, 0); assert.equal(hz.calls.base.length, 1);
  const other = privateKeyToAccount(generatePrivateKey());
  const f = runBlock({ storage: s2, account: other }); await f.api.requestGrant(other.address); // token already bound to acct → refused, silent
  assert.equal(f.calls.base.length, 1); assert.equal(C.inviteBoundFor(s2, other.address), false);
  const ns = runBlock({ storage: s2, account: null }); await ns.api.requestGrant(acct.address); // no live signer = no attempt
  assert.equal(ns.calls.base.length, 1);
});

// ==== Journey 2 entry over Upstash parts ====
await check("fork entry with Upstash invites: enter binds the invite to the signing Piggy (once); another Piggy with the same invite is refused; entry ledger rows land in Upstash", async () => {
  const kv = fakeUpstash();
  const cmd = R.createUpstashRest({ url: kv.url, token: kv.token, fetchImpl: kv.fetchImpl });
  const invites = I.createUpstashInviteStore({ cmd, now: () => kv.clock.t });
  const parts = { invites, challenges: A.createRedisChallengeStore({ cmd }), store: (await import("../../api/_lib/fork-ledger-redis-store.js")).createUpstashForkLedgerStore({ cmd }) };
  assert.ok(E.upstashForkEntryParts({ KV_REST_API_URL: kv.url, KV_REST_API_TOKEN: kv.token }, { fetchImpl: kv.fetchImpl }));
  assert.equal(E.upstashForkEntryParts({}), null);
  const FORK = "fork-a960"; const shmon = parseAbi(["function deposit(uint256 assets, address receiver) payable returns (uint256)", "function redeem(uint256 shares, address receiver, address owner) returns (uint256)"]);
  const txs = new Map(); const h = (n) => `0x${n.toString(16).padStart(64, "0")}`;
  const addJ1 = (who, base) => {
    const add = (hash, input, b) => txs.set(hash, { tx: { hash, from: who, to: E.JOURNEY1.target, input, chainId: "0x279f" }, rc: { transactionHash: hash, from: who, to: E.JOURNEY1.target, status: "0x1", blockNumber: hex(b) } });
    add(h(base), encodeFunctionData({ abi: shmon, functionName: "deposit", args: [1n, who] }), 10);
    add(h(base + 1), encodeFunctionData({ abi: shmon, functionName: "redeem", args: [1n, who, who] }), 11);
    return { depositTxHash: h(base), redeemTxHash: h(base + 1) };
  };
  const testnetRpc = async (m, prm) => { if (m === "eth_chainId") return "0x279f"; const t = txs.get(String(prm[0]).toLowerCase()); return t ? (m === "eth_getTransactionByHash" ? t.tx : t.rc) : null; };
  const admin = { instance: async () => ({ ok: true, forkInstanceId: FORK, chainId: 31337143, forkStartBlock: 1 }), topup: async () => ({ ok: true, forkInstanceId: FORK, amountRaw: "1", noop: false }) };
  const svc = E.createForkEntryService({ config: { invites, appOrigin: APP, grantVersion: "a960-g1" }, store: parts.store, challenges: parts.challenges, admin, testnetRpc });
  const t = await invites.issue();
  const enter = async (acct, base) => {
    const piggy = acct.address.toLowerCase();
    const c = await svc.challenge({ inviteToken: t.token, piggyAddress: piggy });
    assert.equal(c.ok, true, JSON.stringify(c));
    const signature = await acct.signMessage({ message: c.message });
    return svc.enter({ inviteToken: t.token, nonce: c.nonce, signature, piggyAddress: piggy, journey1: addJ1(piggy, base) });
  };
  const a = privateKeyToAccount(generatePrivateKey()); const b = privateKeyToAccount(generatePrivateKey());
  const ra = await enter(a, 100);
  assert.equal(ra.allowed, true, JSON.stringify(ra));
  assert.equal((await invites.lookup(t.token)).piggy, a.address.toLowerCase());
  const rb = await enter(b, 200);
  assert.equal(rb.allowed, false); assert.equal(rb.reason, "invite_bound_to_other_piggy");
  assert.equal((await svc.status({ inviteToken: t.token, piggyAddress: a.address, forkInstanceId: FORK })).allowed, true);
  assert.ok((await parts.store.list("entries")).length === 1);
  assert.equal(kv.dump().includes(t.token), false);
});
delete process.env.ARASO_GRANT_ENABLED; delete process.env.RELAYER_PRIVATE_KEY;
await check("network 0", () => { assert.equal(netCalls, 0); });
origLog(`\nA-960 invite app: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
