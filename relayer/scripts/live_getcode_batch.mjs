// ONE live READ-ONLY JSON-RPC batch on Monad 143: eth_chainId + eth_getCode x5. No tx, no key, no env secret, no signing.
// Run (reviewer):   node relayer/scripts/live_getcode_batch.mjs
//   optional: A913_RPC_URL=<rpc> (default https://rpc.monad.xyz, the same upstream the A-906 fork harness reads from)
// Compares keccak256(code) with relayer/src/gift-sponsor-service.mjs GIFT_SPONSOR_PIN_TABLE[143] (the same table the runtime preflight uses),
// prints one row per target + PASS/FAIL, and writes raw/live_getcode_143.json next to this script (hashes only; code bytes are not stored).
// Exit 0 = all five match and chainId == 143; exit 1 = mismatch; exit 2 = RPC/other failure.
import { mkdirSync, writeFileSync } from "node:fs";
import { keccak256 } from "viem";
import { GIFT_SPONSOR_PIN_TABLE } from "../src/gift-sponsor-service.mjs";

const RPC = process.env.A913_RPC_URL || "https://rpc.monad.xyz";
const T = GIFT_SPONSOR_PIN_TABLE; const H = T.hashes[143];
const rows = [
  ["delegateImpl (StatelessDeleGator)", T.addresses.delegateImpl, H.implCodeHash],
  ["delegationManager", T.addresses.delegationManager, H.delegationManagerCodeHash],
  ["exactExecutionEnforcer", T.addresses.exactExecutionEnforcer, H.exactExecutionCodeHash],
  ["limitedCallsEnforcer", T.addresses.limitedCallsEnforcer, H.limitedCallsCodeHash],
  ["timestampEnforcer (was FORK-READ)", T.addresses.timestampEnforcer, H.timestampCodeHash],
];
const batch = [{ jsonrpc: "2.0", id: 0, method: "eth_chainId", params: [] }, ...rows.map(([, a], i) => ({ jsonrpc: "2.0", id: i + 1, method: "eth_getCode", params: [a, "latest"] }))];
const READ_ONLY = new Set(["eth_chainId", "eth_getCode"]);
if (!batch.every((m) => READ_ONLY.has(m.method))) { console.error("refusing: non read-only method in batch"); process.exit(2); }
try {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch) });
  const out = await res.json(); const byId = new Map(out.map((x) => [x.id, x]));
  const chainId = parseInt(byId.get(0)?.result ?? "0x0", 16);
  let ok = chainId === 143; const result = [];
  rows.forEach(([name, address, expected], i) => {
    const code = byId.get(i + 1)?.result; const actual = typeof code === "string" && code.length > 2 ? keccak256(code) : null;
    const match = actual === expected; ok = ok && match;
    result.push({ name, address, expected, actual, bytes: typeof code === "string" ? (code.length - 2) / 2 : null, match });
    console.log(`${match ? "PASS" : "FAIL"}  ${name}  ${address}  bytes=${typeof code === "string" ? (code.length - 2) / 2 : "?"}  ${actual ?? "no code"}`);
  });
  const dir = new URL("./raw/", import.meta.url); mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("live_getcode_143.json", dir), JSON.stringify({ rpcHost: new URL(RPC).host, chainId, at: new Date().toISOString(), methods: ["eth_chainId", "eth_getCode x5 (one batch)"], liveTx: 0, rows: result, allMatch: ok }, null, 2));
  console.log(`chainId=${chainId}  ${ok ? "ALL MATCH" : "MISMATCH"}  (live tx 0)`);
  process.exit(ok ? 0 : 1);
} catch (e) { console.error(`RPC failure: ${String(e.message).slice(0, 120)}`); process.exit(2); }
