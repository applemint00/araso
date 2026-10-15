// A-1299 [grant room · grant wallet words on public_state] — node only, network 0, keys 0, tx 0.
//   node app/test/a1299-grant-room.mjs
// Part W: the words (grantRoom ok|low|full at public counter/cap ≥0.8 / ≥1 · grantWallet ok|low|unknown at < GRANT_WEI×20).
// Part H: public_state adds only those words (no number, no address), only when a status provider is wired; existing keys unchanged;
//         a slow / failing read never blocks or breaks public_state (wallet unknown, room left out); reads are cached.
// Part E: the env wiring reads the public counter key and the relayer balance only (no reserve, no send).
import assert from "node:assert/strict";
import { GRANT_WEI } from "../../relayer/src/policy.mjs";
import { publicEntryConfig } from "../../api/_lib/public-entry.js";
import { createForkEntryHandler } from "../../api/fork-entry.js";

let pass = 0; let fail = 0;
async function check(label, fn) { try { await fn(); pass += 1; console.log(`PASS  ${label}`); } catch (e) { fail += 1; console.log(`FAIL  ${label}\n      ${String(e?.message || e).split("\n")[0]}`); } }
let GR = null;
try { GR = await import("../../api/_lib/grant-room.js"); } catch (e) { console.log(`      (api/_lib/grant-room.js: ${String(e?.code || e?.message).slice(0, 60)})`); }

const fakeRes = () => { const r = { statusCode: 0, headers: {}, body: "" }; r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; }; r.end = (b) => { r.body = b; }; return r; };
async function publicState(handler) {
  const res = fakeRes();
  await handler({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "public_state" }) }, res);
  return { status: res.statusCode, json: JSON.parse(res.body || "null") };
}
const PUBLIC = publicEntryConfig({ ARASO_PUBLIC_ENTRY: "1", ARASO_PUBLIC_GRANT_CAP: "10" });
function statusOf({ count, wallet, cap = 10, slow = 0 }) {
  return GR.createGrantStatus({
    cap,
    readPublicCount: async () => { if (slow) await new Promise((r) => setTimeout(r, slow)); if (count instanceof Error) throw count; return count; },
    readWalletBalance: async () => { if (wallet instanceof Error) throw wallet; return wallet; },
    timeoutMs: 200, ttlMs: 30_000,
  });
}

// ═══ Part W ═══
await check("W1 grantRoom: counter/cap < 0.8 = ok · ≥ 0.8 = low · ≥ 1 = full · no cap or unreadable = left out", () => {
  assert.ok(GR, "grant-room module missing");
  assert.deepEqual([GR.grantRoomWord(0, 10), GR.grantRoomWord(7, 10), GR.grantRoomWord(8, 10), GR.grantRoomWord(9, 10), GR.grantRoomWord(10, 10), GR.grantRoomWord(12, 10)], ["ok", "ok", "low", "low", "full", "full"]);
  assert.deepEqual([GR.grantRoomWord(3, 0), GR.grantRoomWord(null, 10), GR.grantRoomWord(Number.NaN, 10)], [null, null, null]);
});
await check("W2 grantWallet: balance < GRANT_WEI × 20 = low · otherwise ok · unreadable = unknown", () => {
  assert.ok(GR, "grant-room module missing");
  const LOW = GRANT_WEI * 20n;
  assert.deepEqual([GR.grantWalletWord(LOW - 1n), GR.grantWalletWord(LOW), GR.grantWalletWord(LOW * 5n), GR.grantWalletWord(null), GR.grantWalletWord(undefined)], ["low", "ok", "ok", "unknown", "unknown"]);
});

// ═══ Part H ═══ (the card's RED: at 80% / at < 2 MON nothing warned)
await check("H1 public counter at 80% of the cap → public_state says grantRoom low (RED: no word at all)", async () => {
  assert.ok(GR, "grant-room module missing");
  const r = await publicState(createForkEntryHandler({ publicEntry: PUBLIC, grantStatus: statusOf({ count: 8, wallet: GRANT_WEI * 100n }) }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, publicEntry: true, grantRoom: "low", grantWallet: "ok" });
});
await check("H2 counter at the cap → full · wallet under 20 grants → low · wallet read fails → unknown", async () => {
  assert.ok(GR, "grant-room module missing");
  assert.equal((await publicState(createForkEntryHandler({ publicEntry: PUBLIC, grantStatus: statusOf({ count: 10, wallet: GRANT_WEI * 100n }) }))).json.grantRoom, "full");
  assert.equal((await publicState(createForkEntryHandler({ publicEntry: PUBLIC, grantStatus: statusOf({ count: 1, wallet: GRANT_WEI * 19n }) }))).json.grantWallet, "low");
  assert.equal((await publicState(createForkEntryHandler({ publicEntry: PUBLIC, grantStatus: statusOf({ count: 1, wallet: new Error("rpc") }) }))).json.grantWallet, "unknown");
});
await check("H3 only words: no number, no address, no other key in public_state", async () => {
  assert.ok(GR, "grant-room module missing");
  const r = await publicState(createForkEntryHandler({ publicEntry: PUBLIC, grantStatus: statusOf({ count: 9, wallet: GRANT_WEI * 3n }) }));
  assert.deepEqual(Object.keys(r.json).sort(), ["grantRoom", "grantWallet", "ok", "publicEntry"]);
  assert.ok(["ok", "low", "full"].includes(r.json.grantRoom) && ["ok", "low", "unknown"].includes(r.json.grantWallet));
  assert.equal(/\d{2,}|0x[0-9a-f]/i.test(JSON.stringify(r.json)), false, JSON.stringify(r.json));
});
await check("H4 no status provider → public_state byte-identical to before ({ ok, publicEntry })", async () => {
  const r = await publicState(createForkEntryHandler({ publicEntry: PUBLIC }));
  assert.deepEqual(r.json, { ok: true, publicEntry: true });
});
await check("H5 a slow or failing counter read never blocks public_state: room left out, publicEntry still answered", async () => {
  assert.ok(GR, "grant-room module missing");
  const t0 = Date.now();
  const r = await publicState(createForkEntryHandler({ publicEntry: PUBLIC, grantStatus: statusOf({ count: 8, wallet: GRANT_WEI * 100n, slow: 2000 }) }));
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
  assert.equal(r.json.publicEntry, true); assert.equal("grantRoom" in r.json, false);
  const e = await publicState(createForkEntryHandler({ publicEntry: PUBLIC, grantStatus: statusOf({ count: new Error("redis"), wallet: GRANT_WEI * 100n }) }));
  assert.deepEqual(e.json, { ok: true, publicEntry: true, grantWallet: "ok" });
});
await check("H6 reads are cached (every app boot asks public_state): two calls inside the ttl = one read each", async () => {
  assert.ok(GR, "grant-room module missing");
  let reads = 0;
  const st = GR.createGrantStatus({ cap: 10, readPublicCount: async () => { reads += 1; return 1; }, readWalletBalance: async () => { reads += 1; return GRANT_WEI * 100n; }, ttlMs: 30_000 });
  await st(); await st();
  assert.equal(reads, 2);
});

// ═══ Part E ═══
await check("E1 env wiring: counter = GET on the public counter key only · wallet = getBalance of the relayer address only (no EVAL, no send)", async () => {
  assert.ok(GR, "grant-room module missing");
  const calls = [];
  const st = GR.grantStatusFromParts({ cap: 10, cmd: async (...a) => { calls.push(a[0]); return "8"; }, prefix: "araso:v1", epoch: "default", relayerAddress: "0x1111111111111111111111111111111111111111", getBalance: async ({ address }) => { calls.push(`getBalance:${address.slice(0, 6)}`); return GRANT_WEI * 100n; } });
  assert.deepEqual(await st(), { grantRoom: "low", grantWallet: "ok" });
  assert.deepEqual(calls, ["GET", "getBalance:0x1111"]);
  assert.equal(GR.publicCountKeyFor("araso:v1", "default"), "araso:v1:grant:default:public:n");
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
