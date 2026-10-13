// [A-911] Own screens in a real browser: Money tab · Gift a Piggy · Move money (in / out), at 390x844, 810x1080, 1440x900 and 390x844 with 59 / 34 px insets injected.
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

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a911 browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }

const { launch, sleep, REPO } = await import("./helpers/a803-browser.mjs");
const OUT = testOutDir("a911-own-screens-browser", process.argv[2]); // [A-932] pre-A-932 baseline default: receipts/A911_own_screens/browser
mkdirSync(OUT, { recursive: true });
const SIZES = process.env.ARASO_PHONE_AUDIT === "1" ? [{id:"375",w:375,h:667},{id:"390",w:390,h:844},{id:"430",w:430,h:932},{id:"390i",w:390,h:844,top:59,bottom:34}] : [{ id: "390", w: 390, h: 844 }, { id: "810", w: 810, h: 1080 }, { id: "1440", w: 1440, h: 900 }, { id: "390i", w: 390, h: 844, top: 59, bottom: 34 }];
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

// ── per-frame facts + invariants ───────────────────────────────────────────────────────────────────────────────────
const FACTS = ({ w, h, top, bottom }) => {
  const R = (b) => ({ l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) });
  const root = document.querySelector(".a911-screen");
  if (!root) return { screen: null };
  const rr = root.getBoundingClientRect();
  const q = (s) => { const e = root.querySelector(s); return e ? R(e.getBoundingClientRect()) : null; };
  const hitTop = (e) => { const b = e.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !t || root.contains(t); }; // a hit outside the viewport (null) cannot show above the screen
  const texts = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (!n.nodeValue.trim()) continue; const e = n.parentElement; if (e.closest(".a911-card")) continue; /* gift card art text stays the card design */ const cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue; const b = e.getBoundingClientRect(); if (b.width === 0) continue; texts.push({ t: n.nodeValue.trim().slice(0, 40), px: parseFloat(cs.fontSize) }); }
  const inputs = [...root.querySelectorAll("input, textarea")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({ sel: e.dataset.a898Field || e.dataset.a905Field || e.dataset.a911Field || e.id, px: parseFloat(getComputedStyle(e).fontSize) }));
  const list = root.querySelector(".a911-list");
  const act = root.querySelector(".a911-act");
  const hidden = ["#chogHome", "#homeChar", ".homeLiving", "#a905Jar"].map((s) => { const e = document.querySelector(s); if (!e) return { s, covered: true }; const b = e.getBoundingClientRect(); if (!b.width) return { s, covered: true }; return { s, covered: hitTop(e) }; });
  return {
    screen: R(rr), kind: root.dataset.a911, stage: root.dataset.a911Stage, typing: root.dataset.typing === "1",
    bg: getComputedStyle(root).backgroundColor, hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    brand: q(".a911-brand"), back: q(".a911-back"), title: q(".a911-title"), body: q(".a911-body"), paper: q(".a911-paper"), cards: q(".a911-cards"), act: act ? { ...R(act.getBoundingClientRect()), disabled: act.disabled, opacity: getComputedStyle(act).opacity } : null,
    list: list ? { ...R(list.getBoundingClientRect()), scrolls: list.scrollHeight > list.clientHeight + 1, isScroll: list.classList.contains("is-scroll"), scrollbarWidth: getComputedStyle(list).scrollbarWidth, rows: list.children.length } : null,
    minText: texts.length ? Math.min(...texts.map((x) => x.px)) : null, smallText: texts.filter((x) => x.px < 12).slice(0, 5), inputMin: inputs.length ? Math.min(...inputs.map((x) => x.px)) : null,
    chogCovered: hidden, insets: { top: top || 0, bottom: bottom || 0 }, vw: w, vh: h,
  };
};
async function snap(id, size, { act = false, kinds = null } = {}) {
  await p.screenshot({ path: path.join(OUT, `${id}__${size.id}.png`) });
  const f = await p.evaluate(FACTS, size);
  const tag = `[${id} ${size.id}]`;
  must(Boolean(f.screen), `${tag} the own screen is open`);
  if (f.screen) {
    must(f.screen.l === 0 && f.screen.t === 0 && f.screen.w === size.w && f.screen.h === size.h, `${tag} the screen (= its notebook background) is full-bleed ${JSON.stringify(f.screen)}`);
    must(!f.hOverflow, `${tag} no horizontal overflow`);
    must(f.brand && f.brand.t >= (size.top || 0), `${tag} ARASO is below the top inset`);
    must(f.back && f.back.t >= (size.top || 0) && f.back.w >= 44 && f.back.h >= 44, `${tag} back sticker clear of the island and hit >= 44 (${JSON.stringify(f.back)})`);
    must(f.title && f.title.t >= (size.top || 0), `${tag} title is below the top inset`);
    if (f.act) must(f.act.b <= size.h - (size.bottom || 0), `${tag} Send / ok above the bottom inset`);
    must(f.minText === null || f.minText >= 12, `${tag} nothing under 12 px (${JSON.stringify(f.smallText)})`);
    must(f.inputMin === null || f.inputMin >= 16, `${tag} inputs >= 16 px (${f.inputMin})`);
    must(f.chogCovered.every((c) => c.covered), `${tag} no Chog / Piggy / jar above the screen ${JSON.stringify(f.chogCovered.filter((c) => !c.covered))}`);
    if (kinds) must(kinds.includes(f.kind), `${tag} screen kind ${f.kind}`);
    if (act) must(Boolean(f.act), `${tag} Send / ok present`);
  }
  note(id, size, f);
  return f;
}
async function step(name, fn) { try { await fn(); } catch (e) { stepErrors.push({ step: name, error: String((e && e.message) || e).slice(0, 500) }); console.log(`STEP ERROR  ${name}: ${String((e && e.message) || e).slice(0, 200)}`); } }

// ── frames ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function frameTab(id, size, { expectScroll = null } = {}) {
  await fresh(size);
  const m0 = await mark();
  must(await openTab(), `[${id} ${size.id}] the jar opens the Money tab as its own screen`);
  const f = await snap(id, size, { kinds: ["money"] });
  must(!(f.title && (await p.evaluate(() => document.querySelector(".a911-paper .a911-money__total")?.innerText === "unknown"))), `[${id} ${size.id}] "unknown" is never the headline`);
  if (expectScroll !== null && f.list) {
    // pre-A-911 baseline: fixed counts from the design preview (8 at 390i / 10 at 390). The real rows are a different height, so the rule is
    // checked as behaviour (Owner answer 6): the list scrolls ONLY when the paper has grown to the safe body; otherwise it grows to fit.
    // "reached" allows up to one row short: when scrolling, a911FitList cuts the list on a half row ("2.5 + fade"), so the paper ends < 1 row above the body edge
    const reached = f.paper && f.body ? f.paper.h >= f.body.h - 72 : false;
    // auto: scrolling ⇒ the paper reached the safe area; not scrolling ⇒ the whole list is visible (fits, checked by "paper stays inside the safe body" below)
    if (expectScroll === "auto") must(!f.list.scrolls || reached, `[${id} ${size.id}] the list scrolls only once the paper reached the safe area (rows ${f.list.rows}, scrolls ${f.list.scrolls}, paper ${f.paper?.h} / body ${f.body?.h})`);
    else must(f.list.scrolls === expectScroll, `[${id} ${size.id}] ${expectScroll ? "only the Piggy list scrolls (paper reached the safe area)" : "no scroll: the paper grows to fit"} (rows ${f.list.rows}, scrolls ${f.list.scrolls})`);
    must(f.list.scrollbarWidth === "none", `[${id} ${size.id}] scrollbar hidden`);
    if (f.paper && f.body) must(f.paper.b <= f.body.b + 1, `[${id} ${size.id}] the paper stays inside the safe body`);
  }
  await expectZero(`${id} ${size.id}`, m0);
}
async function frameBackAndCloseTab(size) {
  await fresh(size);
  const m0 = await mark();
  await openTab();
  await tapSel(".a911-back", "back sticker");
  must(!(await has(".a911-screen")), `[B0 ${size.id}] the back sticker closes the Money tab`);
  await expectZero(`B0 ${size.id}`, m0);
}
async function frameGift(size, { short = false } = {}) {
  const id = short ? "gift-5-short" : "gift";
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("araso.giftSendDraft.v1.")) localStorage.removeItem(k); }).catch(() => {}); // a saved draft would reopen with a card already picked
  await fresh(size);
  const m0 = await mark();
  await openTab();
  await tapSel("#a905GiftPiggy", "Gift a Piggy");
  must(await waitFor(".a911-cards", 6000), `[gift-1 ${size.id}] Gift opens its own screen`);
  await sleep(600);
  const fan = await snap("gift-1-fan", size, { kinds: ["gift"] });
  must(fan.cards && fan.body && fan.cards.t >= fan.body.t - 1 && fan.cards.b <= fan.body.b + 1, `[gift-1 ${size.id}] the fan is centred inside the safe body, no scroll`);
  await expectZero(`gift-1 ${size.id}`, m0); // first screen: WebAuthn Δ0 · tx Δ0
  // a side card slides to the centre first; the centre card is picked
  await tapSel(".a911-card.is-side", "side card", 0).catch(() => {});
  await tapSel('.a911-card.is-centre [data-a898-act="gift-front"]', "centre card"); await sleep(900);
  must(await has(".a911-card.is-picked"), `[gift-2 ${size.id}] the centre card is picked`);
  await tapSel('[data-a898-act="gift-amount"][data-a898-arg="20"]', "$20").catch(() => {}); await sleep(300);
  await snap("gift-2-front", size, { kinds: ["gift"] });
  await tapSel(".a911-card.is-picked", "flip").catch(() => {}); await sleep(900);
  must(await has(".a911-card.is-flipped"), `[gift-4 ${size.id}] the picked card flips (free flip)`);
  must((await p.locator('[data-a911-field="amount"]').count()) === 0, `[gift-2 ${size.id}] no typed-amount input`);
  await typeInto('[data-a898-field="to"]', "Dana");
  await sleep(500); // the Send fade is 300 ms
  const typing = await snap("gift-k2-letter-typing", size, { kinds: ["gift"] });
  must(typing.typing, `[gift-k2 ${size.id}] typing mode: the card moves up under the header`);
  must(!typing.act || Number(typing.act.opacity) === 0, `[gift-k2 ${size.id}] Send is hidden while typing`);
  await p.evaluate(() => document.activeElement?.blur?.()); await sleep(400);
  const back = await snap("gift-4-back", size, { kinds: ["gift"], act: true });
  note("gift-send-enabled", size, { disabled: back.act ? back.act.disabled : null });
  await tapSel(".a911-back", "back (flip state -> repick)"); await sleep(500);
  await expectZero(`${id} ${size.id}`, m0);
}
async function frameMoveIn(size, multi) {
  const id = multi ? "move-in-2-split" : "move-in-1-rows";
  await fresh(size);
  const m0 = await mark();
  await openTab();
  await tapSel("#a905MoveMoney", "Move money");
  must(await waitFor('.a911-screen[data-a911="move"]', 6000), `[${id} ${size.id}] Move money opens its own screen`);
  await sleep(500);
  const f = await snap(id, size, { kinds: ["move"] });
  must((await p.locator(".a911-sw__opt").count()) === 2, `[${id} ${size.id}] the in / out switch exists once`);
  if (multi) {
    must(!(await p.evaluate(() => /%/.test(document.querySelector(".a911-move")?.innerText || ""))), `[${id} ${size.id}] the A-646 split shows amounts only`);
    await typeInto("#homeAddMoneyTotal", "100");
    const ids = await p.evaluate(() => [...document.querySelectorAll('[id^="homeAddMoneyAmount--"]')].map((e) => e.id));
    must(ids.length >= 2, `[${id} ${size.id}] one amount field per Piggy`);
    const typed = await snap("move-in-2-split-typing", size, { kinds: ["move"] });
    must(typed.typing, `[${id} ${size.id}] typing mode`);
    // pre-A-917 baseline: at >= 1024 ok sat beside the paper (act.l >= paper.r). A-917: one pin at every width (right margin line), the paper stops above it.
    if (size.w >= 1024) must(typed.act && typed.paper && typed.act.b <= size.h - (size.bottom || 0), `[${id} ${size.id}] at 1440 ok is on the bottom-right pin (A-917), above the bottom inset`);
  } else {
    must(Boolean(f.paper), `[${id} ${size.id}] paper present`);
    await expectZero(`${id} ${size.id}`, m0); // first screen: WebAuthn Δ0 · tx Δ0
    const m1 = await mark();
    await tapSel('[data-a898-row="crypto"]', "crypto row"); await sleep(1500);
    await snap("move-in-3-crypto", size, { kinds: ["move"] });
    await expectZero(`move-in-3 ${size.id}`, m1, { proof: true });
    must((await p.locator('[data-a898-act="funding-copy"]').count()) === 1, `[move-in-3 ${size.id}] copy icon beside the address`);
  }
}
async function frameMoveOut(size, kind) {
  await fresh(size);
  const m0 = await mark();
  await openTab();
  await tapSel("#a905MoveMoney", "Move money");
  await waitFor(".a911-sw", 6000);
  await tapSel('[data-a905-act="dir"][data-a905-arg="out"]', "out");
  await sleep(400);
  if (kind === "multi") {
    await snap("move-out-1-pick", size, { kinds: ["move"] });
    await tapSel('.a911-piggy[data-pick="1"]', "pick a Piggy");
  }
  await waitFor("[data-a905-amount-view]", 4000);
  // [A-924 RE-PIN · Owner 06:4x ③] Move out = `all` + typed amount: exactly one amount input (inputmode decimal). pre-A-924 baseline: no typed-amount input (chips only)
  must((await p.locator('input#a924OutAmount[data-a905-field="amount"][inputmode="decimal"]').count()) === 1, `[move-out-2 ${size.id}] one typed-amount input (all + typed)`);
  await snap("move-out-2-amount", size, { kinds: ["move"], act: true });
  await tapSel('[data-a905-act="out-choice"]', "amount chip").catch(() => {}); await sleep(300);
  await tapSel("#a905OutOk", "amount ok");
  await waitFor('[data-a905-field="address"]', 4000);
  must(await p.evaluate(() => document.querySelector('[data-a905-field="address"]')?.tagName === "TEXTAREA"), `[move-out-3 ${size.id}] the address is a textarea (wraps inside the paper)`);
  await typeInto('[data-a905-field="address"]', OUT_ADDR);
  const addr = await snap("move-out-3-address-typing", size, { kinds: ["move"] });
  await p.evaluate(() => document.activeElement?.blur?.()); await sleep(300);
  const send = await snap("move-out-3-address", size, { kinds: ["move"], act: true });
  must(send.act && send.act.disabled, `[move-out-3 ${size.id}] Send is disabled (the live seam is null; nothing is signed or sent)`);
  // pre-A-917 baseline: at >= 1024 Send sat beside the paper on the right. A-917: one pin at every width; the paper (body) ends above the button.
  if (size.w >= 1024 && send.act && send.paper) must(send.paper.b <= send.act.t + 1, `[move-out-3 ${size.id}] at 1440 the paper stops above the Send pin (A-917)`);
  note("move-out-addr-typing", size, { typing: addr.typing });
  await tapSel("#a905OutFaceId", "Send (disabled)").catch(() => {});
  await sleep(400);
  await expectZero(`move-out ${size.id}`, m0);
}
async function frameAway(size, scene) {
  await seedPiggies(1, "10", { away: 1 });
  await fresh(size);
  await p.evaluate((s) => window.__arasoScene?.(s), scene); await H.waitScene([scene], 4000); await sleep(2500);
  const m0 = await mark();
  const jar = await has("#a905Jar");
  must(jar, `[away-${scene} ${size.id}] the jar is on ${scene} (A-905 OPEN closed: the Money tab needs no paper slot)`);
  if (!jar) return;
  await tapSel("#a905Jar", "honey jar (away)");
  must(await waitFor('.a911-screen[data-a911="money"]', 5000), `[away-${scene} ${size.id}] the jar opens the Money screen on ${scene}`);
  await snap(`money-away-${scene}`, size, { kinds: ["money"] });
  await expectZero(`away-${scene} ${size.id}`, m0);
}

// ── run ────────────────────────────────────────────────────────────────────────────────────────────────────────────
try {
  await H.seedSolo("Honeybun");
  await p.evaluate((k) => localStorage.setItem(k, "1"), H.secondKey("araso.secondJourneyClosed")); // Second complete (the gate)
  await seedPiggies(1, "38");
  for (const size of SIZES) {
    await step(`money-1 ${size.id}`, () => frameTab("money-1-piggy", size, { expectScroll: false }));
    await step(`back ${size.id}`, () => frameBackAndCloseTab(size));
    await step(`gift ${size.id}`, () => frameGift(size));
    await step(`move-in ${size.id}`, () => frameMoveIn(size, false));
    await step(`move-out ${size.id}`, () => frameMoveOut(size, "solo"));
  }
  await seedPiggies(1, "10");
  await step("gift-short", async () => { await seedPiggies(1, "5"); await frameGift(SIZES[0], { short: true }); await seedPiggies(1, "38"); });
  for (const sc of ["away", "secondAway"]) for (const size of SIZES.slice(0, 3)) await step(`away-${sc} ${size.id}`, () => frameAway(size, sc));
  // 2 / 4 / 8 Piggies (extra Piggies are local registry rows only)
  // approved frames (one Piggy Away, so one row carries the "still out working." note): 8 Piggies do not scroll at 390 x 844 but do with the 59 / 34 insets; 10 scroll at 390 as well
  // pre-A-911 baseline: [8 → 390i true] [10 → 390 true] from the preview; now 8/10 = "auto" (behaviour rule) and 20 must scroll at every size
  for (const [n, away, scrolls] of [[2, 0, { "390": false, "390i": false }], [4, 1, { "390": false, "390i": false }], [8, 1, { "390": "auto", "390i": "auto" }], [10, 1, { "390": "auto", "390i": "auto" }], [20, 1, { "390": true, "390i": true, "810": "auto", "1440": "auto" }]]) {
    await seedPiggies(n, "20", { away });
    for (const size of SIZES) await step(`money-${n} ${size.id}`, () => frameTab(`money-${n}-piggies`, size, { expectScroll: scrolls[size.id] ?? null }));
  }
  await seedPiggies(2, "20");
  for (const size of SIZES) {
    await step(`move-in-multi ${size.id}`, () => frameMoveIn(size, true));
    await step(`move-out-multi ${size.id}`, () => frameMoveOut(size, "multi"));
  }
  await seedPiggies(1, "38");
} catch (e) {
  stepErrors.push({ step: "run", error: String((e && e.stack) || e).slice(0, 600) });
  console.log("ERROR", stepErrors[stepErrors.length - 1].error);
} finally {
  must(offsite.length === 0, `network: nothing beyond the local stub (saw ${offsite.slice(0, 5).join(", ")})`);
  writeFileSync(path.join(OUT, "frames.json"), JSON.stringify({ errors: H.errors, stepErrors, assertFailures: failures, offsite, txCount, frames }, null, 2));
  await H.close?.();
}
console.log(`frames written: ${path.join(OUT, "frames.json")}  stepErrors=${stepErrors.length} assertFailures=${failures.length}`);
process.exit(stepErrors.length || failures.length ? 1 : 0);
