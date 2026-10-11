// [A-956] Journey 2 entry — app side. Node only, network 0 (fetch is an in-process shim straight into the api/fork-entry.js handler).
// Rows: client (entry only where it may open · invite/Journey-1 pointers · challenge shape check before signing · re-check never cached) ·
// switchJourney refuses while sending / signing / unconfirmed (item 5) · the main.js [A-956] block run with stubs: "tap me!" → server →
// switchJourney(2) only when allowed, refusal = nothing changes (item 4) · fork money re-check before Face ID (item 6) · preservation:
// main.js outside the block byte-equal to the pre-card copy, a948 pins intact, boot/release/grant files untouched (item 8).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as C from "../src/fork-entry-client.js";
import { SWITCH_BLOCK_KEYS, journeySwitchBlocker, registerJourneySessionDisposer, registerJourneySwitchBusyProbe, switchJourney } from "../src/journey-switch.js";
import { JOURNEY_KEY } from "../src/boot-profile.js";
import { resolveChainProfile } from "../src/chain-profile.js";
import { challengeMessage, createInviteTable, createMemoryChallengeStore } from "../../api/_lib/fork-auth.js";
import { JOURNEY1, createForkEntryService } from "../../api/_lib/fork-entry.js";
import { createForkAdminClient } from "../../api/_lib/fork-grant-client.js";
import { createMemoryForkLedgerStore } from "../../api/_lib/fork-ledger-store-contract.js";
import { createForkEntryHandler } from "../../api/fork-entry.js";

let netCalls = 0;
const realFetchTrap = async () => { netCalls += 1; throw new Error("A-956 test: network forbidden"); };
globalThis.fetch = realFetchTrap;
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String((e && e.message) || e).split("\n")[0]}`); } };
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
const PRE = path.join(REPO, "_private/wt/a956d/pre");

const PIGGY = privateKeyToAccount(`0x${"c3".repeat(32)}`);
const OTHER = privateKeyToAccount(`0x${"d4".repeat(32)}`);
const P = PIGGY.address.toLowerCase();
const TOKEN = "local-test-invite-app-01";
const APP_ORIGIN = "http://localhost:5173";
globalThis.location = { origin: APP_ORIGIN }; // the page origin requestForkEntry checks the challenge `uri:` line against
const FORK_ID = "fork-143-110874000-20261010t000000z-a956c0de";
const FORK_ENV = { VITE_ARASO_FORK_RPC_URL: "https://fork-public.invalid/rpc", VITE_ARASO_FORK_INSTANCE_ID: FORK_ID };
const TESTNET = resolveChainProfile(undefined);
const FORK = resolveChainProfile("monad-fork", { rpcUrl: FORK_ENV.VITE_ARASO_FORK_RPC_URL, forkInstanceId: FORK_ID });
const h = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const shmon = parseAbi(["function deposit(uint256 assets, address receiver) payable returns (uint256)", "function redeem(uint256 shares, address receiver, address owner) returns (uint256)"]);

// in-process server: the real handler + service, fake testnet RPC + fake Admin (A-949 protocol, idempotent)
function server() {
  const txs = new Map();
  const rpc = async (m, p) => { if (m === "eth_chainId") return "0x279f"; const t = txs.get(String(p[0]).toLowerCase()); return t ? (m === "eth_getTransactionByHash" ? t.tx : t.rc) : null; };
  const addJ1 = (who, base) => {
    const add = (hash, input, block) => txs.set(hash, { tx: { hash, from: who, to: JOURNEY1.target, input, chainId: "0x279f" }, rc: { transactionHash: hash, from: who, to: JOURNEY1.target, status: "0x1", blockNumber: `0x${block.toString(16)}` } });
    add(h(base), encodeFunctionData({ abi: shmon, functionName: "deposit", args: [1n, who] }), 10);
    add(h(base + 1), encodeFunctionData({ abi: shmon, functionName: "redeem", args: [1n, who, who] }), 11);
    return { depositTxHash: h(base), redeemTxHash: h(base + 1) };
  };
  const st = { instance: FORK_ID, topups: 0, keys: new Set(), statusCalls: 0 };
  const adminFetch = async (url, init) => {
    const u = new URL(url); const j = (s, b) => ({ status: s, json: async () => b });
    if (u.pathname === "/admin/instance") return j(200, { ready: true, meta: { forkInstanceId: st.instance, parentBlockNumber: 1, chainId: 31337143 } });
    const b = JSON.parse(init.body); const key = `${st.instance}|${b.piggyAddress.toLowerCase()}|${b.asset}|${b.grantVersion}`;
    const noop = st.keys.has(key); if (!noop) { st.keys.add(key); st.topups += 1; }
    return j(200, { noop, key, record: { forkInstanceId: st.instance, amountRaw: { MON: "5000000000000000000", USDC: "10000000", WETH: "1500000000000000000", AUSD: "150000000" }[b.asset] } }); // pre-A-959: MON ? 5e18 : 10e6 (any non-MON asset got the USDC amount)
  };
  const svc = createForkEntryService({ config: { invites: createInviteTable([TOKEN]), appOrigin: APP_ORIGIN, grantVersion: "a956-g1" }, store: createMemoryForkLedgerStore(), challenges: createMemoryChallengeStore(), admin: createForkAdminClient({ url: "http://127.0.0.1:47998", token: "admin-token-0123456789abcdef", fetchImpl: adminFetch }), testnetRpc: rpc });
  const H = createForkEntryHandler({ service: svc });
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body), invite: init.headers["x-araso-invite"] });
    if (JSON.parse(init.body).action === "status") st.statusCalls += 1;
    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    await H({ method: init.method, headers: Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v])), body: init.body }, res);
    return { status: res.statusCode, json: async () => JSON.parse(res.body) };
  };
  return { fetchImpl, addJ1, st, seen };
}

// ── client ──
await check("forkEntryOpen: only root testnet (active) · release level ≥ 2 · fork build config present", () => {
  assert.equal(C.forkEntryOpen({ level: 2, profile: TESTNET, env: FORK_ENV }), true);
  assert.equal(C.forkEntryOpen({ level: 1, profile: TESTNET, env: FORK_ENV }), false, "level 1 = First Journey only");
  assert.equal(C.forkEntryOpen({ level: 2, profile: TESTNET, env: {} }), false, "no fork env: the switched boot could not pick the fork");
  assert.equal(C.forkEntryOpen({ level: 2, profile: FORK, env: FORK_ENV }), false, "already on the fork");
  assert.equal(C.forkEntryOpen({ level: 2, profile: resolveChainProfile("monad-mainnet"), env: FORK_ENV }), false);
  assert.equal(C.forkEntryOpen({ level: 2, profile: { ...TESTNET, status: "blocked" }, env: FORK_ENV }), false);
  assert.equal(C.onForkProfile(FORK), true); assert.equal(C.onForkProfile(TESTNET), false);
});
await check("forkEntryUrl: same-origin path; a loopback dev URL is ignored outside a vite dev build (node = production rule)", () => {
  assert.equal(C.forkEntryUrl({ VITE_ARASO_FORK_ENTRY_URL: "http://127.0.0.1:4100/api/fork-entry" }), "/api/fork-entry");
  assert.equal(C.forkEntryUrl({ VITE_ARASO_FORK_ENTRY_URL: "http://127.0.0.1:4100/api/fork-entry" }, true), "/api/fork-entry", "the build constant decides, not the caller");
  assert.equal(C.forkEntryUrl({}), "/api/fork-entry");
});
await check("journey1Pointers: newest legacy receipt with both hashes; add_money / malformed rows skipped; readForkInvite shape-checked", () => {
  assert.equal(C.journey1Pointers([]), null); assert.equal(C.journey1Pointers(null), null);
  const rows = [{ kind: "add_money", depositTxHash: h(9), redeemTxHash: h(10) }, { depositTxHash: "0xa803-dep", redeemTxHash: "0xa803-red" }, { depositTxHash: h(1).toUpperCase().replace("0X", "0x"), redeemTxHash: h(2) }, { depositTxHash: h(3), redeemTxHash: h(4) }];
  assert.deepEqual(C.journey1Pointers(rows), { depositTxHash: h(1), redeemTxHash: h(2) });
  const st = (v) => ({ getItem: (k) => (k === C.FORK_INVITE_KEY ? v : null) });
  assert.equal(C.readForkInvite(st(TOKEN)), TOKEN); assert.equal(C.readForkInvite(st("short")), null); assert.equal(C.readForkInvite(st("a b c d e f g h i j k")), null);
  assert.equal(C.readForkInvite({ getItem() { throw new Error("denied"); } }), null);
});
await check("challengeTextOk: signs only the exact server template for THIS Piggy + nonce, ≤ 2 min ahead, not expired", () => {
  const now = 1_700_000_000_000; const nonce = "ab".repeat(16); const expiresAt = now + 120000;
  const mk = (over = {}) => challengeMessage({ uri: APP_ORIGIN, chainId: 31337143, testerId: "tester-0123456789abcdef", piggyAddress: P, forkInstanceId: FORK_ID, nonce, expiresAt, ...over });
  const msg = mk();
  const ok = (m, over = {}) => C.challengeTextOk(m, { origin: APP_ORIGIN, piggyAddress: PIGGY.address, nonce, expiresAt, now, ...over });
  assert.equal(ok(msg), true);
  assert.equal(ok(msg, { piggyAddress: OTHER.address }), false, "another Piggy");
  assert.equal(ok(msg, { nonce: "cd".repeat(16) }), false, "another nonce");
  assert.equal(ok(msg, { now: expiresAt }), false, "expired");
  // [review fix 2] domain + chain lines
  assert.equal(ok(mk({ uri: "https://evil.example" })), false, "another site's challenge");
  assert.equal(ok(msg, { origin: "https://arasoo.vercel.app" }), false, "this page is another origin");
  assert.equal(ok(msg, { origin: undefined }), false, "no page origin = no signature");
  assert.equal(ok(mk({ chainId: 143 })), false, "mainnet chain id"); assert.equal(ok(mk({ chainId: 10143 })), false, "testnet chain id");
  assert.equal(msg.split("\n")[1], `uri: ${APP_ORIGIN}`); assert.equal(msg.split("\n")[2], "chainId: 31337143"); assert.equal(C.FORK_CHAIN_ID, 31337143);
  const far = now + 3600000;
  assert.equal(C.challengeTextOk(mk({ expiresAt: far }), { origin: APP_ORIGIN, piggyAddress: P, nonce, expiresAt: far, now }), false, "too long-lived");
  for (const evil of [`${msg}\nalso: transfer`, msg.replace("Araso Journey 2 entry", "Permit"), "0x" + "ff".repeat(32), `${msg.split("\n").slice(0, 7).join("\n")}\nexpires: never`]) assert.equal(ok(evil), false);
});
await check("requestForkEntry end-to-end (in-process server): allowed + forkInstanceId; MON + USDC once; checkForkPermission asks the server every time", async () => {
  const S = server(); const j1 = S.addJ1(P, 100);
  let signs = 0; const signMessage = async (m) => { signs += 1; return PIGGY.signMessage({ message: m }); };
  const r = await C.requestForkEntry({ fetchImpl: S.fetchImpl, invite: TOKEN, piggyAddress: PIGGY.address, signMessage, journey1: j1 });
  assert.deepEqual(r, { allowed: true, forkInstanceId: FORK_ID }); assert.equal(signs, 1); assert.equal(S.st.topups, 4); // pre-A-959: 2 (MON + USDC)
  assert.ok(S.seen.every((c) => c.url === "/api/fork-entry" && c.invite === TOKEN && !("testerId" in c.body)));
  assert.equal((await C.requestForkEntry({ fetchImpl: S.fetchImpl, invite: TOKEN, piggyAddress: PIGGY.address, signMessage, journey1: j1 })).allowed, true);
  assert.equal(S.st.topups, 4, "repeat = no second top-up"); // pre-A-959: 2 (MON + USDC)
  for (let i = 0; i < 3; i += 1) assert.deepEqual(await C.checkForkPermission({ fetchImpl: S.fetchImpl, invite: TOKEN, piggyAddress: PIGGY.address, forkInstanceId: FORK_ID }), { allowed: true });
  assert.equal(S.st.statusCalls, 3, "no cached verdict");
  const stale = await C.checkForkPermission({ fetchImpl: S.fetchImpl, invite: TOKEN, piggyAddress: PIGGY.address, forkInstanceId: "fork-143-110874000-20261009t000000z-00000000" });
  assert.equal(stale.allowed, false); assert.equal(stale.reenter, true);
  S.st.instance = "fork-143-110874000-20261011t000000z-11111111";
  assert.equal((await C.checkForkPermission({ fetchImpl: S.fetchImpl, invite: TOKEN, piggyAddress: PIGGY.address, forkInstanceId: FORK_ID })).reason, "fork_instance_changed");
  assert.equal((await C.checkForkPermission({ fetchImpl: S.fetchImpl, invite: TOKEN, piggyAddress: OTHER.address, forkInstanceId: S.st.instance })).allowed, false);
});
await check("requestForkEntry refusals: no invite / no signer / no Journey 1 = no request at all; forged Journey 1 = refused, no top-up; a hostile challenge text is never signed", async () => {
  const S = server();
  for (const args of [{ invite: null }, { signMessage: null }, { journey1: null }, { journey1: { depositTxHash: "0xa803-dep", redeemTxHash: "0xa803-red" } }, { piggyAddress: "0x1234" }]) {
    const r = await C.requestForkEntry({ fetchImpl: S.fetchImpl, invite: TOKEN, piggyAddress: P, signMessage: async () => "0x", journey1: { depositTxHash: h(1), redeemTxHash: h(2) }, ...args });
    assert.equal(r.allowed, false);
  }
  assert.equal(S.seen.length, 0);
  let signs = 0;
  const forged = await C.requestForkEntry({ fetchImpl: S.fetchImpl, invite: TOKEN, piggyAddress: P, signMessage: async (m) => { signs += 1; return PIGGY.signMessage({ message: m }); }, journey1: { depositTxHash: h(0xdead), redeemTxHash: h(0xbeef) } });
  assert.equal(forged.allowed, false); assert.equal(forged.reason, "journey1_tx_not_found"); assert.equal(S.st.topups, 0);
  signs = 0;
  const hostile = async (url, init) => ({ status: 200, json: async () => ({ ok: true, nonce: "ab".repeat(16), expiresAt: Date.now() + 60000, message: "Permit spender 0xdead for 1e30" }) });
  const r = await C.requestForkEntry({ fetchImpl: hostile, invite: TOKEN, piggyAddress: P, signMessage: async () => { signs += 1; return "0x"; }, journey1: { depositTxHash: h(1), redeemTxHash: h(2) } });
  assert.equal(r.reason, "challenge_shape"); assert.equal(signs, 0);
  // [review fix 2] the server is configured for another app origin than this page → its challenge is never signed
  const j1x = S.addJ1(P, 700);
  const elsewhere = await C.requestForkEntry({ fetchImpl: S.fetchImpl, invite: TOKEN, piggyAddress: P, origin: "https://other.example", signMessage: async () => { signs += 1; return "0x"; }, journey1: j1x });
  assert.equal(elsewhere.reason, "challenge_shape"); assert.equal(signs, 0);
  const down = await C.requestForkEntry({ fetchImpl: async () => { throw new Error("offline"); }, invite: TOKEN, piggyAddress: P, signMessage: async () => "0x", journey1: { depositTxHash: h(1), redeemTxHash: h(2) } });
  assert.equal(down.allowed, false);
});

// ── 5) no switch while money is moving ──
const mkStorage = (init = {}) => { const m = new Map(Object.entries(init)); return { m, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const mkLoc = () => ({ origin: "http://localhost:5173", replaced: [], replace(u) { this.replaced.push(u); } });
await check("5 switchJourney refuses (no dispose, no write, no reload) while: sendPending · send reservation · Second pending · signing · unconfirmed · probe throws/garbage", async () => {
  let disposed = 0; registerJourneySessionDisposer(() => { disposed += 1; });
  const cases = [
    [{ "araso.sendPending": "{\"stage\":\"reserved\"}" }, null, "send_pending"],
    [{ "araso.sendPending.reserve.tab-1": "1" }, null, "send_reserved"],
    [{ "araso.secondSendPending.v1.monad-fork.p1": "{}" }, null, "second_send_pending"],
    [{ "araso.secondSendPending": "{}" }, null, "second_send_pending"],
    [{}, () => ({ signing: true, unconfirmed: false }), "signing"],
    [{}, () => ({ signing: false, unconfirmed: true }), "unconfirmed_tx"],
    [{}, () => { throw new Error("x"); }, "busy_unknown"],
    [{}, () => null, "busy_unknown"],
    [{}, () => ({ signing: "no" }), "busy_unknown"],
  ];
  for (const [init, probe, why] of cases) {
    registerJourneySwitchBusyProbe(probe);
    const s = mkStorage(init); const l = mkLoc();
    assert.equal(journeySwitchBlocker(s), why, why);
    assert.equal(switchJourney(2, { storage: s, loc: l }), false, why);
    assert.equal(s.m.has(JOURNEY_KEY), false); assert.equal(l.replaced.length, 0);
  }
  assert.equal(disposed, 0, "the live signer is not dropped by a refused switch");
  registerJourneySwitchBusyProbe(() => ({ signing: false, unconfirmed: false }));
  const s = mkStorage({ "araso.receipts": "[]", "araso.tripClosed": "1" }); const l = mkLoc();
  assert.equal(switchJourney(2, { storage: s, loc: l }), true); assert.equal(s.m.get(JOURNEY_KEY), "2"); assert.deepEqual(l.replaced, ["http://localhost:5173/"]); assert.equal(disposed, 1);
  assert.equal(s.m.get("araso.receipts"), "[]", "Journey 1 data untouched");
  assert.deepEqual(SWITCH_BLOCK_KEYS, ["araso.sendPending"]);
  assert.match(MAIN, /^const SEND_PENDING_KEY = "araso\.sendPending";/m, "the key journey-switch checks = main.js SEND_PENDING_KEY");
  registerJourneySwitchBusyProbe(null); registerJourneySessionDisposer(null);
});

// ── the main.js [A-956] block ──
const BLOCK_RE = /^\/\/ ── \[A-956\] Journey 2 entry[\s\S]*?^\/\/ ── \[A-956\] end Journey 2 entry ──\n/m;
const block = (MAIN.match(BLOCK_RE) || [""])[0];
await check("main.js: exactly one contiguous [A-956] block; every [A-956] mark is inside it", () => {
  assert.ok(block.length > 0); assert.equal([...MAIN.matchAll(/\[A-956\]/g)].length, [...block.matchAll(/\[A-956\]/g)].length);
});
await check("8 preservation: main.js with the [A-956] block removed is byte-equal to the pre-card copy (private workspace)", () => {
  const pre = path.join(PRE, "app_src_main.js");
  if (!existsSync(pre)) { console.log("      (pre-card copy is private-workspace only — skipped)"); return; }
  assert.equal(A1023_CUT(A977_CUT(MAIN)) /* [A-1023 RE-PIN] pre-A-1023: A977_CUT(MAIN) */.replace(BLOCK_RE, "").replace(/^\/\/ ── \[A-960\] invite link → first grant\.[\s\S]*?^\/\/ ── \[A-960\] end invite link → first grant ──\n\n?/m, "") /* [A-960 re-pin] the later [A-960] invite block is cut too */.replace(/^\/\/ ── \[A-966\] Gift on the shared fork[\s\S]*?^\/\/ ── \[A-966\] end Gift on the shared fork ──\n/m, "") /* [A-966 re-pin] the later [A-966] fork Gift block too; pre-A-966: no third cut */.replace(/^\/\/ ── \[A-974\] Fork app entry[\s\S]*?^\/\/ ── \[A-974\] end fork app entry ──\n/m, "") /* [A-974 re-pin] the later [A-974] fork entry block too; pre-A-974: no fourth cut */, readFileSync(pre, "utf8"));
});
await check("8 preservation: boot-profile.js · release-gate.js · api/grant.js byte-equal to the pre-card copies (journey/claim/promotion/Gift rules)", () => {
  for (const f of ["app/src/boot-profile.js", "app/src/release-gate.js", "api/grant.js"]) {
    const pre = path.join(PRE, f.replace(/\//g, "_"));
    if (!existsSync(pre)) { console.log(`      (${f} pre copy absent — skipped)`); continue; }
    // [A-960 re-pin] api/grant.js was changed later by A-960 (Upstash store + invite actions). This card's claim is checked on A-960's
    // pre-card copy (= the tree before A-960) instead of the live file. pre-A-960: the live api/grant.js.
    const live = f === "api/grant.js" ? path.join(REPO, "_private/wt/a960d/pre/api_grant.js") : path.join(REPO, f);
    if (!existsSync(live)) { console.log(`      (${f} A-960 pre copy absent — skipped)`); continue; }
    assert.equal(readFileSync(live, "utf8"), readFileSync(pre, "utf8"), f);
  }
});
await check("4/8 block content: no new screen/copy/scene · no Explore · no Journey 1 storage write · no admin/fork RPC · a948 pins intact", () => {
  const code = block.replace(/^\s*\/\/.*$/gm, "");
  for (const bad of [/textContent|innerHTML|a891ChogSay|setScene\(|render\(|createElement/, /openSecondJourneyExplore|SECOND_INTRO_SEEN_KEY/, /localStorage\.(setItem|removeItem)|sessionStorage/, /\/admin|ARASO_FORK_ADMIN|anvil_|127\.0\.0\.1/, /\breleaseAllows\(/, /journeyFeatureOpen\(/]) assert.doesNotMatch(code, bad);
  assert.equal([...MAIN.replace(/^\/\/ ── \[A-974\] Fork app entry[\s\S]*?^\/\/ ── \[A-974\] end fork app entry ──\n/m, "").matchAll(/journeyFeatureOpen\("(second|afterSecond|gift)", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\)/g)].length, 4, "a948 pin"); // [A-974 re-pin] counted outside the later [A-974] block (its one "second" call: a974 test). pre-A-974: MAIN
  assert.equal(/\breleaseAllows\(/.test(MAIN.replace(/\/\/[^\n]*/g, "")), false, "a948 pin");
  const quoted = [...code.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]).filter((s) => s !== "" && !s.startsWith("./"));
  assert.deepEqual([...new Set(quoted)].sort(), ["sendstay", "signer_changed"].sort(), "no user-facing string literal in the block");
});

// Run the block itself with stubs (imports → the real client; switchJourney + the server = in-process). import.meta.env → FORK_ENV.
function loadBlock(over = {}) {
  const body = block.replace(/^import [^\n]*\n/gm, "").replace(/import\.meta\.env/g, "__env");
  const names = ["CHAIN_PROFILE", "state", "readReceipts", "activeAccount", "RELEASE_LEVEL", "sendInFlight", "readSendPending", "requestMoneyPermission", "proveFundingTargetControl", "settleBoundGiftClaim", "a891ArmPostFileQuietHome", "a891HomeChogTap", "a891CueChog", "a891FirstArrivalHold", "homeChog", "sceneTimeout", "HOME_FIRST_JOURNEY_CARD_MS", "POST_FILE_QUIET_HOME_MS"];
  const env = { ...over };
  const src = `${names.map((n) => `let ${n} = E.${n};`).join("\n")}\nconst { checkForkPermission, forkEntryOpen, forkEntryUrl, journey1Pointers, onForkProfile, readForkInvite, requestForkEntry, registerJourneySwitchBusyProbe, a956SwitchJourney, __env } = E;\n${body}\nreturn { get: (n) => eval(n), set: (n, v) => { switch (n) { ${names.map((n) => `case "${n}": ${n} = v; break;`).join(" ")} } }, enter: () => a956Enter(), allowed: () => a956ForkMoneyAllowed() };`;
  return new Function("E", src)(env);
}
const timers = [];
function harness({ profile = TESTNET, level = 2, signer = PIGGY, invite = TOKEN, receipts, fetchImpl, address = P, stubs = {} } = {}) {
  const calls = { switched: 0, baseArm: 0, baseTap: 0, money: 0, cue: 0, closed: 0 };
  const store = mkStorage(invite ? { [C.FORK_INVITE_KEY]: invite } : {});
  globalThis.localStorage = store;
  globalThis.fetch = fetchImpl || realFetchTrap;
  const chog = { state: { pinned: false }, startTapCue: () => { calls.cue += 1; return true; }, closeCard: () => { calls.closed += 1; } };
  const state = { scene: "sendstay", address, receipts: receipts || [], secondJourneyCompletedOnce: false, sendCardVisible: false, recordsCardVisible: false, appLock: null };
  const B = loadBlock({
    CHAIN_PROFILE: profile, state, readReceipts: () => state.receipts, activeAccount: signer, RELEASE_LEVEL: level, sendInFlight: false, readSendPending: () => null,
    requestMoneyPermission: async () => { calls.money += 1; }, proveFundingTargetControl: async () => {}, settleBoundGiftClaim: async () => {},
    a891ArmPostFileQuietHome: () => { calls.baseArm += 1; }, a891HomeChogTap: () => { calls.baseTap += 1; }, a891CueChog: null, a891FirstArrivalHold: null,
    homeChog: chog, sceneTimeout: (fn) => timers.push(fn), HOME_FIRST_JOURNEY_CARD_MS: 1200, POST_FILE_QUIET_HOME_MS: 8000,
    checkForkPermission: C.checkForkPermission, forkEntryOpen: C.forkEntryOpen, forkEntryUrl: C.forkEntryUrl, journey1Pointers: C.journey1Pointers, onForkProfile: C.onForkProfile, readForkInvite: C.readForkInvite, requestForkEntry: C.requestForkEntry,
    registerJourneySwitchBusyProbe, a956SwitchJourney: () => { calls.switched += 1; return true; }, __env: FORK_ENV, ...stubs,
  });
  return { B, calls, state, chog, store };
}
const runTimers = () => { while (timers.length) timers.shift()(); };
const settle = () => new Promise((r) => setTimeout(r, 30));
await check("4 root testnet level 2: quiet Home arms the existing cue → tap → server (allowed) → switchJourney(2); intro/Explore never run; no storage write", async () => {
  const S = server(); const j1 = S.addJ1(P, 300);
  const T = harness({ receipts: [{ ...j1 }], fetchImpl: S.fetchImpl });
  T.B.get("a891ArmPostFileQuietHome")(); runTimers();
  assert.equal(T.calls.cue, 1); assert.equal(T.calls.baseArm, 0); assert.equal(T.B.get("a891CueChog"), T.chog);
  const before = JSON.stringify([...T.store.m]);
  T.B.get("a891HomeChogTap")(); await settle(); for (let i = 0; i < 20 && !T.calls.switched; i += 1) await settle();
  assert.equal(T.calls.switched, 1); assert.equal(T.calls.baseTap, 0, "Second intro path not taken"); assert.equal(T.calls.closed, 1);
  assert.equal(JSON.stringify([...T.store.m]), before, "no storage written by the block (intro-seen key untouched)");
  assert.equal(S.st.topups, 4); // pre-A-959: 2 (MON + USDC)
});
await check("4 refusals keep the quiet Home: forged Journey 1 / no live signer / signer of another Piggy / server down → no switch, no new state", async () => {
  const S = server();
  const T1 = harness({ receipts: [{ depositTxHash: h(0xdead), redeemTxHash: h(0xbeef) }], fetchImpl: S.fetchImpl });
  T1.B.get("a891ArmPostFileQuietHome")(); runTimers(); T1.B.get("a891HomeChogTap")(); for (let i = 0; i < 10; i += 1) await settle();
  assert.equal(T1.calls.switched, 0); assert.equal(T1.state.scene, "sendstay"); assert.equal(S.st.topups, 0);
  const j1 = S.addJ1(P, 400);
  for (const signer of [null, OTHER]) {
    const T = harness({ receipts: [j1], fetchImpl: S.fetchImpl, signer });
    const n = S.seen.length;
    T.B.get("a891ArmPostFileQuietHome")(); runTimers(); T.B.get("a891HomeChogTap")(); await settle();
    assert.equal(T.calls.switched, 0); assert.equal(S.seen.length, n, "no request without the Piggy's own live signer (no new passkey)");
  }
  const T3 = harness({ receipts: [j1], fetchImpl: async () => { throw new Error("offline"); } });
  T3.B.get("a891ArmPostFileQuietHome")(); runTimers(); T3.B.get("a891HomeChogTap")(); await settle();
  assert.equal(T3.calls.switched, 0);
});
await check("4 the cue is not armed without an invite or a Journey 1 receipt, nor after Second; level 1 / no fork env → the existing (A-943) path", async () => {
  const j1 = { depositTxHash: h(1), redeemTxHash: h(2) };
  for (const over of [{ invite: null, receipts: [j1] }, { receipts: [] }]) { const T = harness(over); T.B.get("a891ArmPostFileQuietHome")(); runTimers(); assert.equal(T.calls.cue, 0); }
  const T = harness({ receipts: [j1] }); T.state.secondJourneyCompletedOnce = true; T.B.get("a891ArmPostFileQuietHome")(); runTimers(); assert.equal(T.calls.cue, 0);
  for (const over of [{ level: 1, receipts: [j1] }, { profile: FORK, receipts: [j1] }]) {
    const U = harness(over); U.B.get("a891ArmPostFileQuietHome")(); U.B.get("a891HomeChogTap")();
    assert.equal(U.calls.baseArm, 1); assert.equal(U.calls.baseTap, 1); assert.equal(U.calls.cue, 0);
  }
});
await check("6 fork profile: Money permission (Face ID) runs only after a fresh server OK; none / other instance / server down = not run, nothing changed", async () => {
  const S = server(); const j1 = S.addJ1(P, 500);
  const T0 = harness({ profile: FORK, fetchImpl: S.fetchImpl });
  await T0.B.get("requestMoneyPermission")(); assert.equal(T0.calls.money, 0, "no entry yet");
  assert.equal((await C.requestForkEntry({ fetchImpl: S.fetchImpl, invite: TOKEN, piggyAddress: P, signMessage: (m) => PIGGY.signMessage({ message: m }), journey1: j1 })).allowed, true);
  const T = harness({ profile: FORK, fetchImpl: S.fetchImpl });
  const n0 = S.st.statusCalls;
  await T.B.get("requestMoneyPermission")(); await T.B.get("requestMoneyPermission")();
  assert.equal(T.calls.money, 2); assert.equal(S.st.statusCalls - n0, 2, "asked the server each time");
  S.st.instance = "fork-143-110874000-20261012t000000z-22222222";
  await T.B.get("requestMoneyPermission")(); assert.equal(T.calls.money, 2, "fork instance changed → refused until re-entry");
  const T2 = harness({ profile: FORK, fetchImpl: async () => { throw new Error("offline"); } });
  await T2.B.get("requestMoneyPermission")(); assert.equal(T2.calls.money, 0);
  const T3 = harness({ profile: FORK, invite: null, fetchImpl: S.fetchImpl });
  await T3.B.get("requestMoneyPermission")(); assert.equal(T3.calls.money, 0);
  const T4 = harness({ profile: TESTNET, fetchImpl: realFetchTrap }); const nc = netCalls;
  await T4.B.get("requestMoneyPermission")(); assert.equal(T4.calls.money, 1, "testnet money path unchanged (no server call)"); assert.equal(netCalls, nc);
});
await check("5 in main.js: the registered probe reports signing while a counted signer flow runs (Gift claim / funding proof / Money / entry) and First send state", async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const T = harness({ profile: TESTNET, stubs: { settleBoundGiftClaim: async () => { await gate; return "done"; } } });
  const s = mkStorage();
  assert.equal(journeySwitchBlocker(s), null);
  const running = T.B.get("settleBoundGiftClaim")();
  assert.equal(journeySwitchBlocker(s), "signing", "a signer flow in progress");
  assert.equal(switchJourney(2, { storage: s, loc: mkLoc() }), false);
  release(); assert.equal(await running, "done");
  assert.equal(journeySwitchBlocker(s), null, "free again afterwards");
  T.B.set("sendInFlight", true); assert.equal(journeySwitchBlocker(s), "signing", "First send in flight");
  T.B.set("sendInFlight", false); T.B.set("readSendPending", () => ({ stage: "deposit-broadcast" })); assert.equal(journeySwitchBlocker(s), "unconfirmed_tx");
  registerJourneySwitchBusyProbe(null);
});
await check("network 0 (all server traffic in-process)", () => { assert.equal(netCalls, 0); });
console.log(`\nA-956 entry app: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
