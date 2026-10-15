import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { a911GiftReceiveMarkup } from "../src/a911-screens.js";
import { buildClaimUrl, hashGiftLetter, parseClaimUrl, verifyGiftLetter } from "../src/gift-piggy-claim-link.js";
import { buildGasTxRegistration } from "../src/gift-create-plan.js";
import { GIFT_BOOT_PATH, selectBootProfile } from "../src/boot-profile.js";
import { createGiftSponsorService, openGiftSponsorLedger } from "../../relayer/src/gift-sponsor-service.mjs";
import { isReadLetterBody, isRegisterBody } from "../../api/gift-sponsor.js";

let pass = 0;
const check = async (name, fn) => { await fn(); pass += 1; console.log(`PASS  ${name}`); };
const GIFT = `0x${"ab".repeat(32)}`;
const GAS_TX = `0x${"cd".repeat(32)}`;
const TOKEN = "A".repeat(43);
const NOTE = "02\nDana\n<script>alert(1)</script> 한글 😀\nSam";

await check("12-0 short link carries only g/t/v and its length is invariant across message languages", () => {
  const urls = ["spaces here", "한".repeat(140), "😀".repeat(70)].map((note) => buildClaimUrl("https://arasoo.vercel.app", { giftId: GIFT, token: TOKEN, note, amountUsd: 100 }));
  assert.equal(new Set(urls).size, 1);
  assert.equal(urls[0].length, 149);
  assert.match(urls[0], /^https:\/\/arasoo\.vercel\.app\/gift#g=0x[0-9a-f]{64}&t=[A-Za-z0-9_-]+&v=1$/);
  assert.equal(/[&?](?:n|a)=/.test(urls[0]), false);
});

await check("12-1/3 letter hash verifies; changed or malformed letter loses text while the card front survives", async () => {
  const hash = await hashGiftLetter(NOTE);
  assert.equal(hash, createHash("sha256").update(NOTE).digest("hex"));
  assert.deepEqual(await verifyGiftLetter({ note: NOTE, letterHash: hash }), { front: "02", to: "Dana", message: "<script>alert(1)</script> 한글 😀", from: "Sam", note: NOTE, verified: true });
  const changed = await verifyGiftLetter({ note: NOTE.replace("alert(1)", "alert(2)"), letterHash: hash });
  assert.deepEqual(changed, { front: "02", to: "", message: "", from: "", verified: false });
  const malformed = await verifyGiftLetter({ note: `02\nDana\n${"x".repeat(141)}\nSam`, letterHash: hash });
  assert.deepEqual(malformed, { front: "02", to: "", message: "", from: "", verified: false });
  const html = a911GiftReceiveMarkup({ front: "02", fields: { to: "Dana", message: "<script>alert(1)</script>", from: "Sam" }, amountUsd: 20 });
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

await check("12-2/3 registration binds the letter; read returns chain amount, not a link hint", async () => {
  const letterHash = await hashGiftLetter(NOTE);
  const record = { giftId: GIFT, note: NOTE, letterHash, gasDeposit: { txHash: GAS_TX } };
  const body = buildGasTxRegistration(record);
  assert.equal(isRegisterBody(body), true);
  assert.equal(isReadLetterBody({ action: "read_letter", giftId: GIFT }), true);
  const ledger = openGiftSponsorLedger();
  const policy = { sponsorAddress: "0x00000000000000000000000000000000000000aa", gasBufferBps: 0, gasUnits: { install: 1n, commit: 1n, revoke: 1n, claim: 1n } };
  const chain = {
    getGift: async () => ({ exists: true, claimed: false, sender: "0x00000000000000000000000000000000000000bb", amount: 20_000_000n }),
    getFeePerGasWei: async () => 1n,
    getGasDepositTx: async () => ({ status: "success", to: policy.sponsorAddress, from: "0x00000000000000000000000000000000000000bb", data: GIFT, value: 4n }),
  };
  const service = createGiftSponsorService({ ledger, policy, chain, sponsor: { address: policy.sponsorAddress, send: async () => null }, preflight: async () => true });
  assert.equal((await service.register(body)).status, 200);
  const read = await service.readLetter({ action: "read_letter", giftId: GIFT });
  assert.deepEqual(read, { status: 200, body: { ok: true, giftId: GIFT, note: NOTE, letterHash, amountAtomic: "20000000", decimals: 6 } });
  assert.equal((await service.register({ ...body, note: NOTE.replace("Dana", "Mina"), letterHash: await hashGiftLetter(NOTE.replace("Dana", "Mina")) })).status, 409);
});

await check("12-3 link n/a tampering is ignored completely", () => {
  const base = buildClaimUrl("https://arasoo.vercel.app", { giftId: GIFT, token: TOKEN });
  assert.deepEqual(parseClaimUrl(`${base}&n=evil&a=100`), { ok: true, giftId: GIFT, token: TOKEN });
});

await check("12-6 /gift selects the fork profile and its built page has fixed OG copy with no fragment data", () => {
  assert.equal(GIFT_BOOT_PATH, "/gift");
  const env = { VITE_ARASO_FORK_RPC_URL: "https://fork.invalid/rpc", VITE_ARASO_FORK_INSTANCE_ID: "fork-1" };
  assert.equal(selectBootProfile({ pathname: "/gift", env, releaseLevel: 2 }).id, "monad-fork");
  const html = readFileSync(new URL("../gift.html", import.meta.url), "utf8");
  assert.ok(html.includes('content="Araso · Gift a Piggy"'));
  assert.ok(html.includes('content="someone sent you a piggy."'));
  assert.ok(html.includes("/card/gift/piggy_seat_listen.svg"));
  assert.equal(/[?#](?:g|t)=/.test(html), false);
  const screenSource = readFileSync(new URL("../src/a911-screens.js", import.meta.url), "utf8");
  assert.match(screenSource, /navigator\.share\(\{ url \}\)/);
  assert.doesNotMatch(screenSource, /navigator\.share\(\{[^}]*text/);
});

console.log(`\n${pass}/5 PASS`);
