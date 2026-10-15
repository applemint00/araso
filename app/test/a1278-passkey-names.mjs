// Each passkey this site makes gets its own picker name; known local passkeys are excluded from a second create; a saved Piggy
// name renames the passkey only where the browser has the Signal API (no error anywhere else).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (label, fn) => { try { fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${String(e.message).split("\n")[0]}`); fail += 1; } };
function fnBody(name) {
  const m = MAIN.match(new RegExp(`function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = MAIN.indexOf("{", MAIN.indexOf(")", m.index)); i < MAIN.length; i += 1) {
    if (MAIN[i] === "{") depth += 1;
    else if (MAIN[i] === "}") { depth -= 1; if (depth === 0) return MAIN.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}

check("create name: unique per create, English, minute precision; the constant name is gone", () => {
  const ctx = {}; vm.runInNewContext(`${fnBody("passkeyCreateName")}\nthis.f = passkeyCreateName;`, ctx);
  assert.equal(ctx.f(new Date(2026, 9, 15, 9, 5)), "Araso Piggy · 2026-10-15 09:05");
  assert.notEqual(ctx.f(new Date(2026, 9, 15, 9, 5)), ctx.f(new Date(2026, 9, 15, 9, 6)));
  assert.doesNotMatch(MAIN, /name: "araso-owner"/);
  assert.match(MAIN, /user: \{ name: passkeyName, displayName: passkeyName \}/);
});

check("exclude: only ids this device already knows (stored · late-created · pending birth); a Gift claim never excludes", () => {
  const ctx = { readCredential: () => ({ credentialId: "aaa_-1" }), lateCreatedCredential: { credentialId: "bbb" }, a1214ReadPendingBirth: () => ({ credentialId: "aaa_-1" }) };
  vm.runInNewContext(`${fnBody("knownLocalPasskeyIds")}\nthis.f = knownLocalPasskeyIds;`, ctx);
  assert.deepEqual([...ctx.f()], ["aaa_-1", "bbb"]);
  const none = { readCredential: () => null, lateCreatedCredential: null };
  vm.runInNewContext(`${fnBody("knownLocalPasskeyIds")}\nthis.f = knownLocalPasskeyIds;`, none);
  assert.deepEqual([...none.f()], []);
  assert.match(MAIN, /a1212CreateEnableOnly\(\), giftIntent \|\| typeof knownLocalPasskeyIds !== "function" \? \[\] : knownLocalPasskeyIds\(\)\);/);
  assert.match(fnBody("a1202CreatePasskey"), /\.\.\.\(excludeIds\.length \? \{ excludeCredentials: excludeIds\.map\(\(id\) => \(\{ type: "public-key", id: passkeyFromB64Url\(id\) \}\)\) \} : \{\}\)/);
});

check("rename: Signal API present → called once with the stored user handle; absent → nothing, no error", () => {
  const calls = [];
  const store = new Map([["araso.pkUserHandle.v1", "h4nd1e"]]);
  const mk = (PKC) => { const ctx = { globalThis: { PublicKeyCredential: PKC }, localStorage: { getItem: (k) => store.get(k) ?? null }, getRpId: () => "localhost", Promise, PASSKEY_USER_HANDLE_KEY: "araso.pkUserHandle.v1" };
    vm.runInNewContext(`${fnBody("renamePasskeyForPiggy")}\nthis.f = renamePasskeyForPiggy;`, ctx); return ctx.f; };
  assert.equal(mk({ signalCurrentUserDetails: (o) => { calls.push(o); return Promise.resolve(); } })("Pa"), true);
  assert.equal(JSON.stringify(calls), JSON.stringify([{ rpId: "localhost", userId: "h4nd1e", name: "Pa", displayName: "Pa" }]));
  assert.equal(mk({})("Pa"), false);
  assert.equal(mk(undefined)("Pa"), false);
  store.clear();
  assert.equal(mk({ signalCurrentUserDetails: () => { throw new Error("x"); } })("Pa"), false, "no handle (passkey made before this) = nothing");
});

check("saving the first Piggy name asks for the rename right after the name is stored", () => {
  assert.match(fnBody("savePiggyName"), /localStorage\.setItem\(PIGGY_NAME_KEY, name\);\s*if \(typeof renamePasskeyForPiggy === "function"\) renamePasskeyForPiggy\(name\);/);
});

check("the PRF request on create is byte-for-byte the same line", () => {
  assert.match(fnBody("a1202CreatePasskey"), /extensions: \{ prf: enableOnly \? \{\} : \{ eval: \{ first: request\.prfSalt \} \} \},/);
});

console.log(`\nA1278 passkey names: ${pass} PASS / ${fail} FAIL`);
if (fail) process.exitCode = 1;
