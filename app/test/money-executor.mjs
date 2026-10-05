// [A-693 / A-680 M1] money-executor.js: the single broadcast chokepoint — order, fail-closed, source invariant.
//   node app/test/money-executor.mjs
// No network, no browser, no tx: every client is a local fake.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";

import { executeMoneyStep, MONEY_EXECUTOR_ORDER, TRANSPORT_KIND } from "../src/money-executor.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`PASS  ${label}`);
    pass += 1;
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${String(e && e.stack ? e.stack : e).split("\n").slice(0, 4).join("\n      ")}`);
    fail += 1;
  }
}

const ACCT = "0x" + "b".repeat(40);
const TO = "0x" + "c".repeat(40);
const TX = { to: TO, data: "0x1234" };
const HASH = `0x${"11".repeat(32)}`;
const RAW = "0x02f8aabbccddeeff";
const RAW_HASH = keccak256(RAW);

// A harness that logs every call in order, with per-phase switches.
function rig({ transport = "compat", fail: failPhase = null, throwPhase = null, sendThrows = false, sendReturns = HASH, hashFailTimes = 0, rawReturns = null, sign = "ok" } = {}) {
  const log = [];
  let hashAttempts = 0;
  const hook = (name, extra) => async (arg) => {
    log.push(name);
    if (throwPhase === name) throw new Error("hook boom");
    if (failPhase === name) return { ok: false, reason: `${name}_refused` };
    if (extra) return extra(arg);
    return { ok: true };
  };
  const hooks = {
    authorize: hook("authorize"),
    reserve: hook("reserve"),
    persistNonce: hook("persist_nonce"),
    persistHash: hook("persist_hash", () => {
      hashAttempts += 1;
      return hashAttempts <= hashFailTimes ? { ok: false, reason: "disk" } : { ok: true };
    }),
  };
  const account = { address: ACCT, async signTransaction(t) { log.push("sign"); if (sign === "throw") throw new Error("sign boom"); assert.equal("account" in t, false, "account is stripped before signing"); return sign === "garbage" ? 42 : RAW; } };
  let transportObj;
  const calls = { send: 0, sendRaw: 0, sendTx: 0 };
  if (transport === "compat") {
    transportObj = { kind: TRANSPORT_KIND.LANE_EXECUTOR, executor: { async send() { log.push("broadcast"); calls.send += 1; if (sendThrows) throw new Error("net"); return { hash: sendReturns }; } } };
  } else if (transport === "viem_send") {
    transportObj = { kind: TRANSPORT_KIND.VIEM_SEND, account, walletClient: { async sendTransaction(t) { log.push("broadcast"); calls.sendTx += 1; assert.equal(t.account, account); if (sendThrows) throw new Error("net"); return sendReturns; } } };
  } else {
    transportObj = {
      kind: TRANSPORT_KIND.VIEM_RAW, account,
      // [A-768 M-C-1 harness wiring] a well-formed Monad-testnet eip1559 request — the strict path now checks it before signing.
      walletClient: { async prepareTransactionRequest(t) { return { ...t, type: "eip1559", chainId: 10143, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, nonce: 7, gas: 21000n }; } },
      publicClient: { async sendRawTransaction({ serializedTransaction }) { log.push("broadcast"); calls.sendRaw += 1; assert.equal(serializedTransaction, RAW); if (sendThrows) throw new Error("net"); return rawReturns ?? RAW_HASH; } },
    };
  }
  return { log, calls, args: { tx: TX, transport: transportObj, ...hooks } };
}

await check("order constant is exactly authorize -> reserve -> persist_nonce -> sign -> persist_hash -> broadcast", () => {
  assert.deepEqual([...MONEY_EXECUTOR_ORDER], ["authorize", "reserve", "persist_nonce", "sign", "persist_hash", "broadcast"]);
});

await check("H2 strict (sign-before-send): call order is authorize, reserve, persist_nonce, sign, persist_hash, broadcast; hash is the keccak of the signed bytes, persisted BEFORE the broadcast", async () => {
  const r = rig({ transport: "raw" });
  const out = await executeMoneyStep(r.args);
  assert.deepEqual(r.log, ["authorize", "reserve", "persist_nonce", "sign", "persist_hash", "broadcast"]);
  assert.deepEqual(out.order, r.log);
  assert.equal(out.ok, true); assert.equal(out.status, "broadcast"); assert.equal(out.hash, RAW_HASH); assert.equal(out.nonce, 7); assert.equal(out.signedBeforeSend, true);
});

await check("H2 compat transports: authorize, reserve, persist_nonce, broadcast, persist_hash — and the result says the hash was NOT signed-before-send", async () => {
  for (const t of ["compat", "viem_send"]) {
    const r = rig({ transport: t });
    const out = await executeMoneyStep(r.args);
    assert.deepEqual(r.log, ["authorize", "reserve", "persist_nonce", "broadcast", "persist_hash"], t);
    assert.equal(out.ok, true, t); assert.equal(out.hash, HASH, t); assert.equal(out.signedBeforeSend, false, t);
  }
});

await check("H3 authorize refused (expired/consumed/mismatch/locked): nothing after it runs — no reserve, no sign, no broadcast", async () => {
  for (const t of ["compat", "raw"]) {
    const r = rig({ transport: t, fail: "authorize" });
    const out = await executeMoneyStep(r.args);
    assert.deepEqual(r.log, ["authorize"], t);
    assert.deepEqual([out.ok, out.status, out.phase, out.reason], [false, "blocked", "authorize", "authorize_refused"], t);
    assert.equal(out.broadcastAttempted, false);
  }
});

await check("reserve / persist_nonce refused -> blocked at that phase, zero sends, nothing signed", async () => {
  for (const [phase, expectLog] of [["reserve", ["authorize", "reserve"]], ["persist_nonce", ["authorize", "reserve", "persist_nonce"]]]) {
    for (const t of ["compat", "raw"]) {
      const r = rig({ transport: t, fail: phase });
      const out = await executeMoneyStep(r.args);
      assert.deepEqual(r.log, expectLog, `${phase}/${t}`);
      assert.deepEqual([out.status, out.phase], ["blocked", phase]);
      assert.equal(r.calls.send + r.calls.sendRaw + r.calls.sendTx, 0);
    }
  }
});

await check("a hook that THROWS is a refusal (fail-closed), never a pass", async () => {
  for (const phase of ["authorize", "reserve", "persist_nonce"]) {
    const r = rig({ throwPhase: phase });
    const out = await executeMoneyStep(r.args);
    assert.equal(out.status, "blocked"); assert.equal(out.reason, "hook_threw"); assert.equal(r.calls.send, 0);
  }
});

await check("strict: sign throws / returns garbage -> blocked at sign, no persist_hash, no broadcast", async () => {
  for (const sign of ["throw", "garbage"]) {
    const r = rig({ transport: "raw", sign });
    const out = await executeMoneyStep(r.args);
    assert.deepEqual([out.status, out.phase, out.reason], ["blocked", "sign", "sign_failed"], sign);
    assert.equal(r.calls.sendRaw, 0);
    assert.equal(r.log.includes("persist_hash"), false);
  }
});

await check("A2 strict: the hash cannot be persisted -> NOT broadcast (zero sendRaw), hash returned, blocked", async () => {
  const r = rig({ transport: "raw", hashFailTimes: 99 });
  const out = await executeMoneyStep(r.args);
  assert.deepEqual([out.status, out.phase, out.reason], ["blocked", "persist_hash", "hash_not_persisted"]);
  assert.equal(r.calls.sendRaw, 0); assert.equal(out.hash, RAW_HASH); assert.equal(out.broadcastAttempted, false);
});

await check("strict: sendRaw throws -> send_outcome_unknown WITH the already-persisted hash (reload classifies by hash); a different returned hash -> unknown/hash_mismatch", async () => {
  const t = rig({ transport: "raw", sendThrows: true });
  const o1 = await executeMoneyStep(t.args);
  assert.deepEqual([o1.status, o1.reason, o1.hash, o1.broadcastAttempted], ["send_outcome_unknown", "send_outcome_unknown", RAW_HASH, true]);
  const m = rig({ transport: "raw", rawReturns: `0x${"99".repeat(32)}` });
  const o2 = await executeMoneyStep(m.args);
  assert.deepEqual([o2.status, o2.reason], ["send_outcome_unknown", "hash_mismatch"]);
});

await check("compat: send throws / returns no hash / returns a non-hash -> send_outcome_unknown, no auto-retry, persist_hash never called", async () => {
  for (const variant of [{ sendThrows: true }, { sendReturns: null }, { sendReturns: "0x12" }, { sendReturns: 123 }]) {
    const r = rig(variant);
    const out = await executeMoneyStep(r.args);
    assert.deepEqual([out.ok, out.status, out.broadcastAttempted], [false, "send_outcome_unknown", true], JSON.stringify(variant));
    assert.equal(r.calls.send, 1, "sent exactly once");
    assert.equal(r.log.includes("persist_hash"), false);
  }
});

await check("R6/R7 compat: hash write fails 3x -> unknown_hash_unsaved with the hash in the result; succeeds on the 2nd try -> broadcast; never re-sends", async () => {
  const bad = rig({ hashFailTimes: 99 });
  const o = await executeMoneyStep(bad.args);
  assert.deepEqual([o.ok, o.status, o.reason, o.hash], [false, "unknown_hash_unsaved", "unknown_hash_unsaved", HASH]);
  assert.equal(bad.log.filter((x) => x === "persist_hash").length, 3, "bounded, immediate retries");
  assert.equal(bad.calls.send, 1);
  const flaky = rig({ hashFailTimes: 1 });
  const o2 = await executeMoneyStep(flaky.args);
  assert.deepEqual([o2.ok, o2.status], [true, "broadcast"]);
  assert.equal(flaky.calls.send, 1);
  const capped = rig({ hashFailTimes: 99 });
  await executeMoneyStep({ ...capped.args, hashSaveAttempts: 1000 });
  assert.ok(capped.log.filter((x) => x === "persist_hash").length <= 5, "attempts are capped");
});

await check("requireSignBeforeSend refuses every compat transport before ANY hook runs", async () => {
  for (const t of ["compat", "viem_send"]) {
    const r = rig({ transport: t });
    const out = await executeMoneyStep({ ...r.args, requireSignBeforeSend: true });
    assert.deepEqual([out.status, out.reason], ["blocked", "sign_before_send_unavailable"]);
    assert.deepEqual(r.log, []);
  }
  const ok = rig({ transport: "raw" });
  assert.equal((await executeMoneyStep({ ...ok.args, requireSignBeforeSend: true })).ok, true);
});

await check("misconfiguration is refused before any hook: bad tx, no/unknown/incomplete transport, missing hooks", async () => {
  const base = rig().args;
  const cases = [
    [{ ...base, tx: null }, "invalid_tx"],
    [{ ...base, tx: { to: "nope", data: "0x" } }, "invalid_tx"],
    [{ ...base, transport: null }, "no_transport"],
    [{ ...base, transport: { kind: "weird" } }, "unknown_transport"],
    [{ ...base, transport: { kind: TRANSPORT_KIND.VIEM_SEND, account: { address: ACCT }, walletClient: {} } }, "transport_incomplete"],
    [{ ...base, transport: { kind: TRANSPORT_KIND.VIEM_RAW, account: { address: ACCT }, walletClient: {}, publicClient: {} } }, "transport_incomplete"],
    [{ ...base, authorize: undefined }, "executor_misconfigured"],
    [{ ...base, reserve: undefined }, "executor_misconfigured"],
    [{ ...base, persistHash: undefined }, "executor_misconfigured"],
    [{ ...base, persistNonce: "yes" }, "executor_misconfigured"],
  ];
  for (const [args, reason] of cases) {
    const out = await executeMoneyStep(args);
    assert.deepEqual([out.ok, out.status, out.reason], [false, "blocked", reason]);
    assert.deepEqual(out.order, []);
  }
  assert.equal((await executeMoneyStep()).status, "blocked");
});

await check("persist_nonce is optional (omitted -> skipped, not faked); a hook returning plain true passes, plain false refuses", async () => {
  const r = rig({ transport: "compat" });
  const { persistNonce, ...rest } = r.args;
  const out = await executeMoneyStep({ ...rest, authorize: () => true, reserve: () => true });
  assert.equal(out.ok, true);
  assert.deepEqual(out.order, ["authorize", "reserve", "broadcast", "persist_hash"]);
  const no = await executeMoneyStep({ ...rest, authorize: () => false });
  assert.equal(no.status, "blocked");
});

// ── H1: source invariant ─────────────────────────────────────────────────────────────────────────
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const CALL = /\.sendTransaction\s*\(|\.sendRawTransaction\s*\(|\bexecutor\s*\.\s*send\s*\(/g;

await check("H1 source invariant: broadcast calls exist only in money-executor.js, First's two legacy sites in main.js, and the HELD Gift claim entry", () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith(".js"));
  const hits = {};
  for (const f of files) {
    const n = (strip(readFileSync(path.join(SRC, f), "utf8")).match(CALL) || []).length;
    if (n) hits[f] = n;
  }
  const allowed = { "money-executor.js": null, "main.js": 2, "gift-claim-entry.js": 2 };
  for (const f of Object.keys(hits)) assert.ok(f in allowed, `unexpected broadcast call site in ${f} (${hits[f]}): route it through money-executor.js`);
  assert.ok(hits["money-executor.js"] >= 3, "the chokepoint itself holds the send calls");
  assert.equal(hits["main.js"], 2, "main.js: exactly First's deposit + redeem (legacy, separately scoped M2); a new site fails this test");
  assert.equal(hits["gift-claim-entry.js"], 2, "gift-claim-entry.js: held (G1); must route through the executor before any enablement");
});

await check("H1: the Second plumbing adapter and the mainnet lane have no direct broadcast call and DO import the executor", () => {
  for (const f of ["second-execution-adapter.js", "mainnet-job-lane.js"]) {
    const raw = readFileSync(path.join(SRC, f), "utf8");
    assert.equal((strip(raw).match(CALL) || []).length, 0, `${f}: direct broadcast`);
    assert.match(raw, /from "\.\/money-executor\.js"/, `${f}: executor import`);
    assert.match(strip(raw), /executeMoneyStep\(/, `${f}: executor use`);
  }
});

await check("the executor itself: no storage access, no network, no key material, no timers", () => {
  const code = strip(readFileSync(path.join(SRC, "money-executor.js"), "utf8"));
  assert.equal(/localStorage|sessionStorage|\.getItem\(|\.setItem\(|fetch\(|XMLHttpRequest|WebSocket|setTimeout|setInterval|privateKey|mnemonic|prf/i.test(code), false);
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
