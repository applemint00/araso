// [A-1315 · Owner 15:4x] "Couldn't find your Piggy." branch ③: Face ID cancelled / failed with no passkey answering (credentialFound
// false, not a time-out) used to send no piggy_find event, so the live record could not tell it from ① ②. Now it sends one word.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { EVENT_CODES, validEvent } from "../src/event-schema.js";
const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const fnBody = (name) => { const i = MAIN.indexOf(`function ${name}(`); assert.ok(i >= 0, `${name} missing`); let d = 0; for (let k = MAIN.indexOf("{", i); k < MAIN.length; k += 1) { if (MAIN[k] === "{") d += 1; else if (MAIN[k] === "}" && --d === 0) return MAIN.slice(i, k + 1); } throw new Error(name); };
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log("PASS", n); } catch (e) { fail += 1; console.log("FAIL", n, "—", String(e.message).split("\n")[0]); } };
const err = (name) => Object.assign(new Error(name), { name });
// the app sees a cancelled Face ID as the Mera wrapper whose cause is NotAllowedError (isCancelledAuthError)
const mera = (causeName) => Object.assign(new Error("mera"), { name: "MeraError", mera: true, cause: { name: causeName } });
check("③ cancelled / failed with no passkey answering → its own piggy_find word (spy on track)", () => {
  const ctx = { isMeraError: (e) => e?.mera === true }; vm.runInNewContext(`${fnBody("isCancelledAuthError")}\n${fnBody("piggyFindAfterGetCode")}\n${fnBody("piggyFindFailCode")}\nthis.f = piggyFindFailCode;`, ctx);
  const seen = [];
  const track = (step, code) => seen.push(`${step}:${code}`);
  for (const [e, found] of [[mera("NotAllowedError"), false], [mera("NotFoundError"), false]]) { const code = ctx.f(e, found); if (code) track("piggy_find", code); }
  assert.deepEqual(seen, ["piggy_find:get_cancel", "piggy_find:get_fail"]);
});
check("① ② unchanged: a passkey answered or the wait timed out → the same after_get_* words", () => {
  const ctx = { isMeraError: (e) => e?.mera === true }; vm.runInNewContext(`${fnBody("isCancelledAuthError")}\n${fnBody("piggyFindAfterGetCode")}\n${fnBody("piggyFindFailCode")}\nthis.f = piggyFindFailCode;`, ctx);
  assert.equal(ctx.f(err("PiggyIdentityMismatch"), true), "after_get_mismatch");
  assert.equal(ctx.f(err("NotAllowedError"), true), "after_get_other");
  assert.equal(ctx.f(err("AuthWaitTimeout"), false), "after_get_timeout");
});
check("checkPiggy's failure tracks every branch through piggyFindFailCode; the screen line is unchanged", () => {
  const body = fnBody("checkPiggy");
  assert.match(body, /track\("piggy_find", piggyFindFailCode\(error, credentialFound\)\)/);
  assert.match(body, /setScene\("birth", "Chog could not find Piggy here\.", "Couldn't find your Piggy\."\);\n    return \{ ok: false, cancelled: state\.authCancelled \};/);
});
check("event schema allows the two words (the server checks the same list)", () => {
  for (const code of ["get_cancel", "get_fail"]) { assert.ok(EVENT_CODES.piggy_find.includes(code), code); assert.equal(validEvent({ step: "piggy_find", code }), true); }
});
console.log(`A1315 piggy_find ③ ${pass} PASS / ${fail} FAIL / 0 SKIP`);
if (fail) process.exit(1);
