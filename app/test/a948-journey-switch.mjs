// [A-948] One address, in-app journey switch. Node only, network 0. The card's regression table row by row: boot profile from
// (path, release level, stored journey, fork env) and whether the Second UI may open there (journeyFeatureOpen with that profile);
// "/claim" = exactly the pre-A-948 result; the stored journey is UX state, never a permission; switchJourney drops the signer, stores
// the journey and reloads "/".
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIM_PATH, JOURNEY_KEY, selectBootProfile, storedJourney } from "../src/boot-profile.js";
import { journeyFeatureOpen, releaseAllows } from "../src/release-gate.js";
import { registerJourneySessionDisposer, switchJourney } from "../src/journey-switch.js";
import { CHAIN_PROFILE_ID, resolveChainProfile } from "../src/chain-profile.js";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

let netCalls = 0;
globalThis.fetch = async () => { netCalls += 1; throw new Error("A-948 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(path.join(HERE, "..", "src", "main.js"), "utf8");
const FORK_ENV = { VITE_ARASO_FORK_RPC_URL: "https://fork-public.invalid/rpc", VITE_ARASO_FORK_INSTANCE_ID: "fork-1" };
const boot = (pathname, level, journey, forkEnv) => selectBootProfile({ pathname, env: forkEnv ? { ...FORK_ENV } : {}, releaseLevel: level, journey });
const secondOpen = (p, level) => ["second", "afterSecond"].map((f) => journeyFeatureOpen(f, { level, profile: p }));
const OPEN = [true, true], CLOSED = [false, false];

// ── the regression table ──
await check("row 1: \"/\" · level 1 · journey none/1/2 · fork env with/without → testnet · Second UI closed", () => {
  for (const j of [undefined, "1", "2"]) for (const env of [true, false]) {
    const p = boot("/", 1, j, env);
    assert.equal(p.id, CHAIN_PROFILE_ID.TESTNET, `${j}/${env}`); assert.deepEqual(secondOpen(p, 1), CLOSED, `${j}/${env}`);
  }
});
await check("row 2: \"/\" · level 2 · journey none/1 · fork env → testnet · Second UI CLOSED (the root hole)", () => {
  for (const j of [undefined, "1"]) { const p = boot("/", 2, j, true); assert.equal(p.id, CHAIN_PROFILE_ID.TESTNET); assert.deepEqual(secondOpen(p, 2), CLOSED); }
});
await check("row 3: \"/\" · level 2 · journey 2 · fork env → fork · Second UI open", () => {
  const p = boot("/", 2, "2", true); assert.equal(p.id, CHAIN_PROFILE_ID.FORK); assert.equal(p.status, "active"); assert.deepEqual(secondOpen(p, 2), OPEN);
});
await check("row 4: \"/\" · level 2 · journey 2 · NO fork env → testnet · closed (fail closed)", () => {
  const p = boot("/", 2, "2", false); assert.equal(p.id, CHAIN_PROFILE_ID.TESTNET); assert.deepEqual(secondOpen(p, 2), CLOSED);
});
await check("row 5: \"/j2\" · level 1 · any journey · fork env → testnet Journey 1", () => {
  for (const j of [undefined, "1", "2"]) { const p = boot("/j2", 1, j, true); assert.equal(p.id, CHAIN_PROFILE_ID.TESTNET); assert.deepEqual(secondOpen(p, 1), CLOSED); }
});
await check("row 6: \"/j2\" · level 2 · any journey · fork env → fork (A-946 path kept)", () => {
  for (const j of [undefined, "1", "2"]) { const p = boot("/j2", 2, j, true); assert.equal(p.id, CHAIN_PROFILE_ID.FORK); assert.deepEqual(secondOpen(p, 2), OPEN); }
});
await check("row 7: \"/claim\" · level 1/2 · journey 1/2 · fork env with/without → the pre-A-948 result (build config; Gift gate = level only)", () => {
  for (const level of [1, 2]) for (const j of ["1", "2"]) for (const env of [true, false]) for (const cfg of [undefined, "monad-mainnet", "monad-fork", "junk"]) {
    const e = { ...(env ? FORK_ENV : {}), ...(cfg ? { VITE_ARASO_CHAIN_PROFILE: cfg } : {}) };
    const got = selectBootProfile({ pathname: CLAIM_PATH, env: e, releaseLevel: level, journey: j });
    // pre-A-948 (A-946) for any path other than "/j2": the build config, the fork id there = BLOCKED
    const want = cfg === "monad-fork" ? { status: "blocked", reason: "fork_only_by_path" } : resolveChainProfile(cfg);
    assert.equal(got.id, want.id ?? null, `${level}/${j}/${env}/${cfg}`); assert.equal(got.status, want.status); if (want.reason) assert.equal(got.reason, want.reason);
    for (const p of [got, boot("/", level, j, env)]) assert.equal(journeyFeatureOpen("gift", { level, profile: p }), releaseAllows("gift", level), "Gift gate = level only, as before");
  }
});
await check("row 7 (snapshot): \"/claim\" byte-compared with the pre-A-948 boot-profile.js snapshot over 64 combinations", async () => {
  const snap = privatePath("ops", "receipts", "A948_journey_switch", "boot-profile.pre_A948.js");
  if (!existsSync(snap)) { console.log("      (snapshot is private-workspace only — public checkout: compared by the rule above)"); return; }
  // the snapshot imports ./chain-profile.js + ./release-gate.js: point them at the live modules (chain-profile unchanged by A-948; release-gate only appended)
  const srcDir = path.join(HERE, "..", "src");
  const text = readFileSync(snap, "utf8").replace(/from "\.\/(chain-profile|release-gate)\.js"/g, (m, n) => `from "${pathToFileURL(path.join(srcDir, `${n}.js`)).href}"`);
  const tmp = path.join(mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "a948-snap-")), "boot-profile.pre.mjs");
  writeFileSync(tmp, text);
  const pre = await import(pathToFileURL(tmp).href);
  let n = 0;
  for (const level of [1, 2]) for (const j of ["1", "2"]) for (const env of [true, false]) for (const cfg of [undefined, "monad-mainnet", "monad-fork", "junk"]) for (const extra of [{}, { VITE_ARASO_RELEASE_LEVEL: "2" }]) {
    const e = { ...(env ? FORK_ENV : {}), ...(cfg ? { VITE_ARASO_CHAIN_PROFILE: cfg } : {}), ...extra };
    assert.equal(JSON.stringify(selectBootProfile({ pathname: CLAIM_PATH, env: e, releaseLevel: level, journey: j })), JSON.stringify(pre.selectBootProfile({ pathname: CLAIM_PATH, env: e, releaseLevel: level })), `${level}/${j}/${env}/${cfg}`);
    n += 1;
  }
  assert.equal(n, 64);
});
await check("row 8: stored \"3\" / \"x\" / \"\" / storage throws / no storage → journey 1 (→ testnet at \"/\" even at level 2 with fork env)", () => {
  const st = (v) => ({ getItem: (k) => (k === JOURNEY_KEY ? v : null) });
  for (const s of [st("3"), st("x"), st(""), st(null), st(" 2"), { getItem() { throw new Error("denied"); } }, null]) {
    const j = storedJourney(s); assert.equal(j, "1"); assert.equal(boot("/", 2, j, true).id, CHAIN_PROFILE_ID.TESTNET);
  }
  assert.equal(storedJourney(st("2")), "2");
});
await check("mainnet build config keeps its paths: \"/\" with env monad-mainnet → mainnet at levels 1/2, journey ignored without fork env", () => {
  for (const level of [1, 2]) for (const j of ["1", "2"]) assert.equal(selectBootProfile({ pathname: "/", env: { VITE_ARASO_CHAIN_PROFILE: "monad-mainnet" }, releaseLevel: level, journey: j }).id, "monad-mainnet");
});

// ── the stored journey is not a permission ──
await check("stored journey ≠ permission: \"2\" stored on a level-1 build opens nothing; journeyFeatureOpen never reads storage", () => {
  assert.deepEqual(secondOpen(boot("/", 1, "2", true), 1), CLOSED);
  assert.deepEqual(secondOpen(resolveChainProfile("monad-fork", { rpcUrl: FORK_ENV.VITE_ARASO_FORK_RPC_URL, forkInstanceId: "f" }), 1), CLOSED, "fork profile but level 1 = closed");
  const rg = readFileSync(path.join(HERE, "..", "src", "release-gate.js"), "utf8").replace(/\/\/[^\n]*/g, "");
  assert.equal(/localStorage|sessionStorage|JOURNEY_KEY|journey\.v1/.test(rg), false);
  assert.equal(journeyFeatureOpen("second", { level: 2, profile: { id: "monad-fork", status: "blocked" } }), false, "a blocked fork profile opens nothing");
  assert.equal(journeyFeatureOpen("forkGift", { level: 2, profile: { id: "monad-testnet", status: "active" } }), false);
  assert.equal(journeyFeatureOpen("unknown", { level: 9, profile: { id: "monad-fork", status: "active" } }), false);
});
await check("release-gate's fork id literal = chain-profile CHAIN_PROFILE_ID.FORK", () => {
  assert.match(readFileSync(path.join(HERE, "..", "src", "release-gate.js"), "utf8"), new RegExp(`const FORK_PROFILE_ID = "${CHAIN_PROFILE_ID.FORK}";`));
});

// ── switchJourney + session boundary ──
const mkStorage = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const mkLoc = () => ({ origin: "https://arasoo.vercel.app", replaced: [], replace(u) { this.replaced.push(u); } });
await check("switchJourney(2): drops the signer FIRST, stores \"2\", reloads the same address \"/\"; the next boot is the fork", () => {
  const order = []; let signer = { key: "live" };
  const storage = mkStorage(); const loc = mkLoc();
  const realSet = storage.setItem; storage.setItem = (k, v) => { order.push("store"); realSet(k, v); };
  registerJourneySessionDisposer(() => { order.push("dispose"); signer = null; });
  loc.replace = function (u) { order.push("reload"); this.replaced.push(u); };
  assert.equal(switchJourney(2, { storage, loc }), true);
  assert.deepEqual(order, ["dispose", "store", "reload"]); assert.equal(signer, null);
  assert.equal(storage.m.get(JOURNEY_KEY), "2"); assert.deepEqual(loc.replaced, ["https://arasoo.vercel.app/"]);
  assert.equal(selectBootProfile({ pathname: "/", env: { ...FORK_ENV }, releaseLevel: 2, journey: storedJourney(storage) }).id, CHAIN_PROFILE_ID.FORK);
  registerJourneySessionDisposer(null);
});
await check("switchJourney(1) back: stores \"1\", next boot = testnet; bad values / storage failure = no write, no reload", () => {
  const storage = mkStorage(); const loc = mkLoc();
  assert.equal(switchJourney("1", { storage, loc }), true); assert.equal(storedJourney(storage), "1"); assert.equal(boot("/", 2, storedJourney(storage), true).id, CHAIN_PROFILE_ID.TESTNET);
  for (const bad of [0, 3, "3", null, undefined, "2 ", 2.5]) { const s2 = mkStorage(); const l2 = mkLoc(); assert.equal(switchJourney(bad, { storage: s2, loc: l2 }), false); assert.equal(s2.m.size, 0); assert.equal(l2.replaced.length, 0); }
  const l3 = mkLoc(); assert.equal(switchJourney(2, { storage: { setItem() { throw new Error("quota"); } }, loc: l3 }), false); assert.equal(l3.replaced.length, 0);
});
await check("session boundary in main.js: CHAIN_PROFILE assigned once (no in-page profile change) · the disposer registered = endActiveSession · signer memory-only", () => {
  const code = MAIN.replace(/\/\/[^\n]*/g, "");
  assert.equal([...code.matchAll(/(^|[^A-Za-z0-9_$.])CHAIN_PROFILE\s*=(?!=)/gm)].length, 1);
  assert.match(MAIN, /^registerJourneySessionDisposer\(endActiveSession\);/m);
  assert.match(MAIN, /function endSignerSession\(\) \{\n  activeSession\?\.end\(\);\n  activeSession = null;\n  activeAccount = null;/);
  assert.equal(/(localStorage|sessionStorage)\.setItem\([^)]*(activeSession|activeAccount|prfOutput|privateKey)/.test(MAIN), false);
});
await check("main.js: the 4 existing gate calls plus A1172 opt-in bell pass the page's level + CHAIN_PROFILE; boot line passes the stored journey", () => {
  assert.equal([...MAIN.replace(/^\/\/ ── \[A-974\] Fork app entry[\s\S]*?^\/\/ ── \[A-974\] end fork app entry ──\n/m, "").matchAll(/journeyFeatureOpen\("(second|afterSecond|gift)", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\)/g)].length, 5); // [A-974 re-pin] the one [A-974] fork entry block asks "second" once (pinned in a974-fork-app-entry.mjs); counted outside it. pre-A-974: MAIN
  assert.match(MAIN, /^const CHAIN_PROFILE = selectBootProfile\(\{ [^\n]*journey: storedJourney\(\) \}\);/m);
  assert.equal(/\breleaseAllows\(/.test(MAIN.replace(/\/\/[^\n]*/g, "")), false, "no level-only Second gate left in main.js");
});
await check("network 0", () => { assert.equal(netCalls, 0); });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
