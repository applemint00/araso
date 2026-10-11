// [A-924 · Owner 2026-10-10 06:4x ③] Move out amount = `all · <balance>` + typed (no fixed $ presets). Validation = the existing send-money resolveAmount
// (> 0 · <= free balance · AMOUNT regex), unchanged. Frames 390 / 390i / 810 / 1440 (no sweep, A-923 rule 2). WebAuthn and tx deltas must stay 0.
// Harness = the a917 test's own seeding / RPC stub / counters (copied, not imported, so a917 stays untouched).
// Browser only (ARASO_TEST_BROWSER=1). Without it this file prints SKIP and exits 0.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { testOutDir } from "./helpers/test-out.mjs"; // [A-932]

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a924 move-out browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }

const { launch, sleep, REPO } = await import("./helpers/a803-browser.mjs");
const OUT = testOutDir("a924-move-out-amount-browser", process.argv[2]); // [A-932] pre-A-932 baseline default: receipts/A924_amount_plus_mock_p2/move-out
mkdirSync(OUT, { recursive: true });
const SIZES = [{ id: "390", w: 390, h: 844 }, { id: "810", w: 810, h: 1080 }, { id: "1440", w: 1440, h: 900 }, { id: "390i", w: 390, h: 844, top: 59, bottom: 34 }];
const OUT_ADDR = "0x1111111111111111111111111111111111111111";
const frames = {};
const stepErrors = [];
const failures = [];
const offsite = [];
const note = (id, size, facts) => { (frames[id] ||= {})[size.id] = facts; };
const must = (cond, msg) => { if (!cond) { failures.push(msg); console.log(`ASSERT FAIL  ${msg}`); } };

const H = await launch({ forkMode: true }); // [A-950] fork-profile mode (STALE_TESTS class (a)): Money opens only on the fork profile since A-948
const { p } = H;
await H.context.addInitScript(`(() => { const w = window.__wa = { create: 0, get: 0 }; const c = navigator.credentials; if (c) { const oc = c.create.bind(c), og = c.get.bind(c); c.create = (o) => { w.create++; return oc(o); }; c.get = (o) => { w.get++; return og(o); }; } })();`);
let txCount = 0;
const waNow = () => p.evaluate(() => ({ ...(window.__wa || { create: 0, get: 0 }) }));
const mark = async () => ({ wa: await waNow(), tx: txCount });
async function expectZero(label, m0, { proof = false } = {}) {
  const m1 = await mark();
  const dGet = m1.wa.get - m0.wa.get, dCreate = m1.wa.create - m0.wa.create, dTx = m1.tx - m0.tx;
  if (proof) must(dGet === 1 && dCreate === 0, `${label}: crypto-row proof = exactly one passkey assertion (get+${dGet} create+${dCreate})`);
  else must(dGet === 0 && dCreate === 0, `${label}: WebAuthn delta must be 0 (get+${dGet} create+${dCreate})`);
  must(dTx === 0, `${label}: tx delta must be 0 (got ${dTx})`);
}
const rpcResult = (m) => (m === "eth_chainId" ? "0x279f" : m === "eth_blockNumber" ? "0x1" : m === "eth_getBalance" ? "0x0" : m === "eth_call" ? `0x${"0".repeat(64)}` : "0x0");
await H.context.route("**/*", async (route) => {
  const req = route.request(); const u = new URL(req.url());
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.fallback();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (req.method() !== "POST") { offsite.push(`${req.method()} ${u.hostname}`); return route.abort(); }
  let body; try { body = JSON.parse(req.postData() || "null"); } catch { offsite.push(`POST(non-json) ${u.hostname}`); return route.abort(); }
  if (/eth_send/.test(JSON.stringify(body))) { txCount += 1; return route.abort(); }
  const one = (r) => ({ jsonrpc: "2.0", id: r?.id ?? 1, result: rpcResult(r?.method) });
  return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
});

const has = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }, sel);
const tapSel = async (sel, label, idx = 0) => { await H.mustTap(sel, label || sel, idx); await sleep(650); };
async function waitFor(sel, ms = 6000) { for (let t0 = Date.now(); Date.now() - t0 < ms;) { if (await has(sel)) return true; await sleep(150); } return false; }
async function typeInto(sel, value) {
  await H.mustTap(sel, `field ${sel}`);
  await p.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await p.keyboard.press("Backspace");
  if (value) await p.keyboard.type(value, { delay: 15 });
  await sleep(250);
}
const regKey = async () => `araso.piggyRegistry.${H.scope}.${await p.evaluate(() => localStorage.getItem("araso.address"))}`;
/** Local registry seed (test-side localStorage only): n Piggies at home, USDC each; extra Piggies get distinct fake addresses. */
async function seedPiggies(n, usdc = "38", { away = 0 } = {}) {
  const key = await regKey();
  return p.evaluate(({ key, n, usdc, away, chainId }) => {
    const at = new Date().toISOString();
    const a = localStorage.getItem("araso.address");
    const idxKey = Object.keys(localStorage).find((k) => /^araso\.myPiggies/.test(k));
    const idx = idxKey ? JSON.parse(localStorage.getItem(idxKey)) : null;
    const real = (idx?.piggies || [{ id: "solo", name: "Honeybun", address: a }]).slice(0, 1).map((r) => ({ id: r.id, name: r.name, address: r.address || a, createdAt: at, historyKey: `araso.piggyRegistry.history.${r.id}` })); // the first indexed Piggy = the real one (same seed as a905)
    const extra = Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({ id: `a911-${i + 2}`, name: `Piggy ${i + 2}`, address: `0x${(i + 2).toString(16).padStart(40, "0")}`, createdAt: at, historyKey: `araso.piggyRegistry.history.a911-${i + 2}` }));
    const list = [...real, ...extra].slice(0, n).map((x, i) => ({ ...x, location: i >= n - away ? "away" : "home", assets: [{ symbol: "USDC", quantity: usdc, decimals: 6, sourceTimestamp: at }], valuation: null }));
    localStorage.setItem(key, JSON.stringify({ version: 1, accountId: a, chainId, piggies: list }));
    return list.length;
  }, { key, n, usdc, away, chainId: H.scope }); // [A-950] registry in the booted chain scope (pre-A-950: "monad-testnet")
}

async function fresh(size) {
  await p.setViewportSize({ width: size.w, height: size.h });
  await H.atWidth(size.w, size.h);
  await H.closeRecords();
  await sleep(500);
  await p.evaluate(({ top, bottom }) => { const r = document.documentElement.style; if (top) { r.setProperty("--a911-inset-top", `${top}px`); r.setProperty("--a911-inset-bottom", `${bottom}px`); } else { r.removeProperty("--a911-inset-top"); r.removeProperty("--a911-inset-bottom"); } }, { top: size.top || 0, bottom: size.bottom || 0 });
}
async function openTab() {
  await tapSel("#a905Jar", "honey jar");
  const ok = await waitFor('.a911-screen[data-a911="money"]', 6000);
  await sleep(500);
  return ok;
}


async function reachOutAmount(size) {
  await fresh(size);
  await openTab();
  await tapSel("#a905MoveMoney", "Move money");
  await waitFor(".a911-sw", 6000);
  await tapSel('[data-a905-act="dir"][data-a905-arg="out"]', "out");
  await waitFor("#a924OutAmount", 4000);
  await sleep(400);
}
const state = () => p.evaluate(() => {
  const ok = document.querySelector("#a905OutOk");
  const chips = [...document.querySelectorAll(".a911-chips--paper .a911-chip")].map((c) => ({ tag: c.tagName, text: c.textContent.trim(), on: c.classList.contains("is-on") }));
  const f = document.querySelector("#a924OutAmount");
  return { ok: ok ? !ok.disabled : null, value: f ? f.value : null, focused: document.activeElement === f, chips, fs: f ? parseFloat(getComputedStyle(f).fontSize) : null };
});
async function typeAmount(v) {
  await typeInto("#a924OutAmount", v);
  const s = await state();
  await p.evaluate(() => document.activeElement?.blur?.()); await sleep(500);
  return s;
}
try {
  await H.seedSolo("Honeybun");
  await p.evaluate((k) => localStorage.setItem(k, "1"), H.secondKey("araso.secondJourneyClosed")); // [A-950] fork scope key (pre-A-950: the bare testnet key)
  await seedPiggies(1, "38");
  const rows = {};
  for (const size of SIZES) {
    await reachOutAmount(size);
    const m0 = await mark(); // after the page load (a reload resets the in-page WebAuthn counters): the amount step itself must add 0
    const s0 = await state();
    writeFileSync(path.join(OUT, `out-amount__${size.id}.png`), await p.screenshot({ type: "png" }));
    must(s0.chips.length === 2 && /^all · 38$/.test(s0.chips[0].text) && s0.chips[0].tag === "BUTTON" && s0.chips[1].text === "custom" && s0.chips[1].tag === "LABEL", `[${size.id}] chips = "all · 38" + custom label (got ${JSON.stringify(s0.chips)})`);
    must(!s0.chips.some((c) => /^\$\d/.test(c.text)), `[${size.id}] no fixed $ preset chips`);
    must(s0.value === "" && s0.ok === false, `[${size.id}] empty amount: ok off (value "${s0.value}", ok ${s0.ok})`);
    must(s0.fs >= 16, `[${size.id}] amount input >= 16 px (no iPhone zoom): ${s0.fs}`);
    await tapSel('[data-a905-act="out-choice"]', "all");
    const sAll = await state();
    must(sAll.value === "38" && sAll.ok === true && sAll.chips[0].on, `[${size.id}] all = the whole balance in the box, ok on, chip lit (value "${sAll.value}", ok ${sAll.ok})`);
    const t1 = await typeAmount("12.5"); must(t1.ok === true, `[${size.id}] 12.5 accepted (ok ${t1.ok})`);
    const t2 = await typeAmount("38.01"); must(t2.ok === false, `[${size.id}] balance + 0.01 refused (ok ${t2.ok})`);
    const t3 = await typeAmount("0"); must(t3.ok === false, `[${size.id}] 0 refused (ok ${t3.ok})`);
    const t4 = await typeAmount(""); must(t4.ok === false, `[${size.id}] empty refused (ok ${t4.ok})`);
    await p.locator('label.a911-chip[for="a924OutAmount"]').first().click().catch(() => {}); await sleep(400);
    const sC = await state(); must(sC.focused === true, `[${size.id}] custom = focuses the amount field`);
    writeFileSync(path.join(OUT, `out-amount-typing__${size.id}.png`), await p.screenshot({ type: "png" }));
    await p.evaluate(() => document.activeElement?.blur?.()); await sleep(400);
    await expectZero(`[${size.id}] out amount`, m0);
    rows[size.id] = { s0, sAll, t1, t2, t3, t4, sC };
  }
  writeFileSync(path.join(OUT, "a924-move-out.json"), JSON.stringify({ rows, failures, offsite, txCount }, null, 1));
} catch (e) { failures.push(`exception: ${String((e && e.stack) || e).slice(0, 400)}`); console.log("EXCEPTION", e); }
finally { must(offsite.length === 0, `network: nothing beyond the local stub (saw ${offsite.slice(0, 5).join(", ")})`); await H.close?.(); }
console.log(failures.length ? `a924 move-out: ${failures.length} FAIL` : "a924 move-out: PASS");
process.exit(failures.length ? 1 : 0);
