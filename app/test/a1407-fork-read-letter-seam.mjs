// [A-1407] E37 seam: the app's real fork read_letter request (the main.js functions themselves, no hand-copied body) goes through the
// real fork worker (relayer/src/fork-gift-worker.mjs createForkGiftHttpHandler → createForkGiftController) into the real sponsor
// service readLetter (relayer/src/gift-sponsor-service.mjs). Only the chain and the ledger row are stand-ins: one Gift with a registered letter.
// Guards: another forkInstanceId → 400 · another escrow → 400 · testnet body = { action, token } (api/gift-sponsor.js isReadLetterBody).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { resolveChainProfile, resolveForkGiftTransport } from "../src/chain-profile.js";
import { verifyGiftLetter } from "../src/gift-piggy-claim-link.js";
import { createForkGiftController, createForkGiftHttpHandler, FORK_GIFT_ORIGIN } from "../../relayer/src/fork-gift-worker.mjs";
import { createGiftSponsorService, openGiftSponsorLedger } from "../../relayer/src/gift-sponsor-service.mjs";
import { isReadLetterBody } from "../../api/gift-sponsor.js";

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
const source = ["giftReadLetterUrl", "giftReadLetterBody", "loadPendingGiftDisplay"].map((n) => functionBlock(main, n)).join("\n").replaceAll("import.meta.env", "__env");
assert.ok(source.includes("async function loadPendingGiftDisplay("), "loadPendingGiftDisplay found");

const INSTANCE = "fork-143-test";
const ESCROW = `0x${"12".repeat(20)}`;
const SPONSOR = `0x${"34".repeat(20)}`;
const TOKEN = "Ab3_-".repeat(4) + "Zz";
const GIFT_ID = `0x${createHash("sha256").update(TOKEN).digest("hex")}`;
const NOTE = "01\nfor you\nhappy day\nme";
const LETTER_HASH = createHash("sha256").update(NOTE).digest("hex");
const FORK_ENV = { VITE_ARASO_FORK_GIFT_SPONSOR_URL: "https://fork.example/gift-sponsor", VITE_ARASO_FORK_GIFT_ESCROW: ESCROW };
const fork = (forkInstanceId = INSTANCE) => resolveChainProfile("monad-fork", { rpcUrl: "https://fork.example/", forkInstanceId });

// the worker side: real controller + real service; chain = one Gift (20 USDC), ledger = that Gift's letter, sponsor never sends
const sends = [];
const ledger = openGiftSponsorLedger(null);
assert.equal(ledger.registerLetter(GIFT_ID, { note: NOTE, letterHash: LETTER_HASH }), "created");
const policy = { escrow: ESCROW, sponsorAddress: SPONSOR };
const chain = { getGift: async (id) => (id === GIFT_ID ? { exists: true, claimed: false, sender: `0x${"56".repeat(20)}`, amount: 20_000_000n } : { exists: false }) };
const preflight = async () => true;
const service = createGiftSponsorService({ ledger, policy, chain, sponsor: { address: SPONSOR, send: async (tx) => { sends.push(tx); throw new Error("no send in a read"); } }, preflight });
assert.equal(service.ready, true);
const controller = createForkGiftController({ runtime: { policy, preflight, service, store: { close() {} } }, instanceId: INSTANCE, identityCheck: async () => true, intervalMs: 1000, setTimer: () => ({ unref() {} }) });
const worker = createForkGiftHttpHandler(controller, { perMinute: 60 });

// one HTTP exchange with the worker handler, in memory (no port)
function ask(pathname, init) {
  return new Promise((resolve) => {
    const req = Readable.from([Buffer.from(init.body)]);
    Object.assign(req, { method: init.method, url: pathname, headers: { origin: FORK_GIFT_ORIGIN, "content-type": init.headers["content-type"] } });
    let status = 0;
    const res = { headersSent: false, writableEnded: false, writeHead(s) { status = s; this.headersSent = true; }, end(b) { this.writableEnded = true; resolve({ status, text: String(b ?? "") }); } };
    worker(req, res);
  });
}

async function run({ profile, env }) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(String(url), "https://arasoo.vercel.app");
    if (u.origin !== "https://fork.example") { calls.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: false, json: async () => ({ ok: false }) }; }
    const answer = await ask(u.pathname, init);
    calls.push({ url: String(url), body: JSON.parse(init.body), answer });
    return { ok: answer.status >= 200 && answer.status < 300, json: async () => JSON.parse(answer.text) };
  };
  const claim = { token: TOKEN };
  const make = new Function("CHAIN_PROFILE", "a1063GiftTransport", "__env", "fetch", "verifyGiftLetter", "render", "pendingGiftClaim", `${source}\nreturn loadPendingGiftDisplay;`);
  const out = await make(profile, resolveForkGiftTransport, env, fetch, verifyGiftLetter, () => {}, claim)(claim);
  return { out, calls, claim };
}

let pass = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log(`PASS ${name}`); } catch (e) { console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`); process.exitCode = 1; }
}

await check("seam · the app's fork read_letter → fork worker → service readLetter = HTTP 200 + giftId · note · letterHash · amountAtomic", async () => {
  const r = await run({ profile: fork(), env: FORK_ENV });
  assert.equal(r.calls.length, 1);
  const { answer } = r.calls[0];
  assert.equal(r.calls[0].url, "https://fork.example/gift-sponsor");
  assert.equal(answer.status, 200, `worker answered ${answer.status} ${answer.text} to app body ${JSON.stringify(r.calls[0].body)}`);
  const body = JSON.parse(answer.text);
  assert.deepEqual({ giftId: body.giftId, note: body.note, letterHash: body.letterHash, amountAtomic: body.amountAtomic }, { giftId: GIFT_ID, note: NOTE, letterHash: LETTER_HASH, amountAtomic: "20000000" });
  assert.equal(r.out, true);
  assert.equal(r.claim.giftId, GIFT_ID);
  assert.equal(r.claim.display.amountUsd, 20);
  assert.equal(sends.length, 0);
});

await check("guard · another forkInstanceId → 400 (the controller binding stays)", async () => {
  const r = await run({ profile: fork("fork-143-other"), env: FORK_ENV });
  assert.equal(r.calls[0].answer.status, 400, r.calls[0].answer.text);
  assert.equal(r.out, false);
  assert.equal(r.claim.giftId, undefined);
});

await check("guard · another escrow → 400 (the controller binding stays)", async () => {
  const r = await run({ profile: fork(), env: { ...FORK_ENV, VITE_ARASO_FORK_GIFT_ESCROW: `0x${"13".repeat(20)}` } });
  assert.equal(r.calls[0].answer.status, 400, r.calls[0].answer.text);
  assert.equal(r.out, false);
});

await check("guard · testnet body = { action, token } (2 keys) to /api/gift-sponsor, the Vercel read shape", async () => {
  const r = await run({ profile: resolveChainProfile("monad-testnet"), env: FORK_ENV });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, "/api/gift-sponsor");
  assert.deepEqual(r.calls[0].body, { action: "read_letter", token: TOKEN });
  assert.equal(isReadLetterBody(r.calls[0].body), true);
});

assert.equal(sends.length, 0);
console.log(`${pass}/4`);
