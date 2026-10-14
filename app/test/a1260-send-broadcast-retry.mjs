// [A-1260] First Send deposit broadcast retry + proved-never-sent cleanup. Network/browser/key 0.
import { readFileSync } from "node:fs";
import { keccak256 } from "viem";

const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function cut(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`source marker missing: ${startMarker}`);
  return SRC.slice(start, end);
}
const pendingConsts = cut('const SEND_PENDING_KEY = "araso.sendPending";', "\n\n");
const lockSrc = cut("let sendInFlight = false;", "\nasync function sendPiggyOnce(");

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS ${label}`); pass += 1; }
  else { console.log(`FAIL ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}
function storageWith(pending) {
  const rows = new Map(pending ? [["araso.sendPending", JSON.stringify(pending)]] : []);
  return {
    getItem: (key) => rows.has(key) ? rows.get(key) : null,
    setItem: (key, value) => rows.set(key, String(value)),
    removeItem: (key) => rows.delete(key),
  };
}
function rpcError(message = "insufficient funds for gas * secret") {
  const error = new Error(message);
  error.name = "InvalidInputRpcError";
  error.code = -32000;
  return error;
}
function makeHarness({ failures = 0, receipt = "missing", chainNonce = 7 } = {}) {
  const calls = { send: 0, receipt: 0, nonce: 0, waits: 0 };
  const hash = keccak256("0xa0");
  const pending = { stage: "deposit-broadcast", phase: "signed", address: "0x1111111111111111111111111111111111111111", depositTxHash: hash, nonce: 7, reservationId: "r1" };
  const localStorage = storageWith(pending);
  const held = new Set();
  const env = {
    localStorage,
    isTxHash: (value) => /^0x[0-9a-fA-F]{64}$/.test(String(value)),
    publicClient: {
      sendRawTransaction: async () => { calls.send += 1; if (calls.send <= failures) throw rpcError(); return hash; },
      getTransactionReceipt: async () => {
        calls.receipt += 1;
        if (receipt === "found") return { status: "success" };
        const error = new Error("not found"); error.name = "TransactionReceiptNotFoundError"; throw error;
      },
      getTransactionCount: async ({ blockTag }) => { calls.nonce += 1; check("nonce proof uses pending block tag", blockTag, "pending"); return chainNonce; },
    },
    navigator: { locks: {
      request: async (name, options, fn) => {
        if (held.has(name)) return fn(null);
        held.add(name); try { return await fn({ name }); } finally { held.delete(name); }
      },
      query: async () => ({ held: [], pending: [] }),
    } },
    setTimeout: (fn) => { calls.waits += 1; fn(); return 0; },
    crypto: { getRandomValues: (array) => globalThis.crypto.getRandomValues(array) },
  };
  const names = Object.keys(env);
  const made = new Function(...names, `${pendingConsts}\n${lockSrc}\nreturn { broadcastDepositRaw, clearProvenNeverSentDeposit, retryableDepositBroadcastError };`)(...names.map((name) => env[name]));
  return { ...made, calls, localStorage, pending, hash };
}

{
  const h = makeHarness({ failures: 1 });
  check("first -32000 then second succeeds with same raw hash", await h.broadcastDepositRaw("0xa0"), h.hash);
  check("broadcast attempts", h.calls.send, 2);
  check("one bounded wait", h.calls.waits, 1);
}
{
  const h = makeHarness({ failures: 4 });
  let caught = null;
  try { await h.broadcastDepositRaw("0xa0"); } catch (error) { caught = error; }
  check("four immediate rejections stop", h.calls.send, 4);
  check("three waits between four attempts", h.calls.waits, 3);
  check("final RPC error preserved for safe classification", caught?.code, -32000);
  check("receipt absent + pending nonce unchanged clears", await h.clearProvenNeverSentDeposit(h.pending), true);
  check("cleared record makes Send available", h.localStorage.getItem("araso.sendPending"), null);
}
{
  const h = makeHarness({ receipt: "missing", chainNonce: 8 });
  check("advanced nonce keeps signed record", await h.clearProvenNeverSentDeposit(h.pending), false);
  check("record remains when nonce advanced", h.localStorage.getItem("araso.sendPending") !== null, true);
}
{
  const h = makeHarness({ receipt: "found", chainNonce: 7 });
  check("existing receipt keeps signed record", await h.clearProvenNeverSentDeposit(h.pending), false);
  check("record remains when receipt exists", h.localStorage.getItem("araso.sendPending") !== null, true);
}

check("source wires deposit through bounded retry", /const depositSentHash = await broadcastDepositRaw\(depositSigned\.raw\)/.test(SRC), true);
check("source boot reconcile can clear only proved signed deposit", /clearProvenNeverSentDeposit\(pending\)/.test(SRC), true);
const reverted = SRC.replace("const depositSentHash = await broadcastDepositRaw(depositSigned.raw);", "const depositSentHash = await publicClient.sendRawTransaction({ serializedTransaction: depositSigned.raw });");
check("revert mutation fails the retry source pin", /const depositSentHash = await broadcastDepositRaw\(depositSigned\.raw\)/.test(reverted), false);

console.log(`A1260 ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
