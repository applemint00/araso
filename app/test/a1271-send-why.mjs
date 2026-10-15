// A send failure tells the server WHERE it broke with a fixed word (never a message, address or hash),
// so a live "Piggy could not get ready." can be read from events without the tester's phone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { EVENT_CODES, validEvent } from "../src/event-schema.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(path.resolve(HERE, "../src/main.js"), "utf8");
let pass = 0, fail = 0;
const check = (label, fn) => { try { fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${e.message.split("\n")[0]}`); fail += 1; } };
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
const WHY = ["auth", "sign", "refused", "broadcast", "mismatch", "unconfirmed", "redeem", "locked", "insufficient", "nonce", "fee", "other"];

check("schema: send_why carries only fixed words", () => {
  assert.deepEqual([...EVENT_CODES.send_why], WHY);
  assert.equal(validEvent({ step: "send_why", code: "broadcast" }), true);
  assert.equal(validEvent({ step: "send_why", code: "0xabc" }), false);
});

let sendWhy;
check("main.js: sendFailureWhy maps each failure to one word", () => {
  const ctx = {};
  vm.runInNewContext(`${fnBody("safeErrorCategory")}\n${fnBody("safeErrorCode")}\n${fnBody("safeRpcMessagePrefix")}\n${fnBody("sendFailureWhy")}\nthis.f = sendFailureWhy;`, ctx);
  sendWhy = ctx.f;
  const E = (message, extra = {}) => Object.assign(new Error(message), extra);
  const rows = [
    [E("send_prepared_refused:fee_out_of_bounds"), "refused"],
    [E("send_hash_mismatch"), "mismatch"],
    [E("deposit unconfirmed or reverted"), "unconfirmed"],
    [E("send_redeem_nonce_unexpected"), "redeem"],
    [E("app_locked_before_sign"), "locked"],
    [E("send_lock_not_held"), "locked"],
    [E("send_pending_not_owned"), "locked"],
    [E("send_nonce_missing"), "sign"],
    [E("send_sign_failed"), "sign"],
    [Object.assign(new Error("user cancelled"), { name: "NotAllowedError" }), "auth"],
    [E("rpc refused", { code: -32000 }), "broadcast"],
    [Object.assign(new Error("x"), { name: "InvalidInputRpcError" }), "broadcast"],
    [E("insufficient funds for gas * price + value"), "insufficient"],
    [E("insufficient funds for gas * price + value", { code: -32000 }), "insufficient"],
    [E("nonce too low"), "nonce"],
    [E("max fee per gas less than block base fee"), "fee"],
    [E("something else"), "other"],
    [null, "other"],
  ];
  for (const [err, want] of rows) assert.equal(sendWhy(err), want, `${err && err.message} → ${want}`);
  for (const [err] of rows) assert.ok(WHY.includes(sendWhy(err)));
});

check("main.js: recordSafeError sends send_why right after send/fail (send phase only)", () => {
  const body = fnBody("recordSafeError");
  assert.match(body, /if \(phase === "send"\) track\("send_why", sendFailureWhy\(error\)\);/);
});

console.log(`\nA1271 send_why: ${pass} PASS / ${fail} FAIL`);
if (fail) process.exitCode = 1;
