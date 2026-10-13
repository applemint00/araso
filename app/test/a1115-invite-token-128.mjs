// [A-1115] Invite token = 128 bit (randomBytes(16) base64url = 22 chars). Fake Upstash only; network 0; no token value is ever printed.
//   node app/test/a1115-invite-token-128.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUpstashRest } from "../../api/_lib/grant-redis-store.js";
import { INVITE_TOKEN_RE, createUpstashInviteStore } from "../../api/_lib/invite-redis-store.js";
import { fakeUpstash } from "./helpers/a960-fake-upstash.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.resolve(HERE, "../../api/_lib/invite-redis-store.js"), "utf8");
const CLIENT = readFileSync(path.resolve(HERE, "../src/fork-entry-client.js"), "utf8");
const AUTH = readFileSync(path.resolve(HERE, "../../api/_lib/fork-auth.js"), "utf8");
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  // messages are redacted: any 16+ char base64url run (a token shape) is replaced before printing
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).replace(/[A-Za-z0-9_-]{16,}/g, "<redacted>")}`); fail += 1; }
}
const store = (kv) => createUpstashInviteStore({ cmd: createUpstashRest({ url: kv.url, token: kv.token, fetchImpl: kv.fetchImpl }) });

await check("1 source: issue() draws 16 random bytes (128 bit); the pre-A-1115 32-byte draw is gone", () => {
  assert.match(SRC, /const token = randomBytes\(16\)\.toString\("base64url"\);/);
  assert.doesNotMatch(SRC, /const token = randomBytes\(32\)/);
});
await check("2 issued token: 22 chars, base64url alphabet; every validator is {16,200} (store, fork-auth, client storage) - no 43-char assumption", async () => {
  const r = await store(fakeUpstash()).issue();
  assert.equal(r.ok, true);
  assert.equal(r.token.length, 22, "token length");
  assert.ok(/^[A-Za-z0-9_-]{22}$/.test(r.token), "base64url alphabet");
  assert.ok(INVITE_TOKEN_RE.test(r.token), "store regex");
  assert.ok(AUTH.includes("const TOKEN_RE = /^[A-Za-z0-9._~-]{16,200}$/;"), "fork-auth TOKEN_RE");
  assert.ok(CLIENT.includes("/^[A-Za-z0-9._~-]{16,200}$/.test(v)"), "client storage regex");
});
await check("3 issued 22-char token verifies: testerFor -> its testerId; an unknown 22-char token -> null", async () => {
  const s = store(fakeUpstash());
  const r = await s.issue();
  assert.equal(await s.testerFor(r.token), r.testerId);
  assert.equal(await s.testerFor("A".repeat(22)), null);
});
await check("4 legacy 43-char token shape (already-issued links) still passes the shape check - recorded, not required", () => {
  const legacy = Buffer.alloc(32, 7).toString("base64url");
  assert.equal(legacy.length, 43);
  assert.ok(INVITE_TOKEN_RE.test(legacy));
});
console.log(`\nA-1115: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
