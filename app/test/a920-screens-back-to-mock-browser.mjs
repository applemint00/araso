// [A-920 PART 1] Name card · Second candidates · Return · Invite put back to the Owner mocks (RESPONSIVE_REF img 20/21/22 · 15/16/17 · 25/26/27 · 30/31/33), the Framer way:
// the fix lives in the shared layout rule (keyframes 390 / 810 / 1440, straight line between, 0 steps), never in one screen.
// Browser only (ARASO_TEST_BROWSER=1; needs local port binding + $ARASO_PRIVATE_BASE/ops/harness playwright). Without it this file prints SKIP and exits 0.
//   ARASO_TEST_BROWSER=1 node app/test/a920-screens-back-to-mock-browser.mjs
//   A920_FRAMES=<dir>   also writes every frame (390 / 390i / 810 / 1440) + measured.json into <dir>
//   ARASO_SWEEP=freeze  runs the sweep below (A-926; default csv = receipts/A920_screens_back_to_mock/SWEEP/a920_sweep_freeze.csv)
//   A920_SWEEP=<csv>    also runs the 1 px width sweep 360..1600 (A920_SWEEP_STEP, default 1) and writes the csv there
// Mock numbers = receipts/A919_mock_check/{mock_boxes,ink_boxes,invite_boxes}.json (pixel measured the same way on mock and app frames; ink boxes are re-measured here in the page).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launch, sleep, harnessPresent } from "./helpers/a803-browser.mjs";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a920 browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }
if (!harnessPresent()) { console.log("SKIP  a920 (no private harness)"); process.exit(0); }

const FRAMES = process.env.A920_FRAMES || "";
const SWEEP = process.env.A920_SWEEP || (process.env.ARASO_SWEEP === "freeze" ? privatePath("ops/receipts/A920_screens_back_to_mock/SWEEP/a920_sweep_freeze.csv") : ""); // [A-926] ARASO_SWEEP=freeze → full sweep; otherwise 390/390i/810/1440 only (A-923 rule 2: 1px sweep once, at freeze)
if (!SWEEP) console.log("sweep skipped (ARASO_SWEEP!=freeze)");
const STEP = Number(process.env.A920_SWEEP_STEP) || 1;
if (FRAMES) mkdirSync(FRAMES, { recursive: true });

const VPS = [
  { id: "390", w: 390, h: 844, top: 0 },
  { id: "390i", w: 390, h: 844, top: 59 }, // iPhone island: safe-area-inset-top 59 injected through the app's own --hk-safe-top
  { id: "810", w: 810, h: 1080, top: 0 },
  { id: "1440", w: 1440, h: 900, top: 0 },
];
// ── the mock numbers (x, y, w, h) ──
const MOCK = {
  name: {
    card: { 390: [37, 275, 316, 207], 810: [87, 271, 636, 416], 1440: [427, 283, 585, 383] },
    piggy: { 390: [98, 166, 136, 106], 810: [204, 105, 207, 164], 1440: [539, 96, 233, 183] },
    chog: { 390: [25, 709, 57, 81], 810: [59, 880, 89, 123], 1440: [214, 700, 100, 138] },
  },
  second: { card: { 390: [20, 176, 284, 363], 810: [199, 179, 412, 528], 1440: [328, 112, 378, 484] } },
  ret: {
    receipt: { 390: [62, 104, 266, 320], 810: [212, 142, 386, 465], 1440: [367, 188, 354, 426] },
    piggy: { 390: [143, 551, 112, 126], 810: [341, 639, 171, 192], 1440: [769, 430, 193, 216] },
    chog: { 390: [230, 716, 54, 72], 810: [474, 890, 82, 111], 1440: [919, 713, 92, 124] },
  },
  invite: {
    face: { 390: [124, 441, 116, 47], 810: [315, 572, 146, 58], 1440: [662, 657, 189, 58] },
    env: { 390: [53, 213, 249, 195], 810: [226, 283, 313, 246], 1440: [466, 121, 585, 459] },
    chog: { 390: [51, 583, 70, 103], 810: [224, 750, 87, 130] },
  },
};
// the beige-envelope pixel box is 0.971 x the .invite__envImg DOM box (A-919 pixel vs DOM at 390 / 810 / 1440 on the same frame)
const ENV_PX_PER_DOM = 0.971;

// ── in-page helpers ──
function inkBlobsInPage([b64, minh, minw]) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, W, H).data;
      const m = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i += 1) { const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2]; const mn = Math.min(r, gg, b); if (mn > 225 && Math.max(r, gg, b) - mn < 18) m[i] = 1; }
      const R = 5; // dilate by 5 (box) = separable max filter
      const tmp = new Uint8Array(W * H), dil = new Uint8Array(W * H);
      for (let y = 0; y < H; y += 1) { let last = -1e9; const row = y * W; const near = new Int32Array(W); for (let x = 0; x < W; x += 1) { if (m[row + x]) last = x; near[x] = last; } let nxt = 1e9; for (let x = W - 1; x >= 0; x -= 1) { if (m[row + x]) nxt = x; if (x - near[x] <= R || nxt - x <= R) tmp[row + x] = 1; } }
      for (let x = 0; x < W; x += 1) { let last = -1e9; const near = new Int32Array(H); for (let y = 0; y < H; y += 1) { if (tmp[y * W + x]) last = y; near[y] = last; } let nxt = 1e9; for (let y = H - 1; y >= 0; y -= 1) { if (tmp[y * W + x]) nxt = y; if (y - near[y] <= R || nxt - y <= R) dil[y * W + x] = 1; } }
      const seen = new Uint8Array(W * H); const out = []; const stack = [];
      for (let s = 0; s < W * H; s += 1) {
        if (!dil[s] || seen[s]) continue;
        let x0 = W, y0 = H, x1 = 0, y1 = 0; stack.push(s); seen[s] = 1;
        while (stack.length) { const q = stack.pop(); const x = q % W, y = (q / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; for (const n of [q - 1, q + 1, q - W, q + W]) { if (n < 0 || n >= W * H || dil[n] === 0 || seen[n]) continue; if ((n === q - 1 && x === 0) || (n === q + 1 && x === W - 1)) continue; seen[n] = 1; stack.push(n); } }
        const bw = x1 - x0 + 1 - 10, bh = y1 - y0 + 1 - 10;
        if (bh >= minh && bw >= minw) out.push({ x: x0 + 5, y: y0 + 5, w: bw, h: bh });
      }
      resolve(out.sort((a, b) => a.x - b.x));
    };
    img.src = "data:image/png;base64," + b64;
  });
}
const BOXES = (sels) => {
  const r1 = (n) => Math.round(n * 10) / 10; const out = {};
  for (const [k, sel] of Object.entries(sels)) {
    const e = document.querySelector(sel); if (!e || e.closest("[hidden]")) { out[k] = null; continue; }
    const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    out[k] = b.width > 0 && cs.display !== "none" ? [r1(b.left), r1(b.top), r1(b.width), r1(b.height), parseFloat(cs.fontSize) || 0] : null;
  }
  return out;
};

const H = await launch();
const { p } = H;
let pass = 0, fail = 0;
const results = { at: new Date().toISOString(), scenes: {} };
// Name (item 1) and Invite (item 4) need main.js (nameSceneLayout / inviteGroupScale), which is outside A-920's allowed_files: PREMISE_CONFLICT, OUTBOX `질문 · A-920`, patch in receipts/A920_screens_back_to_mock/main_js_proposed.patch.
// Cowork answered: allowed (two places). A920_SKIP_MAIN_JS_ITEMS=1 skips them (to test against a main.js without the A-920 lines).
const BLOCKED = process.env.A920_SKIP_MAIN_JS_ITEMS === "1"; // Cowork 2026-10-08 20:42: main.js allowed for nameSceneLayout / fitNameScene / inviteGroupScale only, so Name + Invite are asserted by default
async function check(name, fn) {
  if (BLOCKED && /^(invite|name) /.test(name)) { console.log(`SKIP  ${name} (needs main.js: PREMISE_CONFLICT, see OUTBOX 질문 · A-920)`); return; } try { await fn(); console.log(`PASS  ${name}`); pass += 1; } catch (e) { console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0].slice(0, 400)}`); fail += 1; } }
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: app ${a} vs mock ${b} (tol ${tol})`);
const nearBox = (app, mock, tol, what, which = [0, 1, 2, 3]) => { assert.ok(app, `${what}: not rendered`); for (const i of which) near(app[i], mock[i], tol, `${what}[${"xywh"[i]}]`); };
// ink boxes are pixel blobs of an animated character (idle pose changes the ink height by a few px): x and the BOTTOM edge to tol, width / height to tolSize
const nearInk = (app, mock, tol, tolSize, what) => { assert.ok(app, `${what}: not found`); near(app[0], mock[0], tol, `${what}[x]`); near(app[1] + app[3], mock[1] + mock[3], tol, `${what}[bottom]`); near(app[2], mock[2], tolSize, `${what}[w]`); near(app[3], mock[3], tolSize, `${what}[h]`); };
const setVp = async (vp) => {
  // the safe-top var first, then the size: the app memoises its layout per (width, height) and reads --hk-safe-top inside that memo
  await p.evaluate((t) => { let s = document.getElementById("a920Safe"); if (!s) { s = document.createElement("style"); s.id = "a920Safe"; document.head.appendChild(s); } s.textContent = `:root{--hk-safe-top:${t}px}`; }, vp.top);
  await p.setViewportSize({ width: vp.w, height: vp.h });
  await sleep(1500);
};
async function grab(label, vp, sels, ink) {
  const png = await p.screenshot({ type: "png" });
  if (FRAMES) writeFileSync(path.join(FRAMES, `${label}__${vp.id}.png`), png);
  const boxes = await p.evaluate(BOXES, sels);
  const blobs = ink ? await p.evaluate(inkBlobsInPage, [png.toString("base64"), 35, 25]) : [];
  const rec = { boxes, blobs: blobs.map((b) => [b.x, b.y, b.w, b.h]) };
  (results.scenes[label] ||= {})[vp.id] = rec;
  return rec;
}
const BR = { brand: ".arasoBrand" };
const sweepRows = [["scene", "vw", "vh", "box", "x", "y", "w", "h", "font"]];
const SWEEP_H = 900;
async function sweepScene(label, sels, ink) {
  for (let w = 360; w <= 1600; w += STEP) {
    await p.setViewportSize({ width: w, height: SWEEP_H }); await sleep(ink ? 120 : 60);
    const b = await p.evaluate(BOXES, sels);
    for (const [k, v] of Object.entries(b)) sweepRows.push([label, w, SWEEP_H, k, ...(v || ["", "", "", "", ""])]);
    if (ink) {
      const png = await p.screenshot({ type: "png" });
      const bl = await p.evaluate(inkBlobsInPage, [png.toString("base64"), 35, 25]);
      const cl = bl.filter((q) => q.h >= 60 && q.y + q.h > 0.6 * SWEEP_H && q.x > 0.3 * w).sort((x, y) => x.x - y.x);
      cl.slice(0, 2).forEach((q, i) => sweepRows.push([label, w, SWEEP_H, i ? "chogInk" : "piggyInk", q.x, i ? q.y : q.y + q.h /* Piggy: bottom edge (the top merges with the Receipt caption at some widths) */, q.w, i ? q.h : "", ""]));
    }
  }
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(800);
}
const byId = (label, id) => results.scenes[label]?.[id];

try {
  // ── 4. INVITE (first page) — reload per size so the artboard kind is fresh ──
  for (const vp of VPS) {
    await p.setViewportSize({ width: vp.w, height: vp.h });
    await p.goto(H.BASE, { waitUntil: "networkidle" });
    await p.addStyleTag({ content: `:root{--hk-safe-top:${vp.top}px}` });
    await p.waitForSelector(".invite", { timeout: 15000 }).catch(() => {});
    await p.evaluate(() => window.dispatchEvent(new Event("resize")));
    await sleep(3600);
    const rec = await grab("invite", vp, { ...BR, face: "#inviteFaceButton", envImg: ".invite__envImg", env: ".invite__env" }, true);
    const face = rec.boxes.face, envImg = rec.boxes.envImg;
    if (vp.id === "390i" || vp.id === "390") { /* both 390 frames below */ }
    const key = vp.w;
    await check(`invite ${vp.id}: Face ID + envelope centre x, y = mock centre`, () => { const m = MOCK.invite.face[key], me = MOCK.invite.env[key]; near(face[0] + face[2] / 2, m[0] + m[2] / 2, 3, "face centre x"); near(face[1] + face[3] / 2, m[1] + m[3] / 2, 4, "face centre y"); near(envImg[0] + envImg[2] / 2, me[0] + me[2] / 2, 3, "envelope centre x"); near(envImg[1] + envImg[3] / 2, me[1] + me[3] / 2, 4, "envelope centre y"); });
    // Face ID label = Button 16 (A-843 #2, Cowork 20:42): its width is NOT fitted to the mock; the numbers go to the receipt / OUTBOX (mock face w vs app face w)
    results.faceVsMock = { ...(results.faceVsMock || {}), [vp.id]: { app: face && face.slice(2, 4), mock: MOCK.invite.face[key].slice(2, 4) } };
    await check(`invite ${vp.id}: envelope = mock size (DOM box x ${ENV_PX_PER_DOM})`, () => { const e = [0, 0, envImg[2] * ENV_PX_PER_DOM, envImg[3] * ENV_PX_PER_DOM]; nearBox(e, MOCK.invite.env[key], 3, "envelope", key === 1440 ? [2] : [2, 3]); });
    if (MOCK.invite.chog[key]) await check(`invite ${vp.id}: Chog ink = mock size`, () => { const ch = rec.blobs.filter((b) => b[1] > face[1] + face[3] + 40).sort((a, b) => b[3] - a[3])[0]; nearBox(ch, MOCK.invite.chog[key], 3.5, "chog", [2, 3]); });
  }
  if (SWEEP) {
    await p.setViewportSize({ width: 390, height: 844 }); await p.goto(H.BASE, { waitUntil: "networkidle" }); await p.waitForSelector(".invite", { timeout: 15000 }).catch(() => {}); await sleep(3600);
    await sweepScene("invite", { face: "#inviteFaceButton", envImg: ".invite__envImg", chogBox: ".invite__chog" }, false);
    await p.goto(H.BASE, { waitUntil: "networkidle" }); await sleep(1500);
  }
  if (process.env.A920_ONLY === "invite") { if (FRAMES) writeFileSync(path.join(FRAMES, "measured.json"), JSON.stringify(results, null, 1)); await H.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
  // ── Face ID → Name ──
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(H.BASE, { waitUntil: "networkidle" }); await sleep(1500);
  for (let a = 0; a < 4; a += 1) {
    if (await p.locator("#inviteFaceButton").count()) await p.locator("#inviteFaceButton").click().catch(() => {});
    await p.waitForFunction(() => ["hatch", "name"].includes(document.querySelector("[data-scene]")?.dataset.scene) || document.querySelector("#authTryAgainButton"), { timeout: 25000 }).catch(() => {});
    if (["hatch", "name"].includes(await H.scene())) break;
    await p.locator("#authTryAgainButton").click().catch(() => {}); await sleep(800);
  }
  for (let t0 = Date.now(); Date.now() - t0 < 40000;) {
    const v = await p.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden && getComputedStyle(e).visibility !== "hidden"; }; return { input: vis("#piggyNameInput"), ok: vis(".nameCard__ok .pkbtn") }; });
    if (v.input) break;
    if (v.ok) { await p.locator(".nameCard__ok .pkbtn").first().click({ force: true }).catch(() => {}); await sleep(900); continue; }
    await sleep(300);
  }
  await p.locator("#piggyNameInput").fill("Honeybun"); await sleep(1800);
  const NAMESEL = { ...BR, card: ".nameCard", piggy: "#namePiggy", chogBox: ".nameScene__chog" };
  for (const vp of VPS) {
    await setVp(vp);
    const rec = await grab("name", vp, NAMESEL, true);
    const key = vp.w;
    await check(`name ${vp.id}: card = mock box`, () => nearBox(rec.boxes.card, MOCK.name.card[key], 3.2, "card"));
    await check(`name ${vp.id}: Piggy peek ink = mock box`, () => { const pg = rec.blobs.filter((b) => b[2] < 320).sort((a, b) => a[1] - b[1])[0]; nearInk(pg, MOCK.name.piggy[key], 4, 7, "piggy"); });
    await check(`name ${vp.id}: Chog ink = mock box`, () => { const ch = rec.blobs.filter((b) => b[0] < vp.w * 0.5).sort((a, b) => b[1] - a[1])[0]; nearInk(ch, MOCK.name.chog[key], 5, 7, "chog"); });
  }
  if (SWEEP) await sweepScene("name", { card: ".nameCard", piggy: "#namePiggy", chogBox: ".nameScene__chog" }, false);
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(500);
  await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
  await H.waitScene(["sendstay"], 10000); await sleep(5000);
  for (let t0 = Date.now(); Date.now() - t0 < 25000;) { if (await p.locator("#sendCard #stayButton").count()) { await sleep(3500); await p.evaluate(() => document.querySelector("#sendCard #stayButton")?.click()); await sleep(1500); break; } await sleep(300); }
  // ── 2. SECOND interests → candidates ──
  await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true })); await sleep(2800);
  const SECSEL = { ...BR, card: "#secondJourneyCard", anchor: "#sendCardAnchor" };
  for (let t0 = Date.now(); Date.now() - t0 < 8000 && !(await p.locator("#exploreForm").count());) await sleep(200);
  for (const vp of VPS) { await setVp(vp); await grab("second_interests", vp, SECSEL, false); }
  if (SWEEP) await sweepScene("second_interests", { card: "#secondJourneyCard" }, false);
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(600);
  for (let i = 0; i < 2; i += 1) { await H.mustTap(".secondJourney__item", "tick", i); await sleep(250); }
  await H.mustTap("#exploreSaveButton", "save"); await sleep(5500);
  for (const vp of VPS) {
    await setVp(vp);
    const rec = await grab("second_candidates", vp, { ...SECSEL, pick: ".secondJourney__pick", footer: ".secondJourney__footer" }, false);
    const it = byId("second_interests", vp.id).boxes.card; const key = vp.w;
    await check(`second ${vp.id}: candidates card = interests card (x, y, w, h)`, () => nearBox(rec.boxes.card, it, 0.6, "candidates vs interests"));
    await check(`second ${vp.id}: candidates card left edge/width = mock card`, () => nearBox(rec.boxes.card, MOCK.second.card[key], 3.2, "card", [0, 2]));
    await check(`second ${vp.id}: candidate row inside the card`, () => { const pk = rec.boxes.pick, c = rec.boxes.card; assert.ok(pk && pk[0] >= c[0] && pk[0] + pk[2] <= c[0] + c[2] + 0.5, `pick ${pk} card ${c}`); });
  }
  if (SWEEP) await sweepScene("second_candidates", { card: "#secondJourneyCard", pick: ".secondJourney__pick" }, false);
  // ── 3. RETURN receipt ──
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(500);
  await p.evaluate(() => window.__arasoScene("sendstay")); await sleep(2500);
  await p.evaluate(() => window.__arasoScene("return", { arrival: true })); await sleep(1500);
  for (let t0 = Date.now(); Date.now() - t0 < 15000;) { if (await p.evaluate(() => { const e = document.querySelector("#returnTap .receiptPaper"); return !!e && e.getBoundingClientRect().width > 0; })) break; await sleep(150); }
  await sleep(2500);
  const RETSEL = { ...BR, receipt: "#returnTap .receiptPaper", alarm: "#returnArrivalAlarm, .chogCheckLine" };
  for (const vp of VPS) {
    await setVp(vp);
    const rec = await grab("return", vp, RETSEL, true);
    const key = vp.w;
    const cl = rec.blobs.filter((b) => b[3] >= 60 && b[1] + b[3] > 0.6 * vp.h && b[0] > 0.3 * vp.w).sort((a, b) => a[0] - b[0]);
    await check(`return ${vp.id}: receipt = mock box (x, y; size within the 8 px annotation pad)`, () => { const r = rec.boxes.receipt, m = MOCK.ret.receipt[key]; near(r[0] + r[2] / 2, m[0] + m[2] / 2, 5, "receipt centre x"); if (key === 390) near(r[1], m[1], 9, "receipt top"); /* 810 / 1440: the A-845 raise (Cowork R1 (i)) is not part of A-920 item 3; recorded in the receipt, not asserted */ if (key === 390) near(r[2], m[2], 10, "receipt w (the mock pink box carries the annotation pad; 810 / 1440 receipt size is unchanged, not asserted)"); });
    await check(`return ${vp.id}: Piggy ink = mock box`, () => nearInk(cl[0], MOCK.ret.piggy[key], 4, 7, "piggy"));
    await check(`return ${vp.id}: Chog ink = mock box`, () => { const c = cl[1]; assert.ok(c, "chog: not found"); const m = MOCK.ret.chog[key]; near(c[0], m[0], 5, "chog[x]"); near(c[1], m[1], 5, "chog[top] (the mock feet are clipped by its annotation box, so the top edge is compared)"); near(c[2], m[2], 8, "chog[w]"); });
  }
  if (SWEEP) await sweepScene("return", { receipt: "#returnTap .receiptPaper" }, true);
  // ── [A-924 · A-920 PART 2] items 6–9 (item 5 = node pin a898-funding-paper A1; item 7 caption = held, PREMISE_CONFLICT A-744 / A-911 answer 4) ──
  // 9: outside Home shows ARASO in the same box as Home (0 px)
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(500);
  for (const vp of VPS) {
    await setVp(vp);
    await p.evaluate(() => window.__arasoScene("sendstay")); await sleep(1800);
    const home = await p.evaluate(BOXES, { brand: ".stage .arasoBrand" });
    await p.evaluate(() => window.__arasoScene("away")); await sleep(1800);
    const away = await grab("away_araso", vp, { brand: ".stage .arasoBrand" }, false);
    await check(`p2 item 9 ${vp.id}: away ARASO box = Home ARASO box (0 px)`, () => nearBox(away.boxes.brand, home.brand, 0.5, "away brand vs home"));
  }
  await p.evaluate(() => window.__arasoScene("sendstay")); await sleep(1500);
  // 6 / 7 / 8: the A-911 screens rendered in the page DOM from the real builders + a911Fit (no tx path; same method as A-919 row 8)
  const injectScreen = async (kind, view) => p.evaluate(async ([k, v]) => {
    const m = await import("/src/a911-screens.js");
    document.querySelectorAll(".a920p2").forEach((e) => e.remove());
    const host = document.createElement("div"); host.className = "a920p2";
    host.innerHTML = k === "gift" ? m.a911GiftMarkup(v) : m.a911MoveMarkup(v);
    document.body.appendChild(host);
    const root = host.querySelector(".a911-screen"); m.a911Fit(root); await new Promise((r) => setTimeout(r, 400)); m.a911Fit(root);
    const box = (sel) => { const e = root.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 10) / 10); };
    return { brandStyle: getComputedStyle(root.querySelector(".arasoBrand")).fontStyle, card: box(".a911-card.is-picked"), link: box(".a911-link"), note: root.querySelector("[data-a924-confirm-note]")?.textContent || null, amount: root.querySelector(".a911-line__r")?.textContent || null };
  }, [kind, view]);
  const GIFT_V = { stage: "pick", ci: 1, picked: "02", flipped: false, typing: "none", fronts: [{ id: "01" }, { id: "02" }, { id: "04" }], amountUsd: 20, presets: [{ id: "20", label: "$20", selected: true }, { id: "50", label: "$50", selected: false }, { id: "100", label: "$100", selected: false }], fields: { to: "", message: "", from: "" }, payerName: "Honeybun", balanceUsd: "38", fees: { giftGasCost: { known: false }, arasoFee: { usd: "0" } } };
  for (const vp of VPS) {
    await setVp(vp);
    const g = await injectScreen("gift", GIFT_V);
    const d = await injectScreen("gift", { ...GIFT_V, stage: "done", link: "araso.app/g/••••••" });
    const o = await injectScreen("move", { dir: "out", step: "address", piggy: { name: "Honeybun" }, amount: "20", asset: "USDC", address: "", canSend: false });
    if (FRAMES) writeFileSync(path.join(FRAMES, `p2_measure__${vp.id}.json`), JSON.stringify({ g, d, o }, null, 1));
    (results.scenes.p2 ||= {})[vp.id] = { pickCard: g.card, link: d.link, brandStyle: g.brandStyle, note: o.note, amount: o.amount };
    await check(`p2 item 8 ${vp.id}: ARASO upright on the A-911 screens (shared .arasoBrand)`, () => assert.equal(g.brandStyle, "normal"));
    await check(`p2 item 6 ${vp.id}: out address = "$20" + USDC and the existing confirm note`, () => { assert.equal(o.amount, "$20USDC"); assert.equal(o.note, "Needs your OK — nothing has been sent yet."); });
    if (vp.w === 390) await check(`p2 item 7 ${vp.id}: link pill height = mock ~43 (A-919 row 8; was 58)`, () => near(d.link[3], 43, 3, "link h"));
    if (vp.w === 1440) await check(`p2 item 7 ${vp.id}: pick card = mock ~345 x 541 at 1440 (A-919 row 7; was 270 x 428)`, () => { near(g.card[2], 345, 4, "card w"); near(g.card[3], 541, 6, "card h"); });
  }
  await p.evaluate(() => document.querySelectorAll(".a920p2").forEach((e) => e.remove()));
  if (SWEEP) {
    const rows = sweepRows;
    writeFileSync(SWEEP, rows.map((r) => r.join(",")).join("\n"));
    const by = {};
    for (const r of rows.slice(1)) { if (r[4] === "") continue; (by[`${r[0]}/${r[3]}`] ||= []).push(r); }
    const worst = {}; const bad = [];
    for (const [k, arr] of Object.entries(by)) {
      for (let i = 1; i < arr.length; i += 1) {
        if (arr[i][1] - arr[i - 1][1] !== STEP) continue;
        if (k.startsWith("invite/") && arr[i - 1][1] < 900 && arr[i][1] >= 900) continue; // artboard family swap at INVITE_WIDE_MIN 900 (A-819 UI-03, existing, not changed)
        for (const [n, c] of [["x", 4], ["y", 5], ["w", 6], ["h", 7], ["font", 8]]) {
          const a = Number(arr[i - 1][c]), b = Number(arr[i][c]); if (!a && !b) continue;
          const d = Math.abs(b - a) / STEP, pct = (d / Math.max(Math.abs(a), Math.abs(b), 1)) * 100; // per 1 px of width; ink boxes are pixel blobs (threshold + dilation move each edge by 1 px), so their quantum is 2 px
          const key = `${k}.${n}`; worst[key] = Math.max(worst[key] || 0, pct);
          if (pct > 1 && d > (k.endsWith("Ink") ? 2.0001 : 1.0001)) bad.push(`${key} ${arr[i - 1][1]}->${arr[i][1]}: ${a} -> ${b} (${pct.toFixed(2)} %)`);
        }
      }
    }
    writeFileSync(SWEEP.replace(/\.csv$/, "") + "_summary.json", JSON.stringify({ step: STEP, vh: SWEEP_H, worstAdjacentPct: Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toFixed(3)])), violations: bad }, null, 1));
    await check(`sweep 360..1600 step ${STEP}: no step > 1 % (or > 1 px) in any changed box`, () => assert.equal(bad.length, 0, `${bad.length} steps, first: ${bad.slice(0, 3).join(" | ")}`));
  }
} catch (e) {
  console.log(`FAIL  a920 harness: ${String(e.stack || e).slice(0, 600)}`); fail += 1;
  await p.screenshot({ path: path.join(FRAMES || ".", "a920-error.png") }).catch(() => {});
} finally {
  results.pageErrors = H.errors;
  if (FRAMES) writeFileSync(path.join(FRAMES, "measured.json"), JSON.stringify(results, null, 1));
  await H.close();
}
console.log(`\n${pass} passed, ${fail} failed${SWEEP ? "" : " (sweep skipped)"}`); // [A-926 review note]
process.exit(fail ? 1 : 0);
