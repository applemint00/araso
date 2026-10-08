// [A-869] relayer/src/gift-gas-ledger.mjs contract + durability fault injection. node relayer/test/gift-gas-ledger.mjs
import assert from "node:assert/strict";
import * as fsReal from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openGiftGasLedger } from "../src/gift-gas-ledger.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "a869-"));
const G = `0x${"ab".repeat(32)}`;
const G2 = `0x${"cd".repeat(32)}`;
const G3 = `0x${"ef".repeat(32)}`;
const TO = "0x00000000000000000000000000000000000000A1";
const TO2 = "0x00000000000000000000000000000000000000b2";
const S = "0x00000000000000000000000000000000000000c3";
const S2 = "0x00000000000000000000000000000000000000d4";
const H = `0x${"11".repeat(32)}`;
const RAW = `0x02${"ab".repeat(40)}`;
const LIM = { perSenderMaxCount: 2n, perSenderMaxWei: 100n, globalMaxCount: 3n, globalMaxWei: 200n };
let n = 0;
const fresh = () => path.join(dir, `d${n}`, `l${n++}.json`);
let pass = 0;
const check = (label, fn) => { fn(); console.log(`PASS  ${label}`); pass += 1; };
const throwsMsg = (fn, re) => assert.throws(fn, (e) => re.test(e.message));
const tmpLeft = (p) => readdirSync(path.dirname(p)).filter((f) => f.endsWith(".tmp"));
const signed = (nonce = 0n, h = H) => ({ nonce, rawTx: RAW, txHash: h });

check("R1. reserve durable before send; second reserve refused in every state", () => {
  const p = fresh(); const l = openGiftGasLedger(p);
  l.reserve(G, TO, 5n, S, LIM);
  assert.equal(JSON.parse(readFileSync(p, "utf8")).entries[G].state, "PENDING");
  throwsMsg(() => l.reserve(G, TO, 5n, S, LIM), /ALREADY_RESERVED/);
  l.recordSigned(G, signed()); throwsMsg(() => l.reserve(G, TO, 5n, S, LIM), /ALREADY_RESERVED/);
  l.markUnknown(G, "x_test"); throwsMsg(() => l.reserve(G, TO, 5n, S, LIM), /ALREADY_RESERVED/);
  l.resolveUnknownToConfirmed(G, H); throwsMsg(() => l.reserve(G, TO, 5n, S, LIM), /ALREADY_RESERVED/);
  assert.equal(l.get(G).state, "CONFIRMED");
  l.close();
});
check("R2. destination bound; giftId strictly lowercase bytes32", () => {
  const l = openGiftGasLedger(fresh());
  l.reserve(G, TO, 5n, S, LIM);
  assert.equal(l.bindsTo(G, TO), true); assert.equal(l.bindsTo(G, TO2), false); assert.equal(l.bindsTo(G2, TO2), true);
  throwsMsg(() => l.get(`0x${"AB".repeat(32)}`), /BAD_GIFT_ID/);
  throwsMsg(() => l.reserve(`0x${"AB".repeat(32)}`, TO, 1n, S, LIM), /BAD_GIFT_ID/);
  l.close();
});
check("R3. crash (reopen) keeps every state incl. rawTx+nonce; reopen never allows a second reserve or re-sign", () => {
  const p = fresh(); let l = openGiftGasLedger(p);
  l.reserve(G, TO, 5n, S, LIM); l.close();
  l = openGiftGasLedger(p);
  assert.equal(l.get(G).state, "PENDING"); assert.equal(l.get(G).rawTx, null);
  throwsMsg(() => l.reserve(G, TO, 5n, S, LIM), /ALREADY_RESERVED/);
  l.recordSigned(G, signed(7n)); l.close();
  l = openGiftGasLedger(p);
  const e = l.get(G);
  assert.equal(e.state, "SENT"); assert.equal(e.rawTx, RAW); assert.equal(e.nonce, "7"); assert.equal(e.txHash, H);
  throwsMsg(() => l.recordSigned(G, signed(8n, `0x${"22".repeat(32)}`)), /ALREADY_SIGNED/); // no re-sign
  l.confirm(G, H); l.close();
  l = openGiftGasLedger(p); assert.equal(l.get(G).state, "CONFIRMED"); l.close();
});
check("R4. single writer; stale lock never auto-removed; close releases", () => {
  const p = fresh(); const l = openGiftGasLedger(p);
  throwsMsg(() => openGiftGasLedger(p), /LEDGER_LOCKED/);
  l.close(); assert.equal(existsSync(`${p}.lock`), false);
  writeFileSync(`${p}.lock`, "999\n");
  throwsMsg(() => openGiftGasLedger(p), /LEDGER_LOCKED/); assert.ok(existsSync(`${p}.lock`));
  rmSync(`${p}.lock`);
});
check("R5. corrupt / version / schema => throws and releases its own lock", () => {
  const ok = { giftId: G, to: TO.toLowerCase(), sender: S, valueWei: "1", state: "PENDING", nonce: null, rawTx: null, txHash: null, reason: null };
  const mk = (e, extra = {}) => JSON.stringify({ version: 2, entries: { [G]: e }, audit: [], ...extra });
  const cases = [
    ["{nope", /LEDGER_CORRUPT/],
    [JSON.stringify({ version: 1, entries: {} }), /LEDGER_UNKNOWN_VERSION/],
    [JSON.stringify({ version: 2, entries: [], audit: [] }), /LEDGER_SCHEMA/],
    [JSON.stringify({ version: 2, entries: {} }), /LEDGER_SCHEMA/],
    [mk({ ...ok, to: TO }), /LEDGER_SCHEMA/],
    [mk({ ...ok, state: "SENT" }), /LEDGER_SCHEMA/],
    [mk({ ...ok, state: "CONFIRMED" }), /LEDGER_SCHEMA/],
    [mk({ ...ok, valueWei: "0" }), /LEDGER_SCHEMA/],
    [mk({ ...ok, state: "FAILED" }), /LEDGER_SCHEMA/],
    [mk({ ...ok, rawTx: RAW }), /LEDGER_SCHEMA/],
    [mk({ ...ok, state: "SENT", rawTx: RAW, nonce: "01", txHash: H }), /LEDGER_SCHEMA/],
    [JSON.stringify({ version: 2, entries: { "0xAB": { ...ok, giftId: "0xAB" } }, audit: [] }), /LEDGER_SCHEMA/],
    [JSON.stringify({ version: 2, entries: { [G]: { ...ok, state: "SENT", rawTx: RAW, nonce: "1", txHash: H }, [G2]: { ...ok, giftId: G2, state: "SENT", rawTx: RAW, nonce: "1", txHash: H } }, audit: [] }), /LEDGER_SCHEMA/],
  ];
  for (const [text, re] of cases) {
    const p = fresh(); mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); writeFileSync(p, text);
    throwsMsg(() => openGiftGasLedger(p), re);
    assert.equal(existsSync(`${p}.lock`), false);
  }
});
check("R6. flush fault BEFORE rename (tmp open / write / fsync / rename): rollback, nothing reserved, no tmp left, later reserve works", () => {
  for (const name of ["openSync", "writeSync", "fsyncSync", "renameSync"]) {
    const p = fresh(); let armed = false;
    const io = { [name]: (...a) => { if (armed && (name !== "openSync" || String(a[0]).endsWith(".tmp"))) throw new Error("EIO"); return fsReal[name](...a); } };
    const l = openGiftGasLedger(p, { io });
    armed = true;
    assert.throws(() => l.reserve(G, TO, 1n, S, LIM), /FLUSH_FAILED/, name);
    assert.equal(l.has(G), false, name); assert.equal(l.count(), 0, name);
    assert.equal(tmpLeft(p).length, 0, `${name}: tmp cleaned`);
    assert.equal(l.isFailStopped(), false, name);
    armed = false;
    l.reserve(G, TO, 1n, S, LIM); assert.equal(l.get(G).state, "PENDING");
    armed = true; // transition rollback: a failed recordSigned leaves PENDING and no rawTx
    assert.throws(() => l.recordSigned(G, signed()), /FLUSH_FAILED/, name);
    assert.equal(l.get(G).state, "PENDING"); assert.equal(l.get(G).rawTx, null);
    armed = false; l.close();
  }
});
check("R7. fault AFTER rename (directory fsync) => FAIL-STOP: later mutations throw, reopen reads durable truth", () => {
  const p = fresh(); let dirSyncs = 0; let armed = false;
  const io = { fsyncSync: (fd) => { if (armed && ++dirSyncs === 2) throw new Error("EIO"); return fsReal.fsyncSync(fd); } };
  const l = openGiftGasLedger(p, { io });
  l.reserve(G, TO, 1n, S, LIM);
  armed = true;
  assert.throws(() => l.recordSigned(G, signed()), /FAILSTOP/); // file fsync = #1 ok, dir fsync = #2 fails
  assert.equal(l.isFailStopped(), true);
  throwsMsg(() => l.reserve(G2, TO, 1n, S, LIM), /FAILSTOP/);
  throwsMsg(() => l.markUnknown(G, "x_test"), /FAILSTOP/);
  throwsMsg(() => l.appendAudit(null, "NOTE", "x"), /FAILSTOP/);
  l.close();
  const l2 = openGiftGasLedger(p); assert.equal(l2.get(G).state, "SENT"); assert.equal(l2.get(G).rawTx, RAW); l2.close();
});
check("R8. fsync really happens: file fsync then directory fsync on every flush; tmp name unique, wx, mode 0600", () => {
  const p = fresh(); const calls = []; const opens = [];
  const io = {
    openSync: (f, fl, m) => { opens.push([String(f), fl, m]); return fsReal.openSync(f, fl, m); },
    fsyncSync: (fd) => { calls.push("fsync"); return fsReal.fsyncSync(fd); },
    renameSync: (a, b) => { calls.push("rename"); return fsReal.renameSync(a, b); },
  };
  const l = openGiftGasLedger(p, { io });
  calls.length = 0; opens.length = 0;
  l.reserve(G, TO, 1n, S, LIM);
  assert.deepEqual(calls, ["fsync", "rename", "fsync"]);
  const tmpOpen = opens.find(([f]) => f.endsWith(".tmp"));
  assert.equal(tmpOpen[1], "wx"); assert.equal(tmpOpen[2], 0o600);
  assert.notEqual(tmpOpen[0], `${p}.tmp`);
  l.markUnknown(G, "x_test");
  const tmps = opens.filter(([f]) => f.endsWith(".tmp")).map(([f]) => f);
  assert.equal(new Set(tmps).size, tmps.length);
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(p)).mode & 0o777, 0o700);
  l.close();
});
check("R9. pre-planted tmp path / symlink ledger is not followed or clobbered", () => {
  const p = fresh(); const l0 = openGiftGasLedger(p); l0.close();
  const real = path.join(dir, "elsewhere.json"); writeFileSync(real, "{}");
  const link = fresh(); mkdirSync(path.dirname(link), { recursive: true, mode: 0o700 }); symlinkSync(real, link);
  throwsMsg(() => openGiftGasLedger(link), /LEDGER_SYMLINK/);
  assert.equal(existsSync(`${link}.lock`), false);
  const loose = path.join(dir, "loose"); mkdirSync(loose, { mode: 0o755 });
  const l = openGiftGasLedger(path.join(loose, "x.json")); l.close(); // dir tightened to 0700
  assert.equal(statSync(loose).mode & 0o077, 0);
});
check("R10. caps inside reserve: per-sender count/wei, global count/wei; unset limits fail closed", () => {
  const l = openGiftGasLedger(fresh());
  throwsMsg(() => l.reserve(G, TO, 10n, S), /LIMITS_UNSET/);
  throwsMsg(() => l.reserve(G, TO, 10n, S, { ...LIM, globalMaxWei: undefined }), /LIMITS_UNSET/);
  throwsMsg(() => l.reserve(G, TO, 10n, S, { ...LIM, perSenderMaxCount: 0n }), /LIMITS_UNSET/);
  assert.equal(l.count(), 0);
  l.reserve(G, TO, 40n, S, LIM); l.reserve(G2, TO, 40n, S, LIM);
  throwsMsg(() => l.reserve(G3, TO, 1n, S, LIM), /LIMIT_SENDER_COUNT/);
  throwsMsg(() => l.reserve(G3, TO, 30n, S2, { ...LIM, perSenderMaxWei: 20n }), /LIMIT_SENDER_WEI/);
  l.reserve(G3, TO, 30n, S2, LIM); // global 110 wei, 3 entries
  throwsMsg(() => l.reserve(`0x${"01".repeat(32)}`, TO, 1n, S2, LIM), /LIMIT_GLOBAL_COUNT/);
  const l2 = openGiftGasLedger(fresh());
  l2.reserve(G, TO, 90n, S, LIM);
  throwsMsg(() => l2.reserve(G2, TO, 90n, S2, { ...LIM, perSenderMaxWei: 150n, globalMaxWei: 150n }), /LIMIT_GLOBAL_WEI/);
  // UNKNOWN entries still count (nothing is ever released automatically)
  l2.markUnknown(G, "x_test"); throwsMsg(() => l2.reserve(G2, TO, 90n, S2, { ...LIM, globalMaxWei: 150n }), /LIMIT_GLOBAL_WEI/);
  l.close(); l2.close();
});
check("R11. rawTx+nonce fixed: nonce reuse across gifts refused; confirm only from SENT; UNKNOWN never silently revived", () => {
  const l = openGiftGasLedger(fresh());
  l.reserve(G, TO, 5n, S, LIM); l.reserve(G2, TO, 5n, S2, LIM);
  throwsMsg(() => l.confirm(G, H), /BAD_TRANSITION/); // PENDING cannot confirm
  l.recordSigned(G, signed(3n));
  throwsMsg(() => l.recordSigned(G2, signed(3n, `0x${"33".repeat(32)}`)), /NONCE_REUSED/);
  assert.equal(l.get(G2).state, "PENDING");
  assert.equal(l.nextSafeNonce(), 4n);
  throwsMsg(() => l.confirm(G, `0x${"22".repeat(32)}`), /HASH_CONFLICT/);
  l.markUnknown(G, "nonce_consumed");
  throwsMsg(() => l.confirm(G, H), /BAD_TRANSITION/);
  throwsMsg(() => l.resolveUnknownToConfirmed(G, `0x${"22".repeat(32)}`), /HASH_CONFLICT/);
  throwsMsg(() => l.resolveUnknownToConfirmed(G2, H), /BAD_TRANSITION/); // never signed
  l.markUnknown(G2, "sign_failed"); throwsMsg(() => l.resolveUnknownToConfirmed(G2, H), /BAD_TRANSITION/);
  l.resolveUnknownToConfirmed(G, H); assert.equal(l.get(G).state, "CONFIRMED");
  throwsMsg(() => l.markUnknown(G, "x_test"), /BAD_TRANSITION/);
  assert.ok(l.auditTrail().some((a) => a.action === "RESOLVED_CONFIRMED"));
  l.close();
});
check("R12. audit is append-only, state untouched, bad notes (rawTx-like / long / bad action) refused", () => {
  const p = fresh(); const l = openGiftGasLedger(p);
  l.reserve(G, TO, 5n, S, LIM);
  const before = JSON.stringify(l.list());
  l.appendAudit(G, "VOID_REVIEWED", "nonce unused, checked"); l.appendAudit(null, "NOTE", "x");
  assert.equal(JSON.stringify(l.list()), before);
  assert.equal(l.auditTrail().length, 2);
  throwsMsg(() => l.appendAudit(G, "DELETE", "x"), /BAD_AUDIT_ACTION/);
  throwsMsg(() => l.appendAudit(G, "NOTE", `0x${"ab".repeat(80)}`), /BAD_AUDIT_NOTE/);
  throwsMsg(() => l.appendAudit(G2, "NOTE", "x"), /ENTRY_MISSING/);
  l.close();
  const l2 = openGiftGasLedger(p); assert.equal(l2.auditTrail().length, 2); l2.close();
});
check("R13. get/list return copies (callers cannot mutate ledger state); bad inputs refused", () => {
  const l = openGiftGasLedger(fresh());
  l.reserve(G, TO, 5n, S, LIM);
  const e = l.get(G); e.state = "CONFIRMED"; e.valueWei = "999";
  assert.equal(l.get(G).state, "PENDING"); assert.equal(l.get(G).valueWei, "5");
  throwsMsg(() => l.reserve(G2, "0x12", 1n, S, LIM), /BAD_DESTINATION/);
  throwsMsg(() => l.reserve(G2, TO, 0n, S, LIM), /BAD_VALUE/);
  throwsMsg(() => l.reserve(G2, TO, 1n, "nope", LIM), /BAD_SENDER/);
  throwsMsg(() => l.recordSigned(G, { nonce: 1n, rawTx: "nope", txHash: H }), /BAD_RAWTX/);
  throwsMsg(() => l.recordSigned(G, { nonce: -1n, rawTx: RAW, txHash: H }), /BAD_NONCE/);
  l.close();
});
rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass} PASS`);
