// A-841 Wave 2 — UI-16 (departure sit->stand ghost), UI-27 (solo awake Idle blink + breath), UI-12 (Save->Home time series, browser).
// Browser sections run only with ARASO_TEST_BROWSER=1 (local dev server + headless Chrome). A841_OUT=<dir> writes the raw series.
// pre-A-841 baseline: lookingA = 1 - rise (seat) ; standing globalAlpha = rise  -> both visible mid-rise (double outline)
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const target = process.env.A841_DEPART_SRC || path.join(HERE, "../src/piggy-depart.js");
globalThis.Path2D = globalThis.Path2D || class Path2D { constructor(d) { this.d = d; } };
const depart = await import(pathToFileURL(target).href);

const SEAT = new Set(["seat-idle", "seat-lookup", "work-open", "work-half", "work-shut"]);
function sampler(mode) {
  const names = new Map();
  const mk = (n) => ({ __n: n, width: 10, height: 10 });
  const images = new Proxy(new Map(), { get: (m, k) => (k === "get" ? (n) => (names.has(n) ? names.get(n) : (names.set(n, mk(n)), names.get(n))) : Reflect.get(m, k)) });
  let draws = [], saves = 0, restores = 0;
  const makeCtx = (record) => {
    let alpha = 1; const stack = [];
    return new Proxy({}, {
      get: (_, k) => {
        if (k === "globalAlpha") return alpha;
        if (k === "save") return () => { if (record) saves++; stack.push(alpha); };
        if (k === "restore") return () => { if (record) restores++; alpha = stack.pop() ?? 1; };
        if (k === "drawImage") return (im) => { if (record && im && im.__n) draws.push([im.__n, alpha]); };
        return () => {};
      },
      set: (_, k, v) => { if (k === "globalAlpha") alpha = v; return true; },
    });
  };
  const ctx = makeCtx(true), lctx = makeCtx(false);
  globalThis.document = { createElement: () => ({ __n: "layer", width: 0, height: 0, getContext: () => lctx }) };
  const canvas = { width: 1256, height: 772, getContext: () => ctx };
  const r = depart.createDepartRenderer(canvas, { images, mode });
  return {
    at(t) { draws = []; saves = 0; restores = 0; const o = r.drawAt(t); const seat = Math.max(0, ...draws.filter(([n]) => SEAT.has(n)).map(([, a]) => a)); const stand = Math.max(0, ...draws.filter(([n]) => !SEAT.has(n)).map(([, a]) => a)); return { t, rise: o.rise, seat, stand, balanced: saves === restores }; },
  };
}

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

if (process.env.A841_SERIES) {
  const s = sampler("send");
  for (let t = 0; t <= 2.0001; t += 0.05) { const o = s.at(+t.toFixed(2)); console.log([o.t.toFixed(2), o.rise.toFixed(3), o.seat.toFixed(3), o.stand.toFixed(3), o.seat > 0.05 && o.stand > 0.05 ? "DOUBLE" : "-"].join("\t")); }
  process.exit(0);
}

check("UI-16 send: never two poses above 5% alpha in the same frame (0..3s, 5 ms step)", () => {
  const s = sampler("send"); let sawSeat = false, sawStand = false;
  for (let t = 0; t <= 3; t += 0.005) { const o = s.at(t); assert.ok(!(o.seat > 0.05 && o.stand > 0.05), `double pose @${t.toFixed(3)} seat=${o.seat} stand=${o.stand}`); sawSeat ||= o.seat > 0.9; sawStand ||= o.stand > 0.99; }
  assert.ok(sawSeat && sawStand, "seat fully visible at start and standing fully visible at end");
});
check("UI-16 send: rise window unchanged (rise 0 at 1.0s source, 1 by 1.55s source) and monotone", () => {
  const s = sampler("send"); let prev = -1;
  for (let t = 0; t <= 3; t += 0.01) { const o = s.at(t); assert.ok(o.rise >= prev - 1e-9); prev = o.rise; }
  assert.equal(s.at(0).rise, 0); assert.equal(s.at(3).rise, 1);
});
check("UI-16 balanced ctx.save/restore at every sample (send + work)", () => {
  for (const m of ["send", "work"]) { const s = sampler(m); for (let t = 0; t <= 3; t += 0.05) assert.ok(s.at(t).balanced, `${m}@${t}`); }
});
check("UI-16 work mode unchanged: rise 0, seat pose stays at alpha 1, no standing body", () => {
  const s = sampler("work");
  for (const t of [0, 0.3, 0.9, 1.8, 5, 60]) { const o = s.at(t); assert.equal(o.rise, 0); assert.equal(o.stand, 0); assert.ok(o.seat > 0.99, `seat@${t}=${o.seat}`); }
});
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const REPO = path.resolve(HERE, "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const fnBody = (src, name) => { const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, `${name} missing`); return src.slice(i, src.indexOf("\n}\n", i) + 3); };
const OUT = process.env.A841_OUT || "";
const save = (name, data) => { if (!OUT) return; mkdirSync(OUT, { recursive: true }); writeFileSync(path.join(OUT, name), typeof data === "string" ? data : JSON.stringify(data, null, 1)); };

// ── UI-27 source pins (node) ──
check("UI-27 source: awake solo shows the layer and draws the existing ambIdle blink (no second blink system) + breath on an inner wrapper", () => {
  const b = fnBody(MAIN, "makeSeatSleeper");
  assert.match(b, /if \(solo\) soloShow\(true\);\s*seatArt\.art\.draw\(elapsedNormal, reduced\);/);
  assert.equal(/state\./.test(b), false, "no state. in makeSeatSleeper");
  assert.equal((MAIN.match(/\.animate\(AMB_BLINK_KEYS/g) || []).length, 1, "exactly one blink renderer");
  assert.match(MAIN, /breathEl\.style\.transformOrigin = `\$\{AMB_SEATED\.x \+ AMB_SEATED\.w \/ 2\}px \$\{AMB_SEATED\.y \+ AMB_SEATED\.h\}px`/);
  assert.match(MAIN, /stageEl\.style\.transform = `scale\(\$\{q\}\)`;/, "stage inline scale untouched");
  assert.match(CSS, /\.homeLiving__breath \{[^}]*inset: 0;/);
  // pre-A-841 baseline: if (solo) { soloShow(false); return; }
  assert.equal(/if \(solo\) \{ soloShow\(false\); return; \}/.test(b), false);
});
check("UI-27 reduced motion: breath writes no transform; blink pinned at 0", () => {
  const b = fnBody(MAIN, "ambBreath");
  assert.match(b, /if \(reduced\) \{ if \(el\.style\.transform\) el\.style\.transform = ""; return; \}/);
  assert.match(fnBody(MAIN, "ambDrawBlink"), /reduced \? 0 :/);
});


// ── UI-12 (Name Save -> Home): NOT reproduced as a descend-then-rise. This section pins the measured series so a regression shows. ──
// UNKNOWN cause of the user observation; measured: Piggy walk path monotone (no reversal), foot step at the swap <= 6 px, <= 4 frames without a Piggy.
async function runUI12(w, hh) {
  const H = await import("./helpers/a803-browser.mjs");
  const { sleep } = H;
  const h = await H.launch(); const p = h.p;
  try {
    await p.setViewportSize({ width: w, height: hh });
    await p.goto(h.BASE, { waitUntil: "networkidle" }).catch(() => {});
    for (let a = 0; a < 4; a += 1) {
      if (await p.locator("#inviteFaceButton").count()) await p.locator("#inviteFaceButton").click().catch(() => {});
      await p.waitForFunction(() => ["hatch", "name"].includes(document.querySelector("[data-scene]")?.dataset.scene) || document.querySelector("#authTryAgainButton"), { timeout: 25000 }).catch(() => {});
      if (["hatch", "name"].includes(await h.scene())) break;
      await p.locator("#authTryAgainButton").click().catch(() => {}); await sleep(800);
    }
    for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
      const v = await p.evaluate(() => { const vis = (q) => { const e = document.querySelector(q); return !!e && e.getBoundingClientRect().width > 0 && !e.hidden; }; return { input: vis("#piggyNameInput"), ok: vis(".nameCard__okBtn") }; });
      if (v.input) break;
      if (v.ok) { await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(900); continue; }
      await sleep(300);
    }
    await p.locator("#piggyNameInput").fill("Honeybun"); await sleep(400);
    await p.evaluate(() => {
      window.__ts = []; const t0 = performance.now();
      const inkOf = (root) => { let l = 1e9, t = 1e9, r = -1e9, b = -1e9; root?.querySelectorAll("path,ellipse,circle,rect").forEach((e) => { const q = e.getBoundingClientRect(); if (q.width > 1 && q.height > 1) { l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); } }); return [l, t, r, b]; };
      const cv = document.createElement("canvas"); const cx = cv.getContext("2d", { willReadFrequently: true });
      const walkInk = () => { const im = document.querySelector("#homeWalk"); if (!im || !im.complete || !im.naturalWidth) return null; const q = im.getBoundingClientRect(); if (q.width < 2 || q.height < 2) return null; cv.width = Math.round(q.width); cv.height = Math.round(q.height); cx.clearRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height); const d = cx.getImageData(0, 0, cv.width, cv.height).data; let bt = -1; for (let y = cv.height - 1; y >= 0 && bt < 0; y -= 1) for (let x = 0; x < cv.width; x += 1) if (d[(y * cv.width + x) * 4 + 3] > 40) { bt = y; break; } return q.top + bt; };
      const loop = () => { const t = performance.now() - t0; const sc = document.querySelector("[data-scene]")?.dataset.scene || null; const wk = document.querySelector("#homeWalk")?.getBoundingClientRect(); window.__ts.push({ t, sc, nameBottom: sc === "name" ? inkOf(document.querySelector("#namePiggy"))[3] : null, walkFoot: sc === "sendstay" && window.__ts.filter((x) => x.walkFoot != null).length < 2 ? walkInk() : null, walkBottom: sc === "sendstay" && wk && wk.height > 2 ? wk.bottom : null }); if (t < 3600) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    await sleep(200);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    await sleep(3800);
    const ts = await p.evaluate(() => window.__ts);
    const lastName = [...ts].reverse().find((r) => r.nameBottom != null);
    const firstWalk = ts.find((r) => r.walkFoot != null);
    const bottoms = ts.filter((r) => r.walkBottom != null && r.t < ts.find((q) => q.sc === "sendstay").t + 3000).map((r) => r.walkBottom);
    let reversals = 0; for (let i = 1; i < bottoms.length; i += 1) if (bottoms[i] < bottoms[i - 1] - 0.5) reversals += 1;
    const blank = ts.filter((r) => r.sc === "sendstay").findIndex((r) => r.walkBottom != null);
    save(`ui12_${w}.json`, { w, hh, lastNameFoot: lastName.nameBottom, firstWalkFoot: firstWalk.walkFoot, footStep: firstWalk.walkFoot - lastName.nameBottom, walkReversals: reversals, framesWithoutPiggy: blank, samples: ts.length });
    check(`UI-12 @${w}: Piggy walk path monotone (0 reversals), foot step at swap <= 6 px, <= 4 frames without Piggy [UNKNOWN user observation: not reproduced]`, () => { assert.equal(reversals, 0); assert.ok(Math.abs(firstWalk.walkFoot - lastName.nameBottom) <= 6, `step ${firstWalk.walkFoot - lastName.nameBottom}`); assert.ok(blank >= 0 && blank <= 4, `blank ${blank}`); });
  } finally { await h.close(); }
}

async function runBrowser() {
  const H = await import("./helpers/a803-browser.mjs");
  if (!H.harnessPresent()) { console.log("SKIP browser - local harness absent"); return; }
  const sizes = process.env.A841_SIZES
    ? process.env.A841_SIZES.split(" ").map(s => s.split("x").map(Number))
    : [[390, 844], [810, 1080], [1440, 900]];
  if (process.env.A841_ONLY_NAME === "1") {
    for (const [w, hh] of sizes) await runUI12(w, hh);
    return;
  }
  const { sleep } = H;
  const h = await H.launch({ forkMode: true });
  const p = h.p;
  try {
    await h.seedSolo();
    await p.setViewportSize({ width: 1440, height: 900 }); await p.reload({ waitUntil: "networkidle" }); await sleep(600); await h.unlock(); await h.waitScene(["sendstay"], 9000); await sleep(1500);
    if (await p.locator("#stayButton").isVisible()) { await p.locator("#stayButton").click(); await sleep(1500); }
    await p.waitForSelector('.homeLiving .homeAmbient__idle #eye_L', {timeout:5000});
    // ── UI-27 runtime: 9 s series of eye height, ink bottom, scaleY ──
    const series = await p.evaluate(async () => {
      const out = []; const t0 = performance.now();
      const art = document.querySelector(".homeLiving .homeAmbient__idle");
      const wrap = document.querySelector(".homeLiving__breath");
      const eye = art?.querySelector("#eye_L");
      const ink = () => { let b = -1e9; art.querySelectorAll("path,ellipse,circle,rect,polygon").forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.bottom > b) b = r.bottom; }); return b; };
      while (performance.now() - t0 < 9500) {
        out.push({ t: +((performance.now() - t0) / 1000).toFixed(3), eyeH: +eye.getBoundingClientRect().height.toFixed(2), inkBottom: +ink().toFixed(3), sy: wrap.style.transform });
        await new Promise((r) => requestAnimationFrame(r));
      }
      return out;
    });
    save("ui27_series_1440.json", series);
    const state = await p.evaluate(() => { const e = document.querySelector(".homeLiving"); return { vis: getComputedStyle(e).visibility, attr: document.querySelector("#homeChar")?.dataset.ambientSeat || null, seatVis: getComputedStyle(document.querySelector("#homeSeat")).visibility }; });
    await check_("UI-27 runtime: awake solo layer visible, #homeSeat steps aside", () => { assert.deepEqual(state, { vis: "visible", attr: "1", seatVis: "hidden" }); });
    const maxH = Math.max(...series.map((r) => r.eyeH));
    let blinks = 0, low = false;
    for (const r of series) { const isLow = r.eyeH < maxH * 0.5; if (isLow && !low) blinks += 1; low = isLow; }
    await check_("UI-27 runtime: >= 2 blinks in 9.5 s", () => assert.ok(blinks >= 2, `blinks=${blinks}`));
    const bottoms = series.map((r) => r.inkBottom);
    const dBottom = Math.max(...bottoms) - Math.min(...bottoms);
    const sys = series.map((r) => Number((/scale\([^,]+, ([\d.]+)\)/.exec(r.sy) || [])[1] || 1));
    await check_("UI-27 runtime: breath visible (scaleY range >= 0.01) and ink bottom delta <= 0.5 px", () => { assert.ok(Math.max(...sys) - Math.min(...sys) >= 0.01, "no breath"); assert.ok(dBottom <= 0.5, `bottom delta ${dBottom}`); });
    save("ui27_summary.json", { blinks, dBottom, scaleY: [Math.min(...sys), Math.max(...sys)] });
    // reduced motion: static
    await p.emulateMedia({ reducedMotion: "reduce" }); await p.reload({ waitUntil: "networkidle" }); await sleep(600); await h.unlock(); await h.waitScene(["sendstay"], 9000); await sleep(1500);
    if (await p.locator("#stayButton").isVisible()) { await p.locator("#stayButton").click(); await sleep(1500); }
    const red = await p.evaluate(async () => { const w = document.querySelector(".homeLiving__breath"); const a = [w?.style.transform || "", getComputedStyle(document.querySelector(".homeLiving")).visibility]; await new Promise((r) => setTimeout(r, 2500)); a.push(w?.style.transform || ""); return a; });
    await check_("UI-27 reduced motion: layer visible, no breath transform, identical 2.5 s apart", () => { assert.equal(red[0], ""); assert.equal(red[2], ""); assert.equal(red[1], "visible"); });
    await p.emulateMedia({ reducedMotion: "no-preference" });
  } catch (e) { fail++; console.log("FAIL UI-27 browser setup/measurement:", e.message.split("\n")[0]); }
  finally { await h.close?.(); }
  for (const [w, hh] of sizes) await runUI12(w, hh);
}
async function check_(name, fn) { await check(name, fn); }
if (process.env.ARASO_TEST_BROWSER === "1") await runBrowser(); else console.log("SKIP browser sections (ARASO_TEST_BROWSER=1)");
console.log(fail ? `FAIL ${fail}` : "ALL PASS");
process.exit(fail ? 1 : 0);
