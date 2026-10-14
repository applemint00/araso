import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

let main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
if (process.env.A1263_MUTATION === "bypass_public_cut") {
  main = main.replace('if (a1160PublicEntryOpen()) return null;', 'if (false) return null;');
}

function fn(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(main);
  assert.ok(match, name);
  return main.slice(match.index, main.indexOf("\n}\n", match.index) + 2);
}

let pass = 0;
async function check(name, run) {
  await run();
  pass += 1;
  console.log(`PASS ${name}`);
}

await check("one decision: public ON returns null without reading stored/hash invite", () => {
  let reads = 0;
  const ctx = vm.createContext({ RELEASE_LEVEL: 2, state: { publicEntryOpen: true } });
  vm.runInContext(`${fn("a1160PublicEntryOpen")}\n${fn("a1263ServerInvite")}`, ctx);
  ctx.readInvite = () => { reads += 1; return "stored-invite-a1263"; };
  assert.equal(vm.runInContext("a1263ServerInvite(readInvite)", ctx), null);
  assert.equal(reads, 0);
});

await check("public OFF and UNKNOWN return the existing reader value byte-for-byte", () => {
  for (const publicEntryOpen of [false, undefined]) {
    const ctx = vm.createContext({ RELEASE_LEVEL: 2, state: { publicEntryOpen }, value: "stored-invite-a1263" });
    vm.runInContext(`${fn("a1160PublicEntryOpen")}\n${fn("a1263ServerInvite")}`, ctx);
    assert.equal(vm.runInContext("a1263ServerInvite(() => value)", ctx), "stored-invite-a1263");
  }
});

await check("boot waits for public_state, then skips invite_state only when public is ON", async () => {
  const source = fn("a1263StartEntryChecks");
  assert.match(source, /await a1160RefreshPublicEntry\(\);[\s\S]*a1263ServerInvite[\s\S]*await a1158PrefetchInvite\(\)/);
  for (const open of [true, false, undefined]) {
    const calls = [];
    const ctx = vm.createContext({
      a1160RefreshPublicEntry: async () => { calls.push("public_state"); },
      a1160PublicEntryOpen: () => open === true,
      a1209EntryInvite: () => { throw new Error("boot must not pre-read outside prefetch"); },
      a1158PrefetchInvite: async () => { calls.push("invite_read", "invite_state"); },
    });
    vm.runInContext(`${fn("a1263ServerInvite")}\n${source}`, ctx);
    await ctx.a1263StartEntryChecks();
    assert.deepEqual(calls, open === true ? ["public_state"] : ["public_state", "invite_read", "invite_state"]);
  }
});

await check("invite_state, grant bind, challenge/enter and status all use the decision", () => {
  for (const name of ["a1158PrefetchInvite", "a960BindInvite", "a956Enter", "a956ForkMoneyAllowed"]) {
    assert.match(fn(name), /a1263ServerInvite\(/, name);
  }
  assert.doesNotMatch(fn("a1158PrefetchInvite"), /const invite = (?!a1263ServerInvite)/);
  assert.doesNotMatch(fn("a960BindInvite"), /const invite = (?!a1263ServerInvite)/);
});

await check("public ON disables used/foreign cleanup while retaining the old OFF branch", () => {
  assert.match(fn("a1223UsedInviteBlocked"), /a1263ServerInvite\(/);
  assert.match(fn("a1255MaybeClearKnownForeignInvite"), /a1263ServerInvite\([\s\S]*return false/);
  assert.match(fn("a1255ReconcileRecoveredInvite"), /a1263ServerInvite\([\s\S]*return "unchanged"/);
  assert.match(fn("a1255MaybeClearKnownForeignInvite"), /a1255ClearForeignUsedInvite\(\)/);
  assert.match(fn("a1255ReconcileRecoveredInvite"), /a1255ClearForeignUsedInvite\(\)/);
});

await check("the two reopen sites use resting copy and immediate send failure copy stays unchanged", () => {
  assert.match(fn("reconcileSendPending"), /return \{ kind: "never-sent" \};[\s\S]*|setScene\("sendstay", "Piggy is home\.", ""\)/);
  const boot = main.slice(main.indexOf("if (LEGACY_TESTNET_PATH) {\n  holdSendTabLock();"), main.indexOf("// [A-666] Owner-identified top-left HISTORY dot"));
  assert.match(boot, /setScene\("sendstay", "Piggy is home\.", ""\)/);
  assert.match(fn("sendPiggyOnce"), /setScene\("sendstay", "Piggy could not get ready\.", ""\)/);
});

console.log(`A1263 ${pass} PASS / 0 FAIL / 0 SKIP`);
