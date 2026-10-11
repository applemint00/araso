// [A-1027] Hosted Journey 2 entry wiring. Fake Upstash + fake signed Admin/Public Guard + fake chain-10143 only; network 0.
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createUpstashRest } from "../../api/_lib/grant-redis-store.js";
import { createUpstashInviteStore } from "../../api/_lib/invite-redis-store.js";
import { createForkEntryHandler, forkEntryServiceFromEnv, localForkEntryServiceFromEnv, productionForkEntryServiceFromEnv } from "../../api/fork-entry.js";
import { JOURNEY1 } from "../../api/_lib/fork-entry.js";
import { FAKE_KV_TOKEN, FAKE_KV_URL, fakeUpstash } from "./helpers/a960-fake-upstash.mjs";

let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (error) { fail += 1; console.log(`FAIL  ${name}\n      ${String(error?.stack || error).split("\n").slice(0, 8).join("\n      ")}`); } };
const APP = "https://arasoo.vercel.app";
const GUARD = "https://fork.example";
const TESTNET = "https://testnet.example";
const HMAC = "h".repeat(32);
const GRANT_VERSION = "a1027-g1";
const FORK_ID = "fork-143-110874000-a1027";
const account = privateKeyToAccount(`0x${"a1".repeat(32)}`);
const other = privateKeyToAccount(`0x${"b2".repeat(32)}`);
const piggy = account.address.toLowerCase();
const shmon = parseAbi(["function deposit(uint256 assets, address receiver) payable returns (uint256)", "function redeem(uint256 shares, address receiver, address owner) returns (uint256)"]);
const hash = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const depositHash = hash(1027); const redeemHash = hash(1028);
const depositInput = encodeFunctionData({ abi: shmon, functionName: "deposit", args: [1n, account.address] });
const redeemInput = encodeFunctionData({ abi: shmon, functionName: "redeem", args: [1n, account.address, account.address] });

const completeEnv = Object.freeze({
  VERCEL: "1",
  KV_REST_API_URL: FAKE_KV_URL,
  KV_REST_API_TOKEN: FAKE_KV_TOKEN,
  ARASO_FORK_GUARD_URL: GUARD,
  ARASO_FORK_ADMIN_HMAC_SECRET: HMAC,
  ARASO_FORK_GRANT_VERSION: GRANT_VERSION,
  ARASO_FORK_APP_ORIGIN: APP,
  ARASO_FORK_PUBLIC_RPC_URL: GUARD,
  ARASO_FORK_TESTNET_RPC_URL: TESTNET,
});

function makeWorld() {
  const kv = fakeUpstash();
  const topups = new Map();
  let unexpected = 0;
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const rpcAnswer = (request) => {
    if (request.method === "eth_chainId") return "0x279f";
    const h = String(request.params?.[0] || "").toLowerCase();
    const dep = h === depositHash;
    const red = h === redeemHash;
    if (request.method === "eth_getTransactionByHash" && (dep || red)) return { hash: h, from: piggy, to: JOURNEY1.target, input: dep ? depositInput : redeemInput, chainId: "0x279f" };
    if (request.method === "eth_getTransactionReceipt" && (dep || red)) return { transactionHash: h, from: piggy, to: JOURNEY1.target, status: "0x1", blockNumber: dep ? "0x64" : "0x65" };
    return null;
  };
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target === FAKE_KV_URL) return kv.fetchImpl(target, init);
    if (target === TESTNET || target === `${TESTNET}/`) {
      const request = JSON.parse(init.body);
      return response({ jsonrpc: "2.0", id: request.id, result: rpcAnswer(request) });
    }
    if (target === `${GUARD}/`) return response({ jsonrpc: "2.0", id: 1, result: { guard: "araso-a949-public-guard", forkInstanceId: FORK_ID, chainId: 31337143, forkStartBlock: 110874000 } });
    if (target === `${GUARD}/araso-admin/v1/topup`) {
      assert.match(String(init.headers?.["x-araso-sig"] || ""), /^[0-9a-f]{64}$/);
      const body = JSON.parse(Buffer.from(init.body).toString("utf8"));
      const key = `${FORK_ID}|${body.piggyAddress.toLowerCase()}|${body.asset}|${body.grantVersion}`;
      const prior = topups.get(key); const record = prior || { forkInstanceId: FORK_ID, amountRaw: "1" };
      topups.set(key, record); return response({ noop: !!prior, key, record });
    }
    unexpected += 1; throw new Error("unexpected network target");
  };
  return { kv, topups, fetchImpl, unexpected: () => unexpected };
}

function makeRes() { return { statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(raw) { this.body = JSON.parse(raw); } }; }
async function call(handler, body, invite) {
  const res = makeRes();
  await handler({ method: "POST", headers: { "content-type": "application/json", origin: APP, "sec-fetch-site": "same-origin", "x-araso-invite": invite }, body, async *[Symbol.asyncIterator]() {} }, res);
  return res;
}

await check("production env is all-or-nothing; malformed values and every missing required name return HTTP 503", async () => {
  const world = makeWorld();
  assert.ok(productionForkEntryServiceFromEnv(completeEnv, { fetchImpl: world.fetchImpl }));
  for (const name of ["VERCEL", "KV_REST_API_URL", "KV_REST_API_TOKEN", "ARASO_FORK_GUARD_URL", "ARASO_FORK_ADMIN_HMAC_SECRET", "ARASO_FORK_GRANT_VERSION", "ARASO_FORK_APP_ORIGIN", "ARASO_FORK_PUBLIC_RPC_URL"]) {
    const bad = { ...completeEnv }; delete bad[name];
    const service = productionForkEntryServiceFromEnv(bad, { fetchImpl: world.fetchImpl });
    assert.equal(service, null, name);
    const closed = await call(createForkEntryHandler({ service }), { action: "challenge", piggyAddress: piggy }, "not-used");
    assert.equal(closed.statusCode, 503, name); assert.equal(closed.body.reason, "entry_unavailable", name);
  }
  for (const bad of [{ ...completeEnv, ARASO_FORK_PUBLIC_RPC_URL: "http://fork.example" }, { ...completeEnv, ARASO_FORK_GRANT_VERSION: "BAD" }]) {
    const service = productionForkEntryServiceFromEnv(bad, { fetchImpl: world.fetchImpl });
    assert.equal(service, null);
    assert.equal((await call(createForkEntryHandler({ service }), { action: "challenge", piggyAddress: piggy }, "not-used")).statusCode, 503);
  }
  assert.equal(productionForkEntryServiceFromEnv({ ...completeEnv, ARASO_FORK_ENTRY_LOCAL: "1" }, { fetchImpl: world.fetchImpl }), null);
  assert.equal(world.unexpected(), 0);
});

await check("mode selection preserves local memory mode and production never falls back to it", () => {
  const local = { ARASO_FORK_ENTRY_LOCAL: "1", ARASO_FORK_ADMIN_URL: "http://127.0.0.1:47999", ARASO_FORK_ADMIN_TOKEN: "admin-token-0123456789abcdef", ARASO_FORK_INVITE_TOKENS: "local-test-invite-0001", ARASO_FORK_APP_ORIGIN: "http://localhost:5173" };
  assert.ok(localForkEntryServiceFromEnv(local));
  assert.ok(forkEntryServiceFromEnv(local));
  assert.equal(forkEntryServiceFromEnv({ ...local, VERCEL: "1" }), null);
});

await check("default export selects the hosted service and configured app origin", async () => {
  const world = makeWorld();
  const names = [...Object.keys(completeEnv), "ARASO_FORK_ENTRY_LOCAL", "ARASO_FORK_ADMIN_URL", "ARASO_FORK_ADMIN_TOKEN"];
  const saved = new Map(names.map((name) => [name, Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : undefined]));
  const savedFetch = globalThis.fetch;
  try {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, completeEnv); globalThis.fetch = world.fetchImpl;
    const cmd = createUpstashRest({ url: FAKE_KV_URL, token: FAKE_KV_TOKEN, fetchImpl: world.fetchImpl });
    const issued = await createUpstashInviteStore({ cmd }).issue();
    const route = (await import(`../../api/fork-entry.js?a1027-default=${Date.now()}`)).default;
    const response = await call(route, { action: "challenge", piggyAddress: piggy }, issued.token);
    assert.equal(response.statusCode, 200); assert.match(response.body.nonce, /^[0-9a-f]{32}$/);
  } finally {
    globalThis.fetch = savedFetch;
    for (const name of names) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

await check("hosted challenge → enter → status uses durable parts; replay is refused and four top-ups stay once", async () => {
  const world = makeWorld();
  const cmd = createUpstashRest({ url: FAKE_KV_URL, token: FAKE_KV_TOKEN, fetchImpl: world.fetchImpl });
  const invites = createUpstashInviteStore({ cmd });
  const issued = await invites.issue(); assert.equal(issued.ok, true);
  const service = productionForkEntryServiceFromEnv(completeEnv, { fetchImpl: world.fetchImpl });
  const challenge = await service.challenge({ inviteToken: issued.token, piggyAddress: piggy });
  assert.equal(challenge.ok, true);
  const signature = await account.signMessage({ message: challenge.message });
  const input = { inviteToken: issued.token, nonce: challenge.nonce, signature, piggyAddress: piggy, journey1: { depositTxHash: depositHash, redeemTxHash: redeemHash } };
  const entered = await service.enter(input);
  assert.equal(entered.allowed, true, JSON.stringify(entered)); assert.equal(entered.forkInstanceId, FORK_ID); assert.equal(entered.grants.length, 4);
  const replay = await service.enter(input);
  assert.equal(replay.allowed, false); assert.equal(replay.reason, "unknown_or_used_nonce");
  const status = await service.status({ inviteToken: issued.token, piggyAddress: piggy, forkInstanceId: FORK_ID });
  assert.equal(status.allowed, true); assert.equal(world.topups.size, 4); assert.equal(world.unexpected(), 0);
});

await check("missing or already-bound invite is HTTP 403 in production and performs no top-up", async () => {
  const world = makeWorld();
  const service = productionForkEntryServiceFromEnv(completeEnv, { fetchImpl: world.fetchImpl });
  const handler = createForkEntryHandler({ service, allowedOrigins: [APP] });
  const absent = await call(handler, { action: "challenge", piggyAddress: piggy }, "not-an-issued-invite-token");
  assert.equal(absent.statusCode, 403); assert.equal(absent.body.reason, "not_invited");
  const cmd = createUpstashRest({ url: FAKE_KV_URL, token: FAKE_KV_TOKEN, fetchImpl: world.fetchImpl });
  const invites = createUpstashInviteStore({ cmd }); const issued = await invites.issue();
  assert.equal((await invites.bind({ token: issued.token, piggyAddress: other.address })).ok, true);
  const challenge = await service.challenge({ inviteToken: issued.token, piggyAddress: piggy });
  const signature = await account.signMessage({ message: challenge.message });
  const refused = await call(handler, { action: "enter", nonce: challenge.nonce, signature, piggyAddress: piggy, journey1: { depositTxHash: depositHash, redeemTxHash: redeemHash } }, issued.token);
  assert.equal(refused.statusCode, 403); assert.equal(refused.body.reason, "invite_bound_to_other_piggy"); assert.equal(world.topups.size, 0);
});

console.log(`A1027_RESULT ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
