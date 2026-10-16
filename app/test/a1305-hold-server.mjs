// [A-1305 ⑥] server hold: public_state carries hold:true only while ARASO_HOLD=1 (off = the old answer byte for byte);
// hold_pass = sha256(token) vs ARASO_HOLD_PASS_SHA256, constant time, yes/no only; malformed config or token = no.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createForkEntryHandler } from "../../api/fork-entry.js";
import { holdConfig, publicEntryConfig } from "../../api/_lib/public-entry.js";

let pass = 0;
const check = async (name, fn) => { await fn(); pass += 1; console.log("PASS", name); };
const origin = "https://app.example.test";
const call = async (handler, body) => {
  let json; const res = { statusCode: 0, setHeader() {}, end: (b) => { json = JSON.parse(b); } };
  await handler({ method: "POST", headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin" }, body }, res);
  return { status: res.statusCode, json };
};
const token = randomBytes(32).toString("base64url");
const sha = createHash("sha256").update(token).digest("hex");
const env = { ARASO_PUBLIC_ENTRY: "1", ARASO_PUBLIC_GRANT_CAP: "5", ARASO_HOLD: "1", ARASO_HOLD_PASS_SHA256: sha };
const make = (e) => createForkEntryHandler({ publicEntry: publicEntryConfig(e), hold: holdConfig(e), allowedOrigins: [origin] });

await check("hold config: only '1' turns it on; the digest must be 64 hex", () => {
  assert.deepEqual({ ...holdConfig(env) }, { enabled: true, passSha256: sha });
  for (const v of [undefined, "", "0", "true", "1 "]) assert.equal(holdConfig({ ARASO_HOLD: v }).enabled, false);
  assert.equal(holdConfig({ ARASO_HOLD: "1", ARASO_HOLD_PASS_SHA256: "abc" }).passSha256, null);
  assert.equal(holdConfig(Object.create({ ARASO_HOLD: "1" })).enabled, false);
});
await check("public_state: hold:true while on · off = exactly the old answer", async () => {
  assert.deepEqual((await call(make(env), { action: "public_state" })).json, { ok: true, publicEntry: true, hold: true });
  assert.deepEqual((await call(make({ ...env, ARASO_HOLD: "0" }), { action: "public_state" })).json, { ok: true, publicEntry: true });
  assert.deepEqual((await call(createForkEntryHandler({ publicEntry: publicEntryConfig(env), allowedOrigins: [origin] }), { action: "public_state" })).json, { ok: true, publicEntry: true });
});
await check("hold_pass: right token yes · wrong/short/odd/no digest no · extra field 400 · nothing echoed", async () => {
  const h = make(env);
  assert.deepEqual((await call(h, { action: "hold_pass", token })).json, { ok: true });
  const wrong = randomBytes(32).toString("base64url");
  for (const t of [wrong, token.slice(1), token + "A", "", 42, null]) assert.deepEqual((await call(h, { action: "hold_pass", token: t })).json, { ok: false });
  assert.deepEqual((await call(make({ ...env, ARASO_HOLD_PASS_SHA256: "" }), { action: "hold_pass", token })).json, { ok: false });
  assert.equal((await call(h, { action: "hold_pass", token, x: 1 })).status, 400);
  assert.equal(JSON.stringify((await call(h, { action: "hold_pass", token })).json).includes(token), false);
});
await check("source: constant-time compare, no logging in the hold path", () => {
  const src = readFileSync(new URL("../../api/fork-entry.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("function holdPassOk"), src.indexOf("export function createForkEntryHandler"));
  assert.match(fn, /timingSafeEqual\(want, got\)/);
  assert.equal(/console\./.test(fn), false);
});
console.log(`A1305 hold server ${pass} PASS / 0 FAIL / 0 SKIP`);
