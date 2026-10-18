// [A-1399] E37 fix B: the receiver's read_letter goes to the fork sponsor (the a1063 transport) on the fork profile;
// testnet stays on /api/gift-sponsor; a fork without a transport fails quietly as before. Body = { action, token } only
// (relayer/src/gift-sponsor-service.mjs readLetter hasOnly ["action","token"]; relayer/src/fork-gift-front.mjs passes the body through unchanged).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveChainProfile, resolveForkGiftTransport } from "../src/chain-profile.js";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const functionBlock = (s, name) => {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(s);
  if (!match) return "";
  const open = s.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === "{") depth += 1;
    else if (s[i] === "}") { depth -= 1; if (depth === 0) return s.slice(match.index, i + 1); }
  }
  return "";
};
const source = [functionBlock(main, "giftReadLetterUrl"), functionBlock(main, "giftReadLetterBody"), functionBlock(main, "loadPendingGiftDisplay")].join("\n").replaceAll("import.meta.env", "__env");
assert.ok(source.includes("async function loadPendingGiftDisplay("), "loadPendingGiftDisplay found");

const TOKEN = "A".repeat(22);
const GIFT_ID = `0x${"ab".repeat(32)}`;
const FORK = resolveChainProfile("monad-fork", { rpcUrl: "https://fork.example/", forkInstanceId: "fork-143-test" });
const TESTNET = resolveChainProfile("monad-testnet");
const FORK_ENV = { VITE_ARASO_FORK_GIFT_SPONSOR_URL: "https://fork.example/gift-sponsor", VITE_ARASO_FORK_GIFT_ESCROW: `0x${"12".repeat(20)}` };

async function run({ profile, env, ok = true }) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (!ok) return { ok: false, json: async () => ({ ok: false, error: "unavailable_not_sent" }) };
    return { ok: true, json: async () => ({ ok: true, giftId: GIFT_ID, note: "hi", letterHash: "0xhash", amountAtomic: "20000000", decimals: 6 }) };
  };
  let renders = 0;
  const claim = { token: TOKEN };
  const make = new Function("CHAIN_PROFILE", "a1063GiftTransport", "__env", "fetch", "verifyGiftLetter", "render", "pendingGiftClaim",
    `${source}\nreturn loadPendingGiftDisplay;`);
  const load = make(profile, resolveForkGiftTransport, env, fetch, async (l) => ({ note: l.note }), () => { renders += 1; }, claim);
  const out = await load(claim);
  return { out, calls, claim, renders };
}

let pass = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log(`PASS ${name}`); } catch (e) { console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`); process.exitCode = 1; }
}

await check("(가) fork + transport: read_letter POSTs to the fork sponsorUrl, body { action, token, forkInstanceId, escrowAddress } (the fork worker binding, same values as the Gift send)", async () => {
  const r = await run({ profile: FORK, env: FORK_ENV });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, "https://fork.example/gift-sponsor");
  assert.equal(r.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(r.calls[0].init.body), { action: "read_letter", token: TOKEN, forkInstanceId: "fork-143-test", escrowAddress: FORK_ENV.VITE_ARASO_FORK_GIFT_ESCROW });
  assert.equal(r.out, true);
  assert.equal(r.claim.giftId, GIFT_ID);
  assert.deepEqual(r.claim.display, { note: "hi", amountUsd: 20 });
});

await check("(나) testnet: read_letter stays on /api/gift-sponsor (same body)", async () => {
  for (const env of [{}, FORK_ENV]) {
    const r = await run({ profile: TESTNET, env });
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].url, "/api/gift-sponsor");
    assert.deepEqual(JSON.parse(r.calls[0].init.body), { action: "read_letter", token: TOKEN });
    assert.equal(r.out, true);
  }
});

await check("(다) fork without a transport (missing / malformed): same quiet false as before, no new path", async () => {
  for (const env of [{}, { ...FORK_ENV, VITE_ARASO_FORK_GIFT_ESCROW: "bad" }, { ...FORK_ENV, VITE_ARASO_FORK_GIFT_SPONSOR_URL: "https://evil.example/gift-sponsor" }]) {
    const r = await run({ profile: FORK, env, ok: false });
    assert.equal(r.out, false);
    assert.ok(r.calls.every((c) => c.url === "/api/gift-sponsor"), r.calls.map((c) => c.url).join(","));
    assert.equal(r.claim.giftId, undefined);
    assert.equal(r.renders, 0);
  }
});

await check("only one read_letter call site in main.js", () => {
  assert.equal(main.split('action: "read_letter"').length - 1, 1);
});

console.log(`${pass}/4`);
