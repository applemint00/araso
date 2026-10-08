// [A-913 E client side] The chain-truth reconcile table (README "Gift 7702 위임 안전 모델" 3) as a pure function. Exhaustive over booleans.
//   node app/test/a913-reconcile.mjs      (no network)
import assert from "node:assert/strict";
import { GIFT_SPONSOR_STEP as S, giftSponsorNextStep } from "../src/gift-sponsor-7702.js";

let pass = 0; let fail = 0;
async function check(label, fn) { try { await fn(); console.log(`PASS  ${label}`); pass += 1; } catch (e) { console.log(`FAIL  ${label}\n      ${String(e?.stack || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; } }
const T = (o) => ({ installed: false, commitExists: false, claimed: false, delegationDisabled: false, expired: false, sendUncertain: false, ...o });

await check("README table row by row", () => {
  assert.equal(giftSponsorNextStep(T({ installed: false })), S.START_OVER);                                                        // install 없음 / commit 없음
  assert.equal(giftSponsorNextStep(T({ installed: true })), S.CONTINUE_COMMIT);                                                    // install 있음 / commit 없음 / 허가 유효
  assert.equal(giftSponsorNextStep(T({ installed: true, expired: true })), S.REVOKE_THEN_WAIT_FACE_ID);                           // ... / 허가 만료
  assert.equal(giftSponsorNextStep(T({ installed: true, commitExists: true })), S.REVOKE_THEN_CLAIM);                             // commit 있음 / delegation 있음
  assert.equal(giftSponsorNextStep(T({ installed: true, commitExists: true, delegationDisabled: true })), S.CLAIM);               // commit 있음 / delegation 없음 (disabled)
  assert.equal(giftSponsorNextStep(T({ installed: false, commitExists: true, delegationDisabled: null })), S.CLAIM);              // commit 있음 / code 없음
  assert.equal(giftSponsorNextStep(T({ installed: true, commitExists: true, claimed: true })), S.REVOKE_CLEANUP);                 // claim 완료 / delegation 있음
  assert.equal(giftSponsorNextStep(T({ installed: true, commitExists: true, claimed: true, delegationDisabled: true })), S.DONE); // claim 완료 / delegation 없음
  assert.equal(giftSponsorNextStep(T({ installed: false, commitExists: true, claimed: true, delegationDisabled: null })), S.DONE);
});
await check("a possibly-landed send is NEVER repeated: sendUncertain true/unknown => read_receipt_first for every truth", () => {
  const bools = [true, false];
  for (const installed of bools) for (const commitExists of bools) for (const claimed of bools) for (const delegationDisabled of bools) for (const expired of bools) {
    const t = { installed, commitExists, claimed, delegationDisabled, expired };
    assert.equal(giftSponsorNextStep({ ...t, sendUncertain: true }), S.READ_RECEIPT_FIRST);
    assert.equal(giftSponsorNextStep({ ...t }), S.READ_RECEIPT_FIRST);                       // field absent
    assert.equal(giftSponsorNextStep({ ...t, sendUncertain: null }), S.READ_RECEIPT_FIRST);
    assert.equal(giftSponsorNextStep({ ...t, sendUncertain: "no" }), S.READ_RECEIPT_FIRST);
  }
});
await check("unknown needed fields never guess a step (installed / commit / claimed / delegation state / expiry)", () => {
  for (const k of ["installed", "commitExists", "claimed"]) for (const v of [null, undefined, "yes", 0]) assert.equal(giftSponsorNextStep(T({ installed: true, [k]: v })), S.READ_RECEIPT_FIRST, `${k}=${v}`);
  assert.equal(giftSponsorNextStep(T({ installed: true, commitExists: true, delegationDisabled: null })), S.READ_RECEIPT_FIRST);
  assert.equal(giftSponsorNextStep(T({ installed: true, claimed: true, commitExists: true, delegationDisabled: undefined })), S.READ_RECEIPT_FIRST);
  assert.equal(giftSponsorNextStep(T({ installed: true, expired: null })), S.READ_RECEIPT_FIRST);
  for (const bad of [null, undefined, 5, "x", []]) assert.equal(giftSponsorNextStep(bad), S.READ_RECEIPT_FIRST);
});
await check("exhaustive over all known truths: result is one of the eight steps; resend-capable steps only when nothing is uncertain", () => {
  const bools = [true, false]; const allowed = new Set(Object.values(S));
  let n = 0;
  for (const installed of bools) for (const commitExists of bools) for (const claimed of bools) for (const delegationDisabled of bools) for (const expired of bools) {
    const step = giftSponsorNextStep(T({ installed, commitExists, claimed, delegationDisabled, expired })); n += 1;
    assert.ok(allowed.has(step) && step !== S.READ_RECEIPT_FIRST, JSON.stringify({ installed, commitExists, claimed, delegationDisabled, expired }));
    if (claimed) assert.ok([S.REVOKE_CLEANUP, S.DONE].includes(step));                    // claim is never repeated
    if (commitExists && !claimed) assert.ok([S.REVOKE_THEN_CLAIM, S.CLAIM].includes(step)); // commit is never repeated
    if (step === S.START_OVER) assert.equal(installed, false);
    if (step === S.CONTINUE_COMMIT) assert.ok(installed && !commitExists && !claimed && !expired);
  }
  assert.equal(n, 32);
});
await check("revoke always comes before claim when the delegation is live; an expired permit is revoked and waits for a NEW Face ID, never committed", () => {
  assert.equal(giftSponsorNextStep(T({ installed: true, commitExists: true })), S.REVOKE_THEN_CLAIM);
  assert.notEqual(giftSponsorNextStep(T({ installed: true, expired: true })), S.CONTINUE_COMMIT);
  assert.equal(giftSponsorNextStep(T({ installed: true, expired: true })), S.REVOKE_THEN_WAIT_FACE_ID);
});
await check("pure: frozen step table, input not mutated, no I/O imports", async () => {
  assert.equal(Object.isFrozen(S), true);
  const t = T({ installed: true }); const copy = JSON.stringify(t); giftSponsorNextStep(t); assert.equal(JSON.stringify(t), copy);
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/gift-sponsor-7702.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export function giftSponsorNextStep"), src.indexOf("export const GIFT_SPONSOR_CHAINS"));
  assert.ok(!/fetch|await |localStorage|setTimeout/.test(fn));
});
console.log(`\nA-913 reconcile (client): ${pass} PASS${fail ? ` · ${fail} FAIL` : ""}`);
process.exit(fail ? 1 : 0);
