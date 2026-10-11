// [A-917] A-911 Gift / Money / Move buttons on the Framer rule, in a real browser: the shared button (Gift Send, Move out ok, Move out Send) has the SAME x / y / w / h on every screen at 390 / 390i / 810 / 1440;
//   right edge = the side margin line (hkKey 20 / 52 / 120), bottom edge = safe-area + the A-829 bottom margin (7.1 / 8 / 8 % of height); no size/place steps over a coarse 25 px width sweep (360..1600) and a 1 px card sweep 1000..1100.
//   ARASO_TEST_BROWSER=1 node app/test/a917-a911-framer-layout-browser.mjs [outDir]   (A803_BASE_URL=http://localhost:<port>/ to reuse your own vite)
//   ARASO_TEST_BROWSER=1 node app/test/a911-own-screens-browser.mjs [outDir]
// Skipped unless ARASO_TEST_BROWSER=1 (headless Chrome + a local vite port; npm test stays node-only). Edits nothing in the app; the only writes are test-side localStorage seeds.
// Per step it writes <frame>_<size>.png + frames.json (rects, text sizes, element hits). Counters: WebAuthn (wrapped at document start) and tx (eth_send* seen by the RPC stub).
// First screens (jar tap -> Money tab -> Gift fan / Move rows / out pick) must keep WebAuthn Δ0 and tx Δ0; the crypto row is the one step with exactly one passkey assertion (A-555 destination proof).
// Assertions per frame: background full-bleed (screen = viewport), no horizontal overflow, header (ARASO, back sticker, title) below the top inset, Send / ok above the bottom inset, no Chog / Piggy / jar
// above the screen, text >= 12 px, inputs >= 16 px, back sticker hit >= 44. Multi-Piggy: the Piggy list scrolls only after the paper reached the safe area (8 Piggies at 390x844), scrollbar hidden.
// 1440 Move money: `ok` / `Send` sits beside the paper on the right (Owner answer 7). Keyboard: focus puts the screen in typing mode (card / paper up, Send / ok hidden); the real keyboard height needs a device (UNKNOWN here).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { testOutDir } from "./helpers/test-out.mjs"; // [A-932]

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a917 browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }

const { launch, sleep, REPO } = await import("./helpers/a803-browser.mjs");
const OUT = testOutDir("a917-a911-framer-layout-browser", process.argv[2]); // [A-932] pre-A-932 baseline default: receipts/A917_a911_framer_layout/app-run
mkdirSync(OUT, { recursive: true });
const SIZES = [{ id: "390", w: 390, h: 844 }, { id: "810", w: 810, h: 1080 }, { id: "1440", w: 1440, h: 900 }, { id: "390i", w: 390, h: 844, top: 59, bottom: 34 }];
const OUT_ADDR = "0x1111111111111111111111111111111111111111";
const frames = {};
const stepErrors = [];
const failures = [];
const offsite = [];
const note = (id, size, facts) => { (frames[id] ||= {})[size.id] = facts; };
const must = (cond, msg) => { if (!cond) { failures.push(msg); console.log(`ASSERT FAIL  ${msg}`); } };

const H = await launch({ forkMode: true }); // [A-950] fork-profile mode (STALE_TESTS class (a)): Second / "Second done" features open only on the fork profile since A-948
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
  return p.evaluate(({ key, n, usdc, away }) => {
    const at = new Date().toISOString();
    const a = localStorage.getItem("araso.address");
    const idxKey = Object.keys(localStorage).find((k) => /^araso\.myPiggies/.test(k));
    const idx = idxKey ? JSON.parse(localStorage.getItem(idxKey)) : null;
    const real = (idx?.piggies || [{ id: "solo", name: "Honeybun", address: a }]).slice(0, 1).map((r) => ({ id: r.id, name: r.name, address: r.address || a, createdAt: at, historyKey: `araso.piggyRegistry.history.${r.id}` })); // the first indexed Piggy = the real one (same seed as a905)
    const extra = Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({ id: `a911-${i + 2}`, name: `Piggy ${i + 2}`, address: `0x${(i + 2).toString(16).padStart(40, "0")}`, createdAt: at, historyKey: `araso.piggyRegistry.history.a911-${i + 2}` }));
    const list = [...real, ...extra].slice(0, n).map((x, i) => ({ ...x, location: i >= n - away ? "away" : "home", assets: [{ symbol: "USDC", quantity: usdc, decimals: 6, sourceTimestamp: at }], valuation: null }));
    localStorage.setItem(key, JSON.stringify({ version: 1, accountId: a, chainId: key.split(".")[2] /* [A-950] the scope in regKey() (pre-A-950: "monad-testnet") */, piggies: list }));
    return list.length;
  }, { key, n, usdc, away });
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

const { a911Z, a911Bottom, a911SideM } = await import("../src/a911-screens.js");
async function step(name, fn) { try { await fn(); } catch (e) { stepErrors.push({ step: name, error: String((e && e.message) || e).slice(0, 500) }); console.log(`STEP ERROR  ${name}: ${String((e && e.message) || e).slice(0, 200)}`); } }
const FREEZE = process.env.ARASO_SWEEP === "freeze"; // [A-926] ARASO_SWEEP=freeze → full sweep; otherwise 390/390i/810/1440 only (A-923 rule 2: 1px sweep once, at freeze)
const SWEEP_STEP = Number(process.env.A917_SWEEP_STEP || 25);

// the shared button + the picked card (Gift) on the open own screen
const MEASURE = () => {
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const root = document.querySelector(".a911-screen");
  const act = root && root.querySelector(".a911-act");
  const card = root && root.querySelector(".a911-card.is-picked");
  const cs = act ? getComputedStyle(act) : null;
  return { vw: innerWidth, vh: innerHeight, act: R(act), card: R(card), fs: cs ? parseFloat(cs.fontSize) : null, kind: act ? act.className : null };
};
const measure = () => p.evaluate(MEASURE);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const R1 = (v) => Math.round(v * 100) / 100;

const results = { places: {}, sweep: {}, cardSweep: [] };

// ── reach each screen's button state ─────────────────────────────────────────────────────────────────────────────────
async function reachGift(size, { stopAtPick = false } = {}) {
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("araso.giftSendDraft.v1.")) localStorage.removeItem(k); }).catch(() => {});
  await fresh(size);
  await openTab();
  await tapSel("#a905GiftPiggy", "Gift a Piggy");
  must(await waitFor(".a911-cards", 6000), `[gift ${size.id}] Gift opens`);
  await sleep(600);
  await tapSel(".a911-card.is-side", "side card", 0).catch(() => {});
  await tapSel('.a911-card.is-centre [data-a898-act="gift-front"]', "centre card"); await sleep(900);
  await tapSel('[data-a898-act="gift-amount"][data-a898-arg="20"]', "$20").catch(() => {}); await sleep(400);
  if (stopAtPick) return;
  await tapSel(".a911-card.is-picked", "flip").catch(() => {}); await sleep(900);
  await typeInto('[data-a898-field="to"]', "Dana");
  await p.evaluate(() => document.activeElement?.blur?.()); await sleep(600);
}
async function reachOutAmount(size) {
  await fresh(size);
  await openTab();
  await tapSel("#a905MoveMoney", "Move money");
  await waitFor(".a911-sw", 6000);
  await tapSel('[data-a905-act="dir"][data-a905-arg="out"]', "out");
  await sleep(400);
  await waitFor("[data-a905-amount-view]", 4000);
  await sleep(400);
}
async function reachOutAddress(size) {
  await reachOutAmount(size);
  await tapSel('[data-a905-act="out-choice"]', "amount chip").catch(() => {}); await sleep(300);
  await tapSel("#a905OutOk", "amount ok");
  await waitFor('[data-a905-field="address"]', 4000);
  await typeInto('[data-a905-field="address"]', OUT_ADDR);
  await p.evaluate(() => document.activeElement?.blur?.()); await sleep(600);
}
const SCREENS = [["gift-send", reachGift], ["move-out-ok", reachOutAmount], ["move-out-send", reachOutAddress]];

// expected place: right = side margin line, bottom = safe-area + A-829 bottom margin
function expectPlace(m, size) {
  const W = m.vw, H = m.vh;
  return { right: W - a911SideM(W), bottom: H - (size.bottom || 0) - a911Bottom(W, H), z: a911Z(W) };
}

try {
  await H.seedSolo("Honeybun");
  await p.evaluate((k) => localStorage.setItem(k, "1"), H.secondKey("araso.secondJourneyClosed"));
  await seedPiggies(1, "38");

  // 1) same place at the four widths on every screen
  for (const size of SIZES) {
    const got = {};
    for (const [name, reach] of SCREENS) {
      await step(`${name} ${size.id}`, async () => {
        await reach(size);
        const m = await measure();
        must(Boolean(m.act), `[${name} ${size.id}] the button exists`);
        if (!m.act) return;
        got[name] = m;
        await p.screenshot({ path: path.join(OUT, `${name}__${size.id}.png`) });
        const e = expectPlace(m, size);
        must(near(m.act.r, e.right, 0.6), `[${name} ${size.id}] right margin: button right ${R1(m.act.r)} = margin line ${R1(e.right)}`);
        must(near(m.act.b, e.bottom, 0.6), `[${name} ${size.id}] bottom margin: button bottom ${R1(m.act.b)} = H - inset - A-829 bottom ${R1(e.bottom)}`);
        must(near(m.act.h, 51.2 * e.z, 0.6), `[${name} ${size.id}] height = 3.2em x z (${R1(m.act.h)} vs ${R1(51.2 * e.z)})`);
        must(near(m.fs, 16 * e.z, 0.05), `[${name} ${size.id}] label = Button 16 x z (${m.fs} vs ${R1(16 * e.z)})`);
      });
    }
    const names = Object.keys(got);
    must(names.length === SCREENS.length, `[${size.id}] all three screens measured (${names.join(", ")})`);
    if (names.length > 1) {
      const a = got[names[0]].act;
      for (const n of names.slice(1)) {
        const b = got[n].act;
        for (const k of ["x", "y", "w", "h"]) must(near(a[k], b[k], 0.6), `[${size.id}] ${k} equal across screens: ${names[0]} ${R1(a[k])} vs ${n} ${R1(b[k])}`);
      }
    }
    results.places[size.id] = Object.fromEntries(Object.entries(got).map(([n, m]) => [n, m.act]));
  }

  // [A-926] ARASO_SWEEP=freeze → full sweep; otherwise 390/390i/810/1440 only (A-923 rule 2: 1px sweep once, at freeze)
  if (FREEZE) {
    // 2) coarse width sweep (the full 1 px sweep is in the design receipt): no size / place steps, always on the rule
    for (const [name, reach] of SCREENS) {
      await step(`sweep ${name}`, async () => {
        await reach({ id: "sweep", w: 1440, h: 900 });
        const rows = [];
        for (let w = 360; w <= 1600; w += SWEEP_STEP) {
          await p.setViewportSize({ width: w, height: 900 }); await sleep(260);
          const m = await measure();
          if (!m.act) { must(false, `[sweep ${name} ${w}] button missing`); continue; }
          const e = expectPlace(m, { bottom: 0 });
          must(near(m.act.r, e.right, 0.6) && near(m.act.b, e.bottom, 0.6), `[sweep ${name} ${w}] on the rule (r ${R1(m.act.r)}/${R1(e.right)} b ${R1(m.act.b)}/${R1(e.bottom)})`);
          rows.push({ ...m.act, vw: w, z: e.z });
        }
        results.sweep[name] = rows;
        for (let i = 1; i < rows.length; i += 1) {
          const a = rows[i - 1], b = rows[i], dw = b.vw - a.vw;
          const lim = (b.vw > 1440 ? dw / a.vw : 0.00045 * dw) + 0.002; // above 1440 z follows W / 1440 (A-829 cap 1.33), so a step is dw / W
          // x is measured from the right side (right = margin line). A 25 px step may move z by <= 0.9 %; a media-query step (1 -> 1.15 -> 1.35) would be 15 % / 17 %
          must(Math.abs(b.h - a.h) / a.h <= lim, `[sweep ${name} ${a.vw}->${b.vw}] height step ${R1(a.h)} -> ${R1(b.h)}`);
          must(Math.abs(b.w - a.w) / a.w <= lim, `[sweep ${name} ${a.vw}->${b.vw}] width step ${R1(a.w)} -> ${R1(b.w)}`);
          must(Math.abs((b.vw - b.x) - (a.vw - a.x)) <= 0.2 * dw + 1, `[sweep ${name} ${a.vw}->${b.vw}] distance of the left edge from the right side ${R1(a.vw - a.x)} -> ${R1(b.vw - b.x)}`);
          must(Math.abs(b.y - a.y) <= 0.05 * dw + 1, `[sweep ${name} ${a.vw}->${b.vw}] y step ${R1(a.y)} -> ${R1(b.y)}`);
        }
      });
    }

    // 3) Gift card at the 1024 arrangement switch: no size step (neighbour 1 px <= 1 %), 1000..1100 in 1 px steps, two heights
    for (const h of [900, 720]) {
      await step(`card sweep ${h}`, async () => {
        await reachGift({ id: "card", w: 1000, h }, { stopAtPick: true });
        await p.setViewportSize({ width: 1000, height: h }); await sleep(400);
        const rows = [];
        for (let w = 1000; w <= 1100; w += 1) {
          await p.setViewportSize({ width: w, height: h }); await sleep(120);
          const m = await measure();
          if (m.card) rows.push({ w, h, cw: m.card.w, ch: m.card.h, cx: m.card.x, cy: m.card.y });
        }
        must(rows.length >= 95, `[card sweep ${h}] picked card measured at ${rows.length}/101 widths`);
        let worst = 0;
        for (let i = 1; i < rows.length; i += 1) {
          const d = Math.max(Math.abs(rows[i].ch - rows[i - 1].ch) / rows[i - 1].ch, Math.abs(rows[i].cw - rows[i - 1].cw) / rows[i - 1].cw);
          worst = Math.max(worst, d);
          must(d <= 0.01, `[card sweep ${h} ${rows[i - 1].w}->${rows[i].w}] card box step ${R1(rows[i - 1].ch)} -> ${R1(rows[i].ch)} (${R1(d * 100)} %)`);
        }
        console.log(`card sweep height ${h}: ${rows.length} widths, worst neighbour 1 px change ${R1(worst * 100)} %`);
        results.cardSweep.push({ height: h, worstPct: R1(worst * 100), rows });
      });
    }
  } else console.log("sweep skipped (ARASO_SWEEP!=freeze)");
} catch (e) {
  stepErrors.push({ step: "run", error: String((e && e.stack) || e).slice(0, 600) });
  console.log("ERROR", stepErrors[stepErrors.length - 1].error);
} finally {
  must(offsite.length === 0, `network: nothing beyond the local stub (saw ${offsite.slice(0, 5).join(", ")})`);
  writeFileSync(path.join(OUT, "a917-results.json"), JSON.stringify({ errors: H.errors, stepErrors, assertFailures: failures, offsite, txCount, results }, null, 2));
  await H.close?.();
}
console.log(`results written: ${path.join(OUT, "a917-results.json")}  stepErrors=${stepErrors.length} assertFailures=${failures.length}`);
process.exit(stepErrors.length || failures.length ? 1 : 0);
