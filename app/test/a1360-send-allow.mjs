// [A-1360 · Owner 10-17 15:4x "열린 동안 보내기 승인만" · 16:0x 판 E · 16:1x "빼고 글자만 Send" · 81_ENTRY_FLOW 끝 [15:4x]]
// Money Sends (first Send · Journey 2 Job Send · Gift Send) are allowed on our sheet while the key is open; Face ID only opens the key.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const { sendAllowMarkup, SEND_ALLOW_COPY } = await import(path.join(REPO, "app/src/send-allow.js"));
const screens = await import(path.join(REPO, "app/src/a911-screens.js"));
let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e?.message || e).split("\n")[0]}`); } };
const fnSrc = (name) => { const a = MAIN.search(new RegExp(`\\n(async )?function ${name}\\(`)); const b = MAIN.indexOf("\n}\n", a); return MAIN.slice(a, b + 3); };

await check("sheet (판 E): face · title · two lines · amount + \"piggy goes with this.\" · not now · allow — an allow, never a Face ID", () => {
  const h = sendAllowMarkup({ title: "go to the market", lines: ["piggy trades one coin for another.", "a quick swap at the market."], amount: "$5" });
  for (const t of ["go to the market", "piggy trades one coin for another.", "a quick swap at the market.", "$5", "piggy goes with this.", "not now", "allow"]) assert.ok(h.includes(t), t);
  assert.match(h, /id="sendAllowSheet"/); assert.match(h, /id="sendAllowYes"/); assert.match(h, /id="sendAllowNo"/); assert.match(h, /src="\/icons\/icon-192\.png"/);
  assert.equal(/face id|faceid|authenticat|sign in|passkey/i.test(h.replace(/sendAllow__face/g, "")), false, "no Face ID words");
  assert.deepEqual(SEND_ALLOW_COPY, { goes: "piggy goes with this.", notNow: "not now", allow: "allow" });
  assert.equal(/sendAllow__lines/.test(sendAllowMarkup({ title: "Gift a Piggy", lines: [], amount: "$50" })), false, "no lines = no empty block");
});
await check("Send buttons = the word only (Gift Send · Money out Send); the receive side's Face ID button keeps its face", () => {
  const gift = screens.a911GiftMarkup({ stage: "pick", picked: "01", canSend: true, presets: [], fees: {} });
  const btn = gift.match(/<button class="a911-act a911-act--send"[\s\S]*?<\/button>/)[0];
  assert.equal(/a911-act__icon/.test(btn), false, btn);
  const out = screens.a911MoveMarkup({ dir: "out", step: "address", piggy: { name: "Honeybun" }, amount: "20", address: "0x1", canSend: true });
  assert.equal(/a911-act__icon/.test(out.match(/<button class="a911-act a911-act--send"[\s\S]*?<\/button>/)[0]), false);
  const src = readFileSync(path.join(REPO, "app/src/a911-screens.js"), "utf8");
  assert.match(src, /kind === "send" && label !== A911_COPY\.send \? FACE_ICON : ""/);
});
await check("first Send: Face ID only when the key is not open (stamped live signer of this Piggy, app unlocked); the sheet before grant / sign", () => {
  const once = fnSrc("sendPiggyOnce");
  const k = once.indexOf("const keyOpen"), g = once.indexOf("if (!keyOpen) {"), r = once.indexOf("recoverPiggy("), s = once.indexOf("askSendAllow("), q = once.indexOf("requestGrant(");
  assert.ok(k > 0 && k < g && g < r && r < s && s < q, `order keyOpen ${k} < guard ${g} < recover ${r} < sheet ${s} < grant ${q}`);
  assert.match(once, /signerSince > 0 && Date\.now\(\) >= signerSince/, "an unstamped / back-in-time signer is not trusted");
  assert.match(once, /clearOwnSendPending\(reservation\);\s*if \(state\.scene === "sendstay"\) setScene\("sendstay", sendBefore\.message, sendBefore\.detail\);\s*return;/, "not now = nothing moves");
});
await check("Job Send and Gift Send: the open key (no fresh) and the sheet before money moves; nothing forces Face ID", () => {
  assert.match(MAIN, /a898SignerForPayer\(piggy, \{ allowDeviceCredential: true \}\);[^\n]*\n\s*if \(!signer\.ok\) \{ a977Fail\("auth"\); return; \}\n\s*if \(typeof askSendAllow === "function" && !\(await askSendAllow\(jobSendAllowContent\(sj, jobKey\)\)\)\) return;/);
  const gift = fnSrc("a898FaceId");
  assert.ok(gift.indexOf("askSendAllow(") > gift.indexOf("await proving") && gift.indexOf("askSendAllow(") < gift.indexOf("faceid_result"), "Gift: sheet after the key, before the result");
  assert.equal(/a898SignerForPayer\([^)]*fresh: true/.test(MAIN), false);
});
await check("lock / session end: the key is wiped and an open sheet closes as not allowed", () => {
  assert.match(fnSrc("endSignerSession"), /sendAllowClose\(false\);[\s\S]*activeSession\?\.end\(\);/);
  assert.match(fnSrc("askSendAllow"), /resolve\(Boolean\(ok\) && !state\.appLock && Boolean\(activeAccount\)\)/, "allow after the lock = not allowed");
});
console.log(`A-1360 send allow: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
