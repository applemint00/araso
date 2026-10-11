// [A-965] The 9 executor permission requests ask chainMatchesExecutor (same chain, or the fork profile's table-owned forkOf 143) instead of
// an exact `profile.numericChainId !== X.chainId`. Checks: the fork profile now passes each chain line (and still issues nothing:
// permission null · createsPermission false · the request's chain = the fork binding's chain, not 143) · on 143 / 10143 / blocked /
// forged profiles every answer is deep-equal to the pre-change code (rebuilt from the current source by reversing exactly that one line,
// loaded from a temp mirror of src/) · another chain or a forged forkOf is still refused at the chain line · Aave untouched.
// Node only, no network, no tx.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as CP from "../src/chain-profile.js";

let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-965 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const sha = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex");

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
// [name, file, function, evidence constant used on the chain line, extra request input]
const JOBS = [
  ["euler", "mainnet-job-euler.js", "eulerPermissionRequest", "EULER_FORK_EVIDENCE", { amountRaw: "1000000000000000000" }],
  ["upshift", "mainnet-job-upshift.js", "upshiftPermissionRequest", "UPSHIFT_FORK_EVIDENCE", { amountRaw: "100000000" }],
  ["shmon", "mainnet-job-shmon.js", "shmonPermissionRequest", "SHMON_FORK_EVIDENCE", { amountWei: "1000000000000000000" }],
  ["kuru", "mainnet-job-kuru.js", "kuruPermissionRequest", "KURU_FORK_EVIDENCE", { action: "kuru_market_buy_mon_with_usdc", amountRaw: "5000000" }],
  ["revoke", "mainnet-job-revoke.js", "revokePermissionRequest", "REVOKE_FORK_EVIDENCE", { spender: "aavePool" }],
  ["neverland", "mainnet-job-neverland.js", "neverlandPermissionRequest", "NEVERLAND_FORK_EVIDENCE", { amountRaw: "1000000" }],
  ["curvance", "mainnet-job-curvance.js", "curvancePermissionRequest", "CURVANCE_FORK_EVIDENCE", { amountRaw: "1000000" }],
  ["lp", "mainnet-job-lp.js", "lpPermissionRequest", "LP_FORK_EVIDENCE", { amountRaw: "1000000" }],
  ["abil", "mainnet-job-abil.js", "abilPermissionRequest", "ABIL_RECORDED", { amountRaw: "1000000" }],
];
const NEW_LINE = (c, n) => `  if (!chainMatchesExecutor(profile, ${c}.chainId)) return { request: null, error: "profile_chain_not_${n}_evidence" }; // [fork-parent]`;
const OLD_LINE = (c, n) => `  if (profile.numericChainId !== ${c}.chainId) return { request: null, error: "profile_chain_not_${n}_evidence" };`;

// Temp mirror of src/: every entry is a symlink to the real file (so shared modules resolve to the same instances) except the 9
// executor files, which are the current source with exactly the chain line reversed to the pre-change exact comparison.
const MIRROR_ROOT = mkdtempSync(join(tmpdir(), "a965-pre-"));
const MIRROR = join(MIRROR_ROOT, "src");
mkdirSync(MIRROR);
// bare imports (viem) resolve from the nearest node_modules above src/, as they do for the real files
const NODE_MODULES = ["../node_modules", "../../node_modules"].map((r) => fileURLToPath(new URL(r, import.meta.url))).find((d) => existsSync(d));
symlinkSync(NODE_MODULES, join(MIRROR_ROOT, "node_modules"));
for (const e of readdirSync(SRC)) if (!JOBS.some(([, f]) => f === e)) symlinkSync(join(SRC, e), join(MIRROR, e));
for (const [n, f, , c] of JOBS) {
  const src = readFileSync(join(SRC, f), "utf8");
  assert.equal(src.split(NEW_LINE(c, n)).length - 1, 1, `${f}: the new chain line appears exactly once`);
  assert.equal(src.split(OLD_LINE(c, n)).length - 1, 0, `${f}: the old chain line is gone`);
  writeFileSync(join(MIRROR, f), src.replace(NEW_LINE(c, n), OLD_LINE(c, n)));
}
const NEW = {}, OLD = {};
try {
  for (const [n, f] of JOBS) {
    NEW[n] = await import(pathToFileURL(join(SRC, f)).href);
    OLD[n] = await import(pathToFileURL(join(MIRROR, f)).href);
  }
} finally { rmSync(MIRROR_ROOT, { recursive: true, force: true }); }

const PIGGY = { id: "piggy-1", address: "0xA98d88b97c59194f5DB518bE07A4DB23AEc0BE31" };
const FORK = CP.resolveChainProfile("monad-fork", { rpcUrl: "https://lab-fork.invalid", forkInstanceId: "a965" });
const MAINNET = CP.resolveChainProfile("monad-mainnet");
const TESTNET = CP.resolveChainProfile("monad-testnet");
const TESTNET_DEFAULT = CP.resolveChainProfile(undefined);
const BLOCKED = CP.resolveChainProfile("nope");
const call = (mod, n, fn, profile, extra) => mod[n][fn]({ profile, piggy: PIGGY, eventId: "evt-a965", ...extra });

await check("the mirror really holds the pre-change code: on the fork profile the old line refuses every one of the 9", () => {
  assert.equal(FORK.numericChainId, 31337143); assert.equal(FORK.forkOf, 143);
  for (const [n, , fn, , extra] of JOBS) assert.equal(call(OLD, n, fn, FORK, extra).error, `profile_chain_not_${n}_evidence`, n);
});

await check("fork profile: each of the 9 passes its chain line (evidence chain 143 = the fork's forkOf) and still issues nothing", () => {
  const seen = [];
  for (const [n, , fn, c, extra] of JOBS) {
    assert.equal((NEW[n][c] || NEW[n][`${n.toUpperCase()}_FORK_EVIDENCE`]).chainId, 143, `${n} evidence chain`); // ABIL_RECORDED is module-private; ABIL_FORK_EVIDENCE.chainId = it
    const r = call(NEW, n, fn, FORK, extra);
    assert.notEqual(r.error, `profile_chain_not_${n}_evidence`, n);
    if (r.request) {
      assert.equal(r.request.permission, null, n); assert.equal(r.request.createsPermission, false, n);
      assert.equal(r.request.chain, CP.bindRecordToProfile(FORK, { piggyId: PIGGY.id, piggyAddress: PIGGY.address }).binding.chain, `${n} request chain = the fork binding chain`);
      assert.notEqual(r.request.chain, MAINNET.scope, n);
    }
    seen.push(`${n}=${r.error || "request"}`);
  }
  console.log(`      fork: ${seen.join(" · ")}`);
  assert.ok(seen.every((s) => s.endsWith("=request")), "every one of the 9 reaches a request (no chain refusal, no binding refusal)");
});

// Every non-fork input the old line could see, plus forged variants. Deep-equal old vs new, then pinned by hash for the receipt.
const FORGED = [
  ["mainnet+forkOf143", { ...MAINNET, forkOf: 143 }],
  ["testnet+forkOf143", { ...TESTNET, forkOf: 143 }],
  ["testnet-as-1", { ...TESTNET, numericChainId: 1 }],
  ["mainnet-as-fork-chain", { ...MAINNET, numericChainId: 31337143 }],
  ["proto-forkOf", Object.assign(Object.create({ forkOf: 143 }), { ...MAINNET, id: "monad-testnet", numericChainId: 10143, scope: "monad-testnet" })],
];
const UNCHANGED = [["143", MAINNET], ["10143", TESTNET], ["10143-default", TESTNET_DEFAULT], ["blocked", BLOCKED], ["null", null], ...FORGED];
await check("143 · 10143 · blocked · forged profiles: every answer of the 9 is deep-equal to the pre-change code", () => {
  const out = {};
  for (const [n, , fn, , extra] of JOBS) for (const [label, profile] of UNCHANGED) {
    for (const ex of [extra, {}, { ...extra, amountRaw: "0", amountWei: "0" }]) {
      const a = call(NEW, n, fn, profile, ex), b = call(OLD, n, fn, profile, ex);
      assert.deepEqual(a, b, `${n} ${label}`);
      (out[`${n}:${label}`] ||= []).push(a);
    }
  }
  console.log(`      sha256(143/10143/blocked/forged answers, ${Object.keys(out).length} rows) = ${sha(out)}`);
});

await check("143 still passes the chain line (as before); 10143 still refused at it (as before)", () => {
  for (const [n, , fn, , extra] of JOBS) {
    assert.notEqual(call(NEW, n, fn, MAINNET, extra).error, `profile_chain_not_${n}_evidence`, n);
    assert.equal(call(NEW, n, fn, TESTNET, extra).error, `profile_chain_not_${n}_evidence`, n);
    assert.equal(call(NEW, n, fn, TESTNET_DEFAULT, extra).error, `profile_chain_not_${n}_evidence`, n);
  }
});

await check("another chain or a forged forkOf is refused at the chain line (fork forkOf string / 10143 / 1 · testnet forkOf 143 · inherited forkOf)", () => {
  const { forkOf: _f, ...forkNoForkOf } = FORK;
  const refused = [
    ["fork forkOf '143'", { ...FORK, forkOf: "143" }], ["fork forkOf 10143", { ...FORK, forkOf: 10143 }], ["fork forkOf 1", { ...FORK, forkOf: 1 }],
    ["fork without forkOf", forkNoForkOf], ["fork inherited forkOf", Object.assign(Object.create({ forkOf: 143 }), forkNoForkOf)],
    ["testnet forkOf 143", { ...TESTNET, forkOf: 143 }],
  ];
  for (const [n, , fn, , extra] of JOBS) for (const [label, profile] of refused) {
    assert.equal(call(NEW, n, fn, profile, extra).error, `profile_chain_not_${n}_evidence`, `${n} ${label}`);
  }
  for (const [n, , fn, , extra] of JOBS) assert.equal(call(NEW, n, fn, { ...FORK, status: "blocked" }, extra).error, "profile_blocked", n);
});

await check("source shape: each file changes the chain line only (+ import); Aave keeps its own 143-only lane check, no chainMatchesExecutor", () => {
  for (const [n, f, , c] of JOBS) {
    const src = readFileSync(join(SRC, f), "utf8");
    assert.match(src, /^import \{[^}]*\bchainMatchesExecutor\b[^}]*\} from "\.\/chain-profile\.js";$/m, f);
    assert.equal((src.match(/chainMatchesExecutor/g) || []).length, 2, `${f}: import + the one chain line`);
    assert.ok(!new RegExp(`numericChainId !== ${c}\\.chainId`).test(src), `${n}: no exact chain line left`);
  }
  const aave = readFileSync(join(SRC, "mainnet-job-aave.js"), "utf8");
  assert.ok(!/chainMatchesExecutor/.test(aave)); assert.match(aave, /isAaveLaneProfile/);
});

await check("no network", () => assert.equal(fetchCalls, 0));

console.log(`\nA-965 fork job permission chain: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
