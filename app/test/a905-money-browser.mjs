// pre-A-911 baseline: these frames drove the Money tab / Move money / Gift inside the Home paper (.a905-money*, .a905-switch*, #a905Back, .homePaper__addMoney, #homePaper).
// Since A-911 the same surfaces are one full-screen host (.a911-screen). Named re-pin, selectors and flow only: .a905-money__row -> .a911-row, .a905-money__piggy -> .a911-piggy,
// .a905-switch__opt -> .a911-sw__opt, #a905Back -> .a911-back (the back sticker), the out address step now ends at `Send` (no address `ok`, no separate confirm page),
// the Gift payer is the `from <Piggy>` word (.a911-payBtn) instead of a pay-step list, and the jar bump is checked behind the screen (the jar is covered by it).
// The text inputs are no longer in the TAP set (they are underline fields; the 44 px rule is for the buttons). Layout facts: a911-own-screens-browser.mjs.
// [A-905] Browser frames: honey jar on Home + Money tab + Move money (in/out) + Gift a Piggy, at 390x844, 810x1080 and 1440x900.
//   ARASO_TEST_BROWSER=1 node app/test/a905-money-browser.mjs [outDir]
// Skipped unless ARASO_TEST_BROWSER=1 (headless Chrome + a local vite port; npm test stays node-only).
// Output (default $ARASO_PRIVATE_BASE/ops/receipts/A905_money_tab_jar/browser/): <frame>_<width>.png screenshots + frames.json (rects, elementFromPoint, text,
// tap sizes, counters). This script edits nothing in the app. The only seam it adds is test-side: the vite response of /src/funding-paper.js is
// rewritten in flight so FUNDING_PAPER_CONFIG.arrivalReader reads `window.__a905Reader` (null until the bump step sets it), which lets ONE confirmed
// deposit arrive for the arrival-bump clip. Nothing is sent: eth_send* is counted and aborted; every non-local request is answered by a local stub.
// Frames: J1 jar (1 Piggy) · J2 jar (2 Piggies) · J3 jar + Money tab with every Piggy Away (away / secondAway) · J4 no jar before Second · J5 jar pressed ·
// B1 arrival bump clip (+ B2 reduced motion) · T1 / T2 Money tab (1 / 2 Piggies) · I1 in (1 Piggy) · I2 / I3 in (2 Piggies: allocation, plan rows) ·
// O1..O5 out (picker skipped / shown, Away row not pickable, amount, address, confirm) · G1 / G2 Gift pay step (1 / 2+ payers) · TAP measured sizes.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { testOutDir } from "./helpers/test-out.mjs"; // [A-932]

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a905 browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }

// Kept from the stub: the elementFromPoint contract probe (the jar centre must be the jar).
export const JAR_CENTRE_PROBE = `(() => { const jar = document.querySelector("#a905Jar"); if (!jar) return null; const b = jar.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { jarCentreHit: Boolean(t && (t === jar || jar.contains(t))), w: b.width, h: b.height }; })()`;

const { launch, sleep, REPO } = await import("./helpers/a803-browser.mjs");
const OUT = testOutDir("a905-money-browser", process.argv[2]); // [A-932] pre-A-932 baseline default: receipts/A905_money_tab_jar/browser
mkdirSync(OUT, { recursive: true });
const SIZES = [[390, 844], [810, 1080], [1440, 900]];
const MIN_TAP = 44;
const OUT_ADDR = "0x1111111111111111111111111111111111111111";

const frames = {};
const stepErrors = [];
const failures = [];
const offsite = [];
const tapRows = []; // { frame, size, kind, sel, w, h }
const note = (id, size, facts) => { (frames[id] ||= {})[`${size[0]}x${size[1]}`] = facts; };
const must = (cond, msg) => { if (!cond) { failures.push(msg); console.log(`ASSERT FAIL  ${msg}`); } };

const H = await launch({ forkMode: true }); // [A-950] fork-profile mode (STALE_TESTS class (a)): Second / "Second done" features open only on the fork profile since A-948
const { p } = H;

// ── counters: WebAuthn (wrapped at document start) and tx (eth_send* seen by the RPC stub) ──────────────────────────
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
  return { get: dGet, create: dCreate, tx: dTx };
}

// ── network: only local pages + a local JSON-RPC stub. Anything else is recorded and aborted. ───────────────────────
const rpcResult = (m) => (m === "eth_chainId" ? "0x279f" : m === "eth_blockNumber" ? "0x1" : m === "eth_getBalance" ? "0x0" : m === "eth_call" ? `0x${"0".repeat(64)}` : "0x0");
await H.context.route("**/*", async (route) => {
  const req = route.request(); const u = new URL(req.url());
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
    // test-side seam: the arrival reader of the Funding Paper is read from window.__a905Reader (null until set)
    if (/\/src\/funding-paper\.js(\?|$)/.test(u.pathname + u.search)) {
      try {
        const res = await route.fetch(); const body = await res.text();
        const rewritten = body.replace(/Object\.freeze\(\{\s*arrivalReader:\s*null\s*\}\)/, "Object.freeze({ get arrivalReader() { return (typeof window !== 'undefined' && window.__a905Reader) || null; } })");
        return route.fulfill({ response: res, body: rewritten });
      } catch { return route.fallback(); }
    }
    return route.fallback();
  }
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (req.method() !== "POST") { offsite.push(`${req.method()} ${u.hostname}`); return route.abort(); }
  let body; try { body = JSON.parse(req.postData() || "null"); } catch { offsite.push(`POST(non-json) ${u.hostname}`); return route.abort(); }
  if (/eth_send/.test(JSON.stringify(body))) { txCount += 1; return route.abort(); }
  const one = (r) => ({ jsonrpc: "2.0", id: r?.id ?? 1, result: rpcResult(r?.method) });
  return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
});

// ── small helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
const text = (sel) => p.evaluate((s) => document.querySelector(s)?.innerText ?? null, sel);
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
const addr = () => p.evaluate(() => localStorage.getItem("araso.address"));
const regKey = async () => `araso.piggyRegistry.${H.scope}.${await addr()}`;
/** Patch the persisted registry: fn(piggies) -> piggies. Local storage only, the app reads it as it reads any registry. */
async function patchRegistry(spec, { seedIfEmpty = true } = {}) {
  // spec = { usdc, mode: "home" | "away" | "lastAway" } is plain data, passed into the page as an argument (no closures cross into evaluate)
  const key = await regKey();
  return p.evaluate(({ key, spec, seedIfEmpty }) => {
    const at = new Date().toISOString();
    const a = localStorage.getItem("araso.address");
    let rec = null; try { rec = JSON.parse(localStorage.getItem(key) || "null"); } catch { rec = null; }
    let piggies = rec?.piggies || [];
    if (!piggies.length && seedIfEmpty) {
      const idxKey = Object.keys(localStorage).find((k) => /^araso\.myPiggies/.test(k));
      const idx = idxKey ? JSON.parse(localStorage.getItem(idxKey)) : null;
      piggies = (idx?.piggies || [{ id: "solo", name: "Honeybun", address: a }]).map((r) => ({ id: r.id, name: r.name, address: r.address || a, location: "home", assets: [], valuation: null, createdAt: at, historyKey: `araso.piggyRegistry.history.${r.id}` }));
    }
    const next = piggies.map((x, i) => ({ ...x, location: spec.mode === "away" ? "away" : spec.mode === "lastAway" && i === piggies.length - 1 ? "away" : "home", assets: [{ symbol: "USDC", quantity: spec.usdc, decimals: 6, sourceTimestamp: at }] }));
    localStorage.setItem(key, JSON.stringify({ version: 1, accountId: a, chainId: key.split(".")[2] /* [A-950] the scope in regKey() (pre-A-950: "monad-testnet") */, piggies: next }));
    return next.map((x) => ({ id: x.id, name: x.name, location: x.location, address: x.address }));
  }, { key, spec, seedIfEmpty });
}
const homeAll = (usdc = "38") => patchRegistry({ usdc, mode: "home" });
const awayAll = () => patchRegistry({ usdc: "10", mode: "away" });
const oneAway = () => patchRegistry({ usdc: "20", mode: "lastAway" });

async function fresh(size) {
  await p.setViewportSize({ width: size[0], height: size[1] });
  await H.atWidth(size[0], size[1]);
  await H.closeRecords();
  await sleep(500);
}
/** a registry/flag change needs a reload to be read: set it first (any size), then fresh(). */
async function openTab() {
  await tapSel("#a905Jar", "honey jar");
  const ok = await waitFor('.a911-screen[data-a911="money"]', 6000); // pre-A-911 baseline: ".a905-money"
  await sleep(500);
  return ok;
}
async function waitMoneyRead() { for (let i = 0; i < 24; i += 1) { if (!/checking/i.test((await text(".a911-screen")) || "")) return; await sleep(500); } }

// ── per-frame facts ────────────────────────────────────────────────────────────────────────────────────────────────
const TAP_SETS = [
  ["jar", "#a905Jar"],
  ["row", ".a911-row"],
  ["switch", ".a911-sw__opt"],
  ["picker", '.a911-piggy[data-pick="1"]'],
  ["ok", "#a905OutOk"],
  ["back", ".a911-back"],
  ["faceid", "#a905OutFaceId"],
];
const FACTS_FN = ({ sels, tapSets }) => {
  const R = (b) => ({ l: Math.round(b.left * 10) / 10, t: Math.round(b.top * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 });
  const desc = (e) => (e ? `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${e.className && typeof e.className === "string" ? `.${e.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}` : null);
  const visible = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const hit = (e) => { const b = e.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { at: desc(t), isSelf: Boolean(t && (t === e || e.contains(t))) }; };
  const out = { viewport: [innerWidth, innerHeight], scene: document.querySelector("[data-scene]")?.dataset.scene ?? null };
  const paper = document.querySelector(".a911-screen"); if (paper) { out.paper = { rect: R(paper.getBoundingClientRect()), mode: paper.dataset.a911 ?? null, text: (paper.innerText || "").replace(/\s+/g, " ").trim().slice(0, 700) }; }
  const jar = document.querySelector("#a905Jar");
  if (jar) {
    const b = jar.getBoundingClientRect();
    const pts = [[.5, .5], [.3, .5], [.7, .5], [.5, .3], [.5, .7]].map(([fx, fy]) => [b.left + b.width * fx, b.top + b.height * fy]);
    const piggyOf = (e) => e.closest?.(".homeLiving, #homeSeat");
    const stacks = pts.map(([x, y]) => document.elementsFromPoint(x, y));
    const idx = stacks.map((st) => { const j = st.findIndex((e) => e === jar || jar.contains(e)); const pg = st.findIndex((e) => piggyOf(e)); return { jar: j, piggy: pg }; });
    const seat = document.querySelector('.homeLiving[data-seat="1"]') || document.querySelector("#homeSeat");
    const layer = jar.closest(".a905-jarLayer");
    const z = (e) => { let n = e; while (n && n !== document.body) { const zi = getComputedStyle(n).zIndex; if (zi !== "auto") return Number(zi); n = n.parentElement; } return 0; };
    const seatLayer = seat?.closest(".homeLivingLayer") || seat;
    const orderAfter = seatLayer && layer ? Boolean(seatLayer.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
    const cs = getComputedStyle(jar);
    out.jar = {
      rect: R(b), centreHit: hit(jar), stackIdx: idx, z: layer ? z(layer) : null, seatZ: seatLayer ? z(seatLayer) : null, jarLayerAfterSeatInDom: orderAfter,
      seat: seat ? R(seat.getBoundingClientRect()) : null, overlapsSeat: seat ? (() => { const s = seat.getBoundingClientRect(); return b.left < s.right && b.right > s.left && b.top < s.bottom && b.bottom > s.top; })() : null,
      transform: cs.transform, bump: jar.getAttribute("data-bump"), pointerEvents: cs.pointerEvents,
    };
    const inFront = idx.every((r) => r.jar >= 0 && (r.piggy < 0 || r.jar < r.piggy));
    const zFront = out.jar.seatZ === null ? null : (out.jar.z > out.jar.seatZ || (out.jar.z === out.jar.seatZ && orderAfter === true));
    out.jar.inFrontOfPiggy = inFront && (zFront === null ? true : zFront);
    out.jar.inFrontByStack = inFront; out.jar.inFrontByZ = zFront;
    out.jar.livingNodes = [...document.querySelectorAll(".homeLiving")].map((e) => ({ seat: e.dataset.seat === "1", rect: R(e.getBoundingClientRect()) }));
  }
  out.sels = {};
  for (const s of sels) { out.sels[s] = [...document.querySelectorAll(s)].filter(visible).slice(0, 12).map((e) => ({ rect: R(e.getBoundingClientRect()), text: (e.innerText || e.value || "").replace(/\s+/g, " ").trim().slice(0, 120), disabled: Boolean(e.disabled) || e.getAttribute("aria-disabled") === "true", pressed: e.getAttribute("aria-pressed"), current: e.getAttribute("aria-current"), hit: hit(e) })); }
  out.tap = [];
  for (const [kind, sel] of tapSets) for (const e of document.querySelectorAll(sel)) { if (!visible(e)) continue; const b = e.getBoundingClientRect(); out.tap.push({ kind, sel, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, text: (e.innerText || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 40) }); }
  return out;
};
async function snap(id, size, { sels = [], jar = false, expect = null } = {}) {
  await p.screenshot({ path: path.join(OUT, `${id}_${size[0]}.png`) });
  const f = await p.evaluate(FACTS_FN, { sels, tapSets: TAP_SETS });
  for (const t of f.tap) tapRows.push({ frame: id, size: `${size[0]}x${size[1]}`, ...t });
  if (jar) {
    must(Boolean(f.jar), `[${id} ${size[0]}] the jar is present`);
    if (f.jar) {
      must(f.jar.centreHit.isSelf, `[${id} ${size[0]}] elementFromPoint at the jar centre must be the jar (got ${f.jar.centreHit.at})`);
      must(f.jar.inFrontOfPiggy, `[${id} ${size[0]}] the jar must be in front of the Piggy (stack ${JSON.stringify(f.jar.stackIdx)} z ${f.jar.z}/${f.jar.seatZ})`);
    }
  }
  if (expect) expect(f);
  note(id, size, f);
  return f;
}
async function step(name, fn) { try { await fn(); } catch (e) { stepErrors.push({ step: name, error: String((e && e.message) || e).slice(0, 500) }); console.log(`STEP ERROR  ${name}: ${String((e && e.message) || e).slice(0, 200)}`); } }
const waCheckpoint = async (label, m0, opts) => { const d = await expectZero(label, m0, opts); return d; };

// ── frames ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const MONEY_SELS = [".a911-money__total", ".a911-money__assets", ".a911-row", ".a911-piggy", ".a911-piggy__note"]; // pre-A-911 baseline: .a905-money__*

async function framesJar(prefix, size) { // jar on Home, pressed
  await fresh(size);
  const m0 = await mark();
  await snap(prefix, size, { jar: true });
  note(`${prefix}-probe`, size, await p.evaluate(JAR_CENTRE_PROBE));
  await waCheckpoint(`${prefix} ${size[0]}`, m0);
}
async function framePressed(size) {
  await fresh(size);
  const m0 = await mark();
  const b = await p.evaluate(() => { const r = document.querySelector("#a905Jar")?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; });
  must(Boolean(b), `[J5 ${size[0]}] jar present for the press`);
  if (!b) return;
  await p.mouse.move(b.x, b.y); await p.mouse.down(); await sleep(250);
  const f = await snap("J5", size, { jar: true });
  await p.mouse.move(Math.max(2, b.x - 140), Math.max(2, b.y - 140)); await p.mouse.up(); await sleep(300); // release away from the jar: no tap
  note("J5-after", size, { stillHome: !(await has(".a911-screen")), pressedTransform: f.jar?.transform ?? null });
  await waCheckpoint(`J5 ${size[0]}`, m0);
}
async function frameNoJar(size) {
  await p.evaluate((k) => localStorage.removeItem(k), H.secondKey("araso.secondJourneyClosed"));
  await fresh(size);
  const m0 = await mark();
  const f = await snap("J4", size, {});
  must(!f.jar, `[J4 ${size[0]}] no jar before Second`);
  note("J4-flags", size, { jarCount: await p.locator("#a905Jar").count(), addMoneyCount: await p.locator("#homeAddMoney").count() });
  await waCheckpoint(`J4 ${size[0]}`, m0);
  await p.evaluate((k) => localStorage.setItem(k, "1"), H.secondKey("araso.secondJourneyClosed"));
}
async function frameAway(size) {
  await awayAll();
  for (const sc of ["away", "secondAway"]) { // pre-A-911 baseline: ["away"] (secondAway had no jar: the Money tab needed the paper slot). A-911: the tab is its own screen, so the jar is on secondAway too
    await fresh(size);
    await p.evaluate((s) => window.__arasoScene?.(s), sc); await H.waitScene([sc], 4000); await sleep(2500);
    const m0 = await mark();
    const f = await snap(`J3-${sc}`, size, { jar: true });
    must(Boolean(f.jar), `[J3-${sc} ${size[0]}] the jar stays while every Piggy is Away`);
    await tapSel("#a905Jar", "honey jar (away)");
    const open = await waitFor('.a911-screen[data-a911="money"]', 5000); await sleep(500);
    must(open, `[J3-${sc} ${size[0]}] the jar opens the Money tab while Away`);
    const t = await snap(`J3-${sc}-tab`, size, {
      sels: MONEY_SELS,
      expect: (ff) => {
        const rows = ff.sels[".a911-row"] || [];
        const move = rows.find((r) => /Move money/.test(r.text)), gift = rows.find((r) => /Gift a Piggy/.test(r.text));
        must(move && !move.disabled, `[J3-${sc} ${size[0]}] Move money enabled while every Piggy is Away`);
        must(gift && gift.disabled && /still out working\./.test(gift.text), `[J3-${sc} ${size[0]}] Gift a Piggy disabled with "still out working." (got ${gift ? gift.text : "missing"})`);
      },
    });
    note(`J3-${sc}-ok`, size, { tabOpened: open, paperText: t.paper?.text ?? null });
    await waCheckpoint(`J3-${sc} ${size[0]}`, m0);
  }
}
async function frameTab(id, size, extra = {}) {
  await fresh(size);
  const m0 = await mark();
  must(await openTab(), `[${id} ${size[0]}] Money tab opened by the jar`);
  await waitMoneyRead();
  await snap(id, size, { sels: MONEY_SELS, jar: false, ...extra });
  await waCheckpoint(`${id} ${size[0]}`, m0);
}
async function frameInSolo(size) {
  await fresh(size);
  const m0 = await mark();
  await openTab(); await waitMoneyRead();
  await tapSel("#a905MoveMoney", "Move money");
  const open = await waitFor('.a911-screen[data-a911="move"]', 6000); await sleep(500);
  must(open, `[I1 ${size[0]}] 1 Piggy: Move money (in) goes straight to the Funding Paper`);
  await snap("I1", size, { sels: [".a911-sw__opt", "[data-a898-row]", ".a911-back"] });
  await waCheckpoint(`I1 ${size[0]}`, m0);
}
async function frameInMulti(size) {
  await fresh(size);
  const m0 = await mark();
  await openTab(); await waitMoneyRead();
  await tapSel("#a905MoveMoney", "Move money");
  await waitFor(".a911-move", 6000); await sleep(400);
  const kind = await p.evaluate(() => (document.querySelector(".a911-move")?.dataset.a905Step === "split" ? "allocation" : document.querySelector(".a911-move")?.dataset.a905Step ?? null));
  must(kind === "allocation", `[I2 ${size[0]}] 2 Piggies: Move money (in) opens the allocation first (got ${kind})`);
  await snap("I2", size, { sels: [".a911-sw__opt", "[data-add-money-row]", ".a911-move input", "#homeAddMoneyOk", ".a911-back"] });
  must(!(await p.evaluate(() => /%/.test(document.querySelector(".a911-move")?.innerText || ""))), `[I2 ${size[0]}] the A-646 split shows amounts only (no %)`);
  await typeInto("#homeAddMoneyTotal", "100");
  const amounts = await p.evaluate(() => [...document.querySelectorAll('[id^="homeAddMoneyAmount--"]')].map((e) => e.id));
  must(amounts.length >= 2, `[I2 ${size[0]}] one amount field per Piggy (got ${amounts.length})`);
  if (amounts.length >= 2) { await typeInto(`[id="${amounts[0]}"]`, "60"); await typeInto(`[id="${amounts[1]}"]`, "40"); }
  await p.evaluate(() => document.activeElement?.blur?.()); await sleep(500); // pre-A-911 baseline: ok was always visible. A-911: ok is hidden while typing (Owner frame F), so finish typing first
  await tapSel("#homeAddMoneyOk", "allocation ok");
  await waitFor('[data-a905-act="plan-fund"]', 6000); await sleep(400);
  const legs = await p.evaluate(() => [...document.querySelectorAll("[data-add-money-leg]")].map((r) => r.innerText.replace(/\s+/g, " ").trim()));
  // pre-A-911 baseline: three plan-fund buttons. A-911: card + bank are always dim ("Not ready yet", aria-disabled, not plan-fund), crypto is the one enabled plan-fund row; the three rows are [data-a898-row].
  const fundRows = await p.evaluate(() => [...document.querySelectorAll("[data-a898-row]")].map((b) => `${(b.querySelector("span")?.textContent || b.textContent).replace(/^[>\s]+/, "").trim()}${b.dataset.a905Act === "plan-fund" ? "" : " (dim)"}`));
  must(legs.length === 2, `[I3 ${size[0]}] plan shows a row per leg (got ${legs.length})`);
  must(fundRows.length === 3, `[I3 ${size[0]}] plan offers the three Funding rows (got ${fundRows.join(" | ")})`);
  // [A-924 RE-PIN · A-920 item 5 / Owner 06:4x ②] mock order crypto first. pre-A-924 baseline: card (dim) · bank (dim) · crypto
  must(fundRows[0] === "Pay with crypto" && fundRows[1] === "Pay with card (dim)" && fundRows[2] === "Bank transfer (dim)", `[I3 ${size[0]}] crypto enabled first, card + bank dim (got ${fundRows.join(" | ")})`);
  await snap("I3", size, { sels: ["[data-add-money-leg]", '[data-a905-act="plan-fund"]'] });
  note("I3-legs", size, { legs, fundRows });
  await waCheckpoint(`I2/I3 ${size[0]}`, m0);
}
/** out flow. kind: "solo" (picker skipped) | "multi" (picker shown) | "away" (2 Piggies, one Away: visible, not pickable). */
async function frameOut(kind, size) {
  await fresh(size);
  const m0 = await mark();
  await openTab(); await waitMoneyRead();
  await tapSel("#a905MoveMoney", "Move money");
  await waitFor(".a911-sw", 6000);
  await tapSel('[data-a905-act="dir"][data-a905-arg="out"]', "switch out");
  await sleep(400);
  const pre = kind === "solo" ? "O1" : kind === "multi" ? "O2" : "O3";
  const stage = () => p.evaluate(() => document.querySelector('.a911-move[data-a905-dir="out"]')?.dataset.a905Step ?? null); // pre-A-911 baseline: [data-a905-view="out"] data-a905-stage
  if (kind === "solo") {
    must((await stage()) === "amount", `[O1 ${size[0]}] 1 selectable Piggy: the picker is skipped (stage ${await stage()})`);
    await snap("O1", size, { sels: [".a911-sw__opt", ".a911-piggy", "[data-a905-field]", "#a905OutOk", ".a911-back"] });
  } else {
    must((await stage()) === "pick", `[${pre} ${size[0]}] the Piggy picker is shown (stage ${await stage()})`);
    await snap(pre, size, {
      sels: [".a911-piggy", '.a911-piggy[data-pick="1"]', '.a911-piggy[data-pick="0"]', ".a911-back"],
      expect: kind === "away" ? (f) => {
        const away = (f.sels[".a911-piggy"] || []).filter((r) => /still out working\./.test(r.text));
        must(away.length >= 1, `[O3 ${size[0]}] an Away row is visible with "still out working."`);
        must(away.every((r) => r.disabled), `[O3 ${size[0]}] the Away row is not pickable (aria-disabled)`);
        must((f.sels['.a911-piggy[data-pick="1"]'] || []).every((r) => !/still out working\./.test(r.text)), `[O3 ${size[0]}] no pickable row is Away`);
      } : null,
    });
    if (kind === "away") { await waCheckpoint(`O3 ${size[0]}`, m0); return; }
    await tapSel('.a911-piggy[data-pick="1"]', "pick a Piggy");
  }
  await waitFor("[data-a905-amount-view]", 4000); // pre-A-911 baseline: a typed amount field; now chips only (typing your own = follow-up card)
  await tapSel('[data-a905-act="out-choice"]', "amount chip");
  await snap("O4", size, { sels: ["[data-a905-amount-view]", "#a905OutOk", ".a911-back", "[data-a905-arg]"] });
  await tapSel("#a905OutOk", "amount ok");
  await waitFor('[data-a905-field="address"]', 4000);
  await typeInto('[data-a905-field="address"]', OUT_ADDR);
  const addrIsTextarea = await p.evaluate(() => document.querySelector('[data-a905-field="address"]')?.tagName === "TEXTAREA");
  must(addrIsTextarea, `[${pre} ${size[0]}] the out address is a textarea (wraps inside the paper)`);
  await snap("O5", size, {
    sels: ['[data-a905-field="address"]', "#a905OutFaceId", ".a911-back", ".a911-paper"],
    expect: (f) => { const fb = (f.sels["#a905OutFaceId"] || [])[0]; must(fb && fb.disabled, `[O5 ${size[0]}] Send is disabled (live seam null)`); if (size[0] >= 1024) { const pr = (f.sels[".a911-paper"] || [])[0]; /* pre-A-917 baseline: fb.rect.l >= paper right (beside the paper) */ must(fb && pr && pr.rect.t + pr.rect.h <= fb.rect.t + 1, `[O5 ${size[0]}] at 1440 the paper stops above the Send pin (A-917)`); } },
  });
  // pre-A-911 baseline: the address step had its own `ok` and a separate confirm page (O6) with "> Confirm with Face ID". Now `Send` is on the address step itself.
  await tapSel("#a905OutFaceId", "Send (disabled)").catch(() => {}); // a real tap on a disabled button must do nothing
  await sleep(500);
  await waCheckpoint(`${pre}..O5 ${size[0]}`, m0);
}
async function frameGift(id, size) {
  // A-911 re-pin: a saved Gift draft (araso.giftSendDraft.v1.*) from the previous size reopens with a card already picked (no .is-centre fan); clear it before each size.
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("araso.giftSendDraft.v1.")) localStorage.removeItem(k); }).catch(() => {});
  // pre-A-911 baseline: the pay step ([data-a905-view="gift-pay"]) listed the paying Piggies below the card. Now the payer is the `from <Piggy>` word; with 2+ Piggies it is a button (.a911-payBtn) that switches the payer.
  await fresh(size);
  const m0 = await mark();
  await openTab(); await waitMoneyRead();
  await tapSel("#a905GiftPiggy", "Gift a Piggy");
  await waitFor(".a911-cards", 6000); await sleep(600);
  await tapSel('.a911-card.is-centre [data-a898-act="gift-front"]', "centre card"); await sleep(900); // the centre card is picked
  await tapSel('[data-a898-act="gift-amount"][data-a898-arg="20"]', "gift amount").catch(() => {}); await sleep(300);
  const sels = [".a911-pay", ".a911-payBtn", ".a911-card.is-picked", '[data-a898-act="gift-faceid"]'];
  const f = await snap(id, size, { sels });
  const payers = (f.sels[".a911-payBtn"] || []).length;
  note(`${id}-payers`, size, { payerButtons: payers });
  if (id === "G1") must(payers === 0, `[G1 ${size[0]}] 1 payer: no payer switch (got ${payers})`);
  if (id === "G2") must(payers >= 1, `[G2 ${size[0]}] 2+ payers: the from word switches the payer (got ${payers})`);
  if (id === "G2" && payers >= 1) { await H.mustTap(".a911-payBtn", "switch payer").catch(() => {}); await sleep(700); await snap("G2-switched", size, { sels }); }
  await waCheckpoint(`${id} ${size[0]}`, m0);
}
/** arrival bump: seed ONE confirmed deposit through the test-side reader, then a frame every 80 ms for 1.2 s. */
async function frameBump(size, reduced) {
  const id = reduced ? "B2" : "B1";
  await p.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await fresh(size);
  const m0 = await mark();
  await openTab(); await waitMoneyRead();
  await tapSel("#a905MoveMoney", "Move money");
  await waitFor('[data-a898-row="crypto"]', 6000);
  await tapSel('[data-a898-row="crypto"]', "crypto row"); await sleep(1500);
  const proof = await expectZero(`${id} ${size[0]} crypto-row proof`, m0, { proof: true });
  note(`${id}-proof`, size, proof);
  const m1 = await mark();
  await p.evaluate(() => { window.__a905Reader = async ({ piggy, asset, chainId }) => ({ status: "confirmed", chain: chainId, asset, target: piggy.address, amount: "1", txHash: `0xa905${"0".repeat(59)}1` }); });
  const jarRect = await p.evaluate(() => { const r = document.querySelector("#a905Jar")?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; });
  must(Boolean(jarRect), `[${id} ${size[0]}] jar present for the bump`);
  const pad = 48;
  const clip = jarRect ? { x: Math.max(0, jarRect.x - pad), y: Math.max(0, jarRect.y - pad), width: Math.min(size[0], jarRect.w + 2 * pad), height: Math.min(size[1], jarRect.h + 2 * pad) } : undefined;
  // trigger exactly like the funding-check tap (a898Act is delegated on [data-a898-act]); the reader is the only seam
  await p.evaluate(() => { const root = document.querySelector(".a911-screen") || document.body; const b = document.createElement("button"); b.setAttribute("data-a898-act", "funding-check"); b.hidden = true; root.appendChild(b); b.click(); b.remove(); });
  const samples = [];
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < 1200 + 80; i += 1) {
    const t = Date.now() - t0;
    const s = await p.evaluate(() => {
      const j = document.querySelector("#a905Jar"); if (!j) return { jar: false };
      const q = (c) => { const e = j.querySelector(c); if (!e) return null; const cs = getComputedStyle(e); return { opacity: cs.opacity, transform: cs.transform, animation: cs.animationName }; };
      const b = j.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { jar: true, bump: j.getAttribute("data-bump"), drop: q(".a905-jar__drop"), honey: q(".a905-jar__honey"), img: q(".a905-jar__img"), jarUncovered: Boolean(top && (top === j || j.contains(top))) };
    });
    samples.push({ i, tMs: t, ...s });
    if (clip && i < 16) await p.screenshot({ path: path.join(OUT, `${id}_${size[0]}_${String(i).padStart(2, "0")}.png`), clip });
    const spent = Date.now() - t0 - t;
    if (spent < 80) await sleep(80 - spent);
  }
  const bumped = samples.some((s) => s.bump === "1");
  if (reduced) must(!bumped, `[${id} ${size[0]}] reduced motion: the jar must not animate (data-bump never set)`);
  else must(bumped, `[${id} ${size[0]}] a confirmed deposit bumps the jar (data-bump seen)`);
  note(id, size, { reduced, bumped, covered: samples.filter((s) => s.jar && s.jarUncovered === false).length, samples });
  await p.screenshot({ path: path.join(OUT, `${id}_${size[0]}_after.png`) });
  const d = await expectZero(`${id} ${size[0]} deposit arrival`, m1);
  note(`${id}-delta`, size, d);
  await p.evaluate(() => { window.__a905Reader = null; });
}

// ── run ────────────────────────────────────────────────────────────────────────────────────────────────────────────
try {
  await H.seedSolo("Honeybun");

  // before Second: no jar
  for (const size of SIZES) await step(`J4 ${size[0]}`, () => frameNoJar(size));
  await p.evaluate((k) => localStorage.setItem(k, "1"), H.secondKey("araso.secondJourneyClosed")); // Second complete (the gate)

  // one Piggy at home, USDC held
  await homeAll("38");
  for (const size of SIZES) {
    await step(`J1 ${size[0]}`, () => framesJar("J1", size));
    await step(`J5 ${size[0]}`, () => framePressed(size));
    await step(`T1 ${size[0]}`, () => frameTab("T1", size));
    await step(`I1 ${size[0]}`, () => frameInSolo(size));
    await step(`O1 ${size[0]}`, () => frameOut("solo", size));
    await step(`G1 ${size[0]}`, () => frameGift("G1", size));
  }
  for (const size of SIZES) {
    await step(`B1 ${size[0]}`, () => frameBump(size, false));
    await step(`B2 ${size[0]}`, () => frameBump(size, true));
  }
  await p.emulateMedia({ reducedMotion: "no-preference" });

  // every Piggy Away (1 Piggy) -> jar + Money tab
  for (const size of SIZES) await step(`J3 ${size[0]}`, () => frameAway(size));
  await homeAll("38");

  // two Piggies (real second Piggy through the Second path; needs the "Second not yet closed" state to arm the quiet-Home cue)
  await step("seedMulti", async () => {
    await p.evaluate(([c, s]) => { localStorage.removeItem(c); localStorage.removeItem(s); }, [H.secondKey("araso.secondJourneyClosed"), H.secondKey("araso.secondIntroSeen")]);
    await H.seedMulti("Mochi");
    await p.evaluate((k) => localStorage.setItem(k, "1"), H.secondKey("araso.secondJourneyClosed"));
    note("multi", [0, 0], { piggies: await homeAll("20") });
  });
  for (const size of SIZES) {
    await step(`J2 ${size[0]}`, () => framesJar("J2", size));
    await step(`T2 ${size[0]}`, () => frameTab("T2", size));
    await step(`I2 ${size[0]}`, () => frameInMulti(size));
    await step(`O2 ${size[0]}`, () => frameOut("multi", size));
    await step(`G2 ${size[0]}`, () => frameGift("G2", size));
  }
  note("one-away", [0, 0], { piggies: await oneAway() });
  for (const size of SIZES) {
    await step(`T2-away ${size[0]}`, () => frameTab("T2-oneAway", size));
    await step(`O3 ${size[0]}`, () => frameOut("away", size));
  }
  await homeAll("20");
} catch (e) {
  stepErrors.push({ step: "run", error: String((e && e.stack) || e).slice(0, 600) });
  console.log("ERROR", stepErrors[stepErrors.length - 1].error);
} finally {
  // tap sizes (>= 44 on screen) over every measured control
  const kinds = new Set(tapRows.map((r) => r.kind));
  for (const k of ["jar", "row", "switch", "picker", "ok", "back"]) must(kinds.has(k), `TAP: ${k} was measured at least once`);
  const small = tapRows.filter((r) => r.h < MIN_TAP || (r.kind === "jar" && r.w < MIN_TAP));
  for (const r of small) must(false, `TAP: ${r.kind} ${r.sel} "${r.text}" is ${r.w}x${r.h} (< ${MIN_TAP}) in ${r.frame} ${r.size}`);
  const summary = {};
  for (const r of tapRows) { const k = `${r.kind}@${r.size}`; const s = (summary[k] ||= { n: 0, minW: Infinity, minH: Infinity }); s.n += 1; s.minW = Math.min(s.minW, r.w); s.minH = Math.min(s.minH, r.h); }
  must(offsite.length === 0, `network: nothing beyond the local stub (saw ${offsite.slice(0, 5).join(", ")})`);
  const tapSummary = { min: MIN_TAP, summary, belowMin: small };
  writeFileSync(path.join(OUT, "frames.json"), JSON.stringify({ errors: H.errors, stepErrors, assertFailures: failures, offsite, txCount, tapSummary, tapRows, frames }, null, 2));
  await H.close?.();
}
console.log(`frames written: ${path.join(OUT, "frames.json")}  stepErrors=${stepErrors.length} assertFailures=${failures.length}`);
process.exit(stepErrors.length || failures.length ? 1 : 0);
