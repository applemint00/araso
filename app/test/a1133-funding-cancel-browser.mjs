// A-1133: reuse A-898 scaffold, isolated funding-proof cancellation cases.
// pre-A-911 baseline: these frames drove the Funding Paper / Send a Piggy INSIDE the Home paper (#homePaper, [data-a898-root], .a898-*). Since A-911 they live on their own
// full screen (.a911-screen: .a911-cards / .a911-paper / .a911-move / .a911-chip ...). Named re-pin: selectors only (same live data-a898-* actions and ids), the Gift pick is
// the centre-card tap (no auto-flip), the back control is the back sticker (.a911-back). Layout facts for the new screens are measured by a911-own-screens-browser.mjs.
// [A-898] Funding Paper + Send a Piggy: frame capture / DOM facts in a real browser (the coordinator runs this).
//   ARASO_TEST_BROWSER=1 node app/test/a898-funding-gift-browser.mjs [outDir]
// Without ARASO_TEST_BROWSER=1 it prints SKIP and exits 0 (npm test stays node-only).
// Frames (review REVIEW_PRODUCT.md): F1 entry · F2 rows · F3 crypto · F4 crypto proof declined · F5 funding from a shortfall ·
// M1 multi-Piggy Add money · G1 compose, nothing chosen · G2 pick motion · G3 reduced motion · G4 letter typing · G5 short ·
// G6 short + MON (no market) · G7 short + MON with injected market/gas · G8 enough with injected gas/market · G9 Face ID declined · G10 1440.
// Each frame is captured at 390x844 and 1440x900 and writes plain DOM facts (rects, text) to frames.json. This script edits nothing in the app
// and injects nothing: G7/G8 need the live seams (market/gas/executor) which are null in the product, so they are recorded as "needs injected seams".
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { testOutDir } from "./helpers/test-out.mjs"; // [A-932]

if (process.env.ARASO_TEST_BROWSER !== "1") {
  console.log("SKIP  a898-funding-gift-browser: set ARASO_TEST_BROWSER=1 (headless Chrome + local vite port)");
  process.exit(0);
}

const { launch, sleep, REPO } = await import("./helpers/a803-browser.mjs");
const OUT = testOutDir("a898-funding-gift-browser", process.argv[2]); // [A-932] pre-A-932 baseline default: receipts/A898_funding_gift_send/browser
mkdirSync(OUT, { recursive: true });
const SIZES = process.env.ARASO_PHONE_AUDIT === "1" ? [[375, 667], [390, 844], [430, 932]] : [[390, 844], [1440, 900]];
const frames = {};
const note = (id, size, facts) => { (frames[id] ||= {})[`${size[0]}x${size[1]}`] = facts; };

const H = await launch({ forkMode: true }); // [A-950] fork-profile mode (STALE_TESTS class (a)): Second / "Second done" features open only on the fork profile since A-948
const { p } = H;
// real assertions (security R2 N-1): WebAuthn / tx counters. credentials.get/create are wrapped at document start; txs are counted when the RPC stub sees eth_send*.
const failures = [];
const must = (cond, msg) => { if (!cond) { failures.push(msg); console.log(`ASSERT FAIL  ${msg}`); } };
let txCount = 0;
await H.context.addInitScript(`(() => { const w = window.__wa = { create: 0, get: 0 }; const c = navigator.credentials; if (c) { const oc = c.create.bind(c), og = c.get.bind(c); c.create = (o) => { w.create++; return oc(o); }; c.get = (o) => { w.get++; return og(o); }; } })();`);
const waNow = () => p.evaluate(() => ({ ...(window.__wa || { create: 0, get: 0 }) }));
// The launcher aborts every non-local request, so the balance read fails and MY MONEY shows its error card (no Add money entry).
// Stub the JSON-RPC reads (zero native balance, empty eth_call) so the money face renders; transactions are still never sent.
const rpcResult = (m) => (m === "eth_chainId" ? "0x279f" : m === "eth_blockNumber" ? "0x1" : m === "eth_getBalance" ? "0x0" : m === "eth_call" ? `0x${"0".repeat(64)}` : "0x0");
await H.context.route("**/*", async (route) => {
  const req = route.request(); const u = new URL(req.url());
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.fallback();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (req.method() !== "POST") return route.fallback();
  let body; try { body = JSON.parse(req.postData() || "null"); } catch { return route.fallback(); }
  if (/eth_send/.test(JSON.stringify(body))) { txCount += 1; return route.abort(); }
  const one = (r) => ({ jsonrpc: "2.0", id: r?.id ?? 1, result: rpcResult(r?.method) });
  return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
});
const shot = async (id, size) => { await p.screenshot({ path: path.join(OUT, `${id}_${size[0]}.png`) }); };
const text = (sel) => p.evaluate((s) => document.querySelector(s)?.innerText ?? null, sel);
const rect = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; }, sel);
const paperRect = () => rect(".a911-paper, .a911-cards"); // pre-A-911 baseline: rect("#homePaper")
const overflow = () => p.evaluate(() => { const body = document.querySelector(".a911-body")?.getBoundingClientRect(); const box = document.querySelector(".a911-paper, .a911-cards")?.getBoundingClientRect(); return body && box ? { paperBottom: Math.round(body.bottom), contentBottom: Math.round(box.bottom), overflows: box.bottom > body.bottom + 1 } : null; }); // pre-A-911 baseline: #homePaper vs [data-a898-root]

async function toMoney(size) {
  // R3: a saved Gift draft (restored on reopen) made a "fresh" Gift screen open with a card already picked; clear it before every reload
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("araso.giftSendDraft.v1.")) localStorage.removeItem(k); }).catch(() => {});
  await p.setViewportSize({ width: size[0], height: size[1] });
  await p.reload({ waitUntil: "networkidle" }); await sleep(600); await H.unlock();
  await H.waitScene(["sendstay"], 9000); await sleep(4000);
  await H.closeRecords(); await H.openHomePaper(); await sleep(800);
  const mode = await p.evaluate(() => document.querySelector("#homePaper")?.dataset.paperMode ?? null);
  if (mode === "home") { await H.mustTap("#homePaperMoneyToggle", "stamp"); await sleep(1500); }
  for (let i = 0; i < 30; i += 1) { if (!/checking/i.test((await text("#homePaper")) || "")) break; await sleep(500); }
}
// Seed the registry Piggy (the one the index already knows) with home balances. Local storage only; the app reads it as it would any registry row.
async function seedBalances({ usdc, mon = null }) {
  await p.evaluate(({ usdc: u, mon: m, chain }) => {
    const addr = localStorage.getItem("araso.address");
    const key = Object.keys(localStorage).find((k) => /^araso\.myPiggies/.test(k));
    const idx = key ? JSON.parse(localStorage.getItem(key)) : null;
    const row = (idx?.piggies || [])[0] || { id: "solo", name: "Honeybun", address: addr };
    const at = new Date().toISOString();
    const assets = [{ symbol: "USDC", quantity: u, decimals: 6, sourceTimestamp: at }];
    if (m) assets.push({ symbol: "MON", quantity: m, decimals: 18, sourceTimestamp: at });
    localStorage.setItem(`araso.piggyRegistry.${chain}.${addr}`, JSON.stringify({ version: 1, accountId: addr, chainId: chain, piggies: [{ id: row.id, name: row.name, address: row.address || addr, location: "home", assets, valuation: null, createdAt: at, historyKey: `araso.piggyRegistry.history.${row.id}` }] }));
  }, { usdc, mon, chain: H.scope }); // [A-950] registry in the booted chain scope (pre-A-950: const chain = "monad-testnet")
}
const opened = () => p.evaluate(() => !!document.querySelector(".a911-screen")); // pre-A-911 baseline: [data-a898-root]
// [A-905] pre-A-905 baseline: MY MONEY carried `> Add money` (#homeAddMoney) and the Send a Piggy entry was on HOLD, so the harness appended a plain
// #homeSendPiggy button into the MY MONEY card and clicked it. Now the entry is the honey jar: #a905Jar -> Money tab -> `> Move money` (#a905MoveMoney,
// default `in` = the Funding Paper) or `> Gift a Piggy` (#a905GiftPiggy = the Gift paper). Real taps only; no injected button, no app seam.
async function openJar() { await tap("#a905Jar", "honey jar"); await sleep(500); }
async function openFunding() { await openJar(); await tap("#a905MoveMoney", "Move money (in)"); }
async function openGift() { await openJar(); await tap("#a905GiftPiggy", "Gift a Piggy"); }
async function reach(sel, label) {
  // a real user scrolls the Gift/Funding scroll region to reach a control below the fold (scroll-padding keeps it clear of the sticky Face ID foot)
  await p.evaluate((s) => { const el = document.querySelector(s); if (el && el.closest(".a911-paper, .a911-list")) el.scrollIntoView({ block: "nearest" }); }, sel);
  await sleep(150);
  try { await H.mustTap(sel, label || sel); } catch (e) {
    // diagnostic: name what covers / clips the target so a failure is not a bare "not reachable"
    const d = await p.evaluate((s) => { const el = document.querySelector(s); if (!el) return `missing; paperMode=${document.querySelector("#homePaper")?.dataset.paperMode} scene=${document.querySelector("[data-scene]")?.dataset.scene} text=${(document.querySelector("#homePaper")?.innerText || "").replace(/\s+/g, " ").slice(0, 160)}`; const b = el.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); const pa = el.closest(".a898-paper"); const pb = pa && pa.getBoundingClientRect(); const ft = document.querySelector(".a898-foot")?.getBoundingClientRect(); return JSON.stringify({ el: [b.left, b.top, b.width, b.height].map(Math.round), paper: pb && [pb.top, pb.bottom].map(Math.round), scrollTop: pa && pa.scrollTop, scrollH: pa && [pa.scrollHeight, pa.clientHeight], foot: ft && [ft.top, ft.bottom].map(Math.round), vh: innerHeight, at: t && `${t.tagName}#${t.id}.${t.className}` }); }, sel).catch(() => "probe failed");
    throw new Error(`${e.message} | ${d}`);
  }
}
// pre-A-911 baseline: the amount preset was tapped BEFORE the card (in-paper path: gift-amount 50 inside paperMode=money). A-911 Gift screen: the fan shows 3 centred cards; the chips
// ($20 / $50 / $100 only; typing your own = RESIDUAL) exist on the picked card, so the centre card is picked first, then the chip.
async function pickCentre() { await tap('.a911-card.is-centre [data-a898-act="gift-front"]', "centre card"); await sleep(900); }
async function giftChip(n) { await tap(`[data-a898-act="gift-amount"][data-a898-arg="${n}"]`, `$${n}`); }
async function tap(sel, label) { await reach(sel, label); await sleep(700); }

try {
  await H.seedSolo("Honeybun");
  await p.evaluate(k=>localStorage.setItem(k,"1"),H.secondKey("araso.secondJourneyClosed"));
  for(const S of SIZES){
    await seedBalances({usdc:"38"});await toMoney(S);await openFunding();
    await p.evaluate(()=>{const real=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=async()=>{navigator.credentials.get=real;throw new DOMException("Audit cancellation","NotAllowedError")}});
    await tap('[data-a898-row="crypto"]');await sleep(1000);
    const t=await text('.a911-screen');must(/nothing moved/i.test(t||''),'cancel shows nothing moved '+S[0]);
    must(txCount===0,'cancel sends no transaction');note('cancel',S,{text:t,txCount});await shot('cancel',S);
  }
} catch(e){failures.push(String(e.stack||e));}finally{
 writeFileSync(path.join(OUT,'frames.json'),JSON.stringify({errors:H.errors,assertFailures:failures,frames},null,2));await H.close();
}
console.log(JSON.stringify({failures,errors:H.errors}));process.exit(failures.length?1:0);
