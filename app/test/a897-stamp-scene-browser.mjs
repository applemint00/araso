// A-897 P2 — Promotion stamp scene (Owner 2026-10-08, mock stamp_alpha_mock_v2.png B adopted) + the two new Chog squint parts.
// Part N (node): pure timeline, markup, assets (sizes), mount against a minimal fake DOM, main.js [A-897 P2] entry, CSS contract.
// Part B (browser, local vite + Playwright from the local harness; A897_NODE_ONLY=1 skips it, the runner sets it unless
//   ARASO_TEST_BROWSER=1): B1 stamp scene at 390x844 / 1440x900 (alpha! outside-right of the stamp, Chog inside the frame, > <
//   eyes, arm <= 14 deg, ~2 s, removed once, onDone once), B2 reduced motion, B3 unnamed row tap area + tap-to-fill at 390 / 1440.
//   Part B has not been run by the P2 writer (no browser in its sandbox) — the coordinator runs it.
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const rd = (p) => readFileSync(path.join(REPO, p), "utf8");
const MAIN = rd("app/src/main.js");
const CSS = rd("app/src/style.css");
let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 6).join("\n      ")}`); fail += 1; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const between = (src, a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `block ${a}`); return src.slice(i, j); };
const png = (p) => { const b = readFileSync(path.join(REPO, p)); assert.equal(b.subarray(1, 4).toString(), "PNG"); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

const S = await import("../src/promotion-stamp.js");
const T = S.PROMOTION_STAMP_TIMELINE;

// ═══ Part N ═══
await check("N1 timeline: ~2 s; press 0-260; squint at 420; arm only inside 520-1420 and never beyond 14 deg; alpha! written 760-1160; page turn 1560-2000; done at 2000", () => {
  assert.equal(T.totalMs, 2000);
  const f0 = S.promotionStampFrame(0);
  assert.deepEqual([f0.squint, f0.alphaReveal, f0.turn, f0.done], [false, 0, 0, false]);
  assert.ok(f0.stampScale > 1 && f0.stampOpacity === 0);
  const f1 = S.promotionStampFrame(260);
  assert.ok(f1.stampScale === 1 && f1.stampOpacity === 1);
  assert.equal(S.promotionStampFrame(419).squint, false);
  assert.equal(S.promotionStampFrame(420).squint, true);
  let max = 0;
  for (let t = 0; t <= 2100; t += 5) {
    const f = S.promotionStampFrame(t);
    max = Math.max(max, Math.abs(f.armDeg));
    if (t < T.waveFromMs || t > T.waveToMs) assert.equal(f.armDeg, 0, `arm rests outside the wave window @${t}`);
  }
  assert.ok(max <= 14.0001 && max > 13, `peak arm angle ${max} (mock ~14)`);
  assert.equal(S.promotionStampFrame(759).alphaReveal, 0);
  assert.equal(S.promotionStampFrame(1160).alphaReveal, 1);
  assert.equal(S.promotionStampFrame(1559).turn, 0);
  assert.equal(S.promotionStampFrame(2000).turn, 1);
  assert.equal(S.promotionStampFrame(1999).done, false);
  assert.equal(S.promotionStampFrame(2000).done, true);
  // monotone reveal and turn
  let a = 0, b = 0;
  for (let t = 0; t <= 2000; t += 10) { const f = S.promotionStampFrame(t); assert.ok(f.alphaReveal >= a && f.turn >= b); a = f.alphaReveal; b = f.turn; }
});
await check("N2 reduced motion: complete scene at once (squint + alpha!, no arm / turn), ends after the hold", () => {
  const f = S.promotionStampFrame(0, { reduced: true });
  assert.deepEqual([f.squint, f.alphaReveal, f.armDeg, f.turn, f.stampScale, f.done], [true, 1, 0, 0, 1, false]);
  assert.equal(S.promotionStampFrame(T.reducedHoldMs, { reduced: true }).done, true);
});
await check("N3 markup: 'alpha!' is the only copy; it is OUTSIDE the stamp (sibling to its right), no tape / sparkle / burst / trail art; Chog parts reuse the Invite Chog markup", () => {
  assert.equal(S.PROMOTION_STAMP_TEXT, "alpha!");
  const m = S.promotionStampMarkup();
  const stampOpen = m.indexOf('data-ps-stamp');
  const stampClose = m.indexOf("</picture>");
  const alphaAt = m.indexOf('data-ps-alpha');
  assert.ok(stampOpen > 0 && alphaAt > m.indexOf('<div class="promotionStamp__chog">'), "alpha span comes after the stamp block");
  assert.ok(m.indexOf('class="promotionStamp__chog"') < alphaAt && m.lastIndexOf("</div>", alphaAt) > stampClose, "span is not nested inside the stamp div");
  assert.equal(/tape|spark|burst|trail|postmark|waves/i.test(m), false);
  const text = m.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  assert.equal(text, "alpha!");
  assert.match(m, /src="\/invite\/wide\/stamp_empty@2x\.png"/, "the larger 126x134 art at every width (M2)");
  assert.equal(/<picture|srcset/.test(m), false);
  for (const part of ["body", "arm", "head", "eye-left", "eye-right"]) assert.ok(m.includes(`data-part="${part}"`), part);
});
await check("N4 assets: stamp_empty keeps the stamp's exact canvas (mobile 90x96, wide 126x134); squint parts keep the eye canvas 278x334; every referenced file exists", () => {
  assert.deepEqual(png("app/public/invite/stamp_empty@2x.png"), png("app/public/invite/stamp@2x.png"));
  assert.deepEqual(png("app/public/invite/wide/stamp_empty@2x.png"), png("app/public/invite/wide/stamp@2x.png"));
  assert.deepEqual(png("app/public/motion/chog-invite/eye-left-squint.png"), png("app/public/motion/chog-invite/eye-left.png"));
  assert.deepEqual(png("app/public/motion/chog-invite/eye-right-squint.png"), png("app/public/motion/chog-invite/eye-right.png"));
  assert.deepEqual(png("app/public/motion/chog-invite/eye-left-squint.png"), { w: 278, h: 334 });
  for (const f of ["app/public/invite/stamp_empty@2x.png", "app/public/invite/wide/stamp_empty@2x.png", "app/public/motion/chog-invite/eye-left-squint.png", "app/public/motion/chog-invite/eye-right-squint.png"]) assert.ok(existsSync(path.join(REPO, f)), f);
  // the squint swap is exactly the two eye parts — head / arm / body parts are not replaced
  const src = rd("app/src/promotion-stamp.js");
  assert.match(src, /"eye-left": "\/motion\/chog-invite\/eye-left-squint\.png"/);
  assert.equal(/head-squint|arm-squint|body-squint/.test(src), false);
});

// minimal fake DOM — enough for mountPromotionStamp + the real mountChogInvite
function fakeEl(extra = {}) {
  const attrs = new Map();
  const el = { style: {}, offsetWidth: 178, attrs, setAttribute(k, v) { attrs.set(k, String(v)); }, getAttribute: (k) => attrs.get(k), getBoundingClientRect: () => ({ width: 178, height: 214 }), remove() { el.removed = true; }, dataset: {}, ...extra };
  return el;
}
function fakeScene() {
  const parts = {};
  for (const p of ["body", "arm", "head", "eye-left", "eye-right"]) parts[p] = fakeEl();
  const chogRoot = fakeEl({ querySelector: (sel) => parts[/data-part="([^"]+)"/.exec(sel)?.[1]] || null });
  const page = fakeEl(); const stamp = fakeEl(); const alpha = fakeEl();
  const root = fakeEl({ querySelector: (sel) => ({ "[data-ps-page]": page, "[data-ps-stamp]": stamp, "[data-ps-alpha]": alpha, "[data-chog-invite]": chogRoot })[sel] || null });
  return { root, parts, page, stamp, alpha, chogRoot };
}
function fakeClock() {
  let q = []; let id = 0; let cancelled = new Set();
  return {
    raf: (fn) => { id += 1; q.push([id, fn]); return id; },
    caf: (h) => cancelled.add(h),
    run(ms, step = 16) { let t = 0; let guard = 0; while (guard++ < 5000) { const cur = q; q = []; if (!cur.length) break; t += step; for (const [h, fn] of cur) if (!cancelled.has(h)) fn(t); if (t > ms) break; } return t; },
  };
}
await check("N5 mount drives the real Invite Chog without its idle loop: eyes swap at 420, arm rotates <=14 deg from the same shoulder translate, alpha! clips in, page turns, onDone exactly once, no timers", () => {
  const sc = fakeScene(); const clk = fakeClock(); let done = 0;
  const h = S.mountPromotionStamp(sc.root, { raf: clk.raf, caf: clk.caf, onDone: () => { done += 1; } });
  assert.equal(sc.parts["eye-left"].getAttribute("src"), undefined, "eyes untouched before the swap");
  clk.run(300);
  assert.equal(sc.parts["eye-left"].getAttribute("src"), undefined);
  clk.run(700);
  assert.equal(sc.parts["eye-left"].getAttribute("src"), "/motion/chog-invite/eye-left-squint.png");
  assert.equal(sc.parts["eye-right"].getAttribute("src"), "/motion/chog-invite/eye-right-squint.png");
  assert.equal(sc.root.getAttribute("data-squint"), "1");
  const m = /rotate\((-?[\d.]+)deg\)/.exec(sc.parts.arm.style.transform);
  assert.ok(m && Math.abs(Number(m[1])) <= 14.0001, sc.parts.arm.style.transform);
  assert.match(sc.parts.arm.style.transform, /^translate\(-?[\d.]+px, -?[\d.]+px\) rotate\(/);
  clk.run(3000);
  assert.equal(done, 1);
  assert.equal(h.finished, true);
  assert.equal(sc.alpha.style.clipPath, "none");
  assert.match(sc.page.style.transform, /^perspective\(1200px\) rotateY\(100deg\)$/, "B2: recedes (+), same shape at every width");
  sc.page.offsetWidth = 1440; S.mountPromotionStamp(sc.root, { raf: clk.raf, caf: clk.caf }).frameAt(2000);
  assert.match(sc.page.style.transform, /^perspective\(4320px\) rotateY\(100deg\)$/, "perspective follows the page width (3 x)");
  h.destroy();
  clk.run(500);
  assert.equal(done, 1, "never twice");
});
await check("N6 reduced mount: final scene painted at once, ends after the hold, onDone once", () => {
  const sc = fakeScene(); const clk = fakeClock(); let done = 0;
  S.mountPromotionStamp(sc.root, { reduced: true, raf: clk.raf, caf: clk.caf, onDone: () => { done += 1; } });
  assert.equal(sc.parts["eye-left"].getAttribute("src"), "/motion/chog-invite/eye-left-squint.png");
  assert.equal(sc.alpha.style.clipPath, "none");
  assert.equal(sc.page.style.transform, "");
  clk.run(2000);
  assert.equal(done, 1);
});
await check("N7 destroy before the end cancels everything: no onDone", () => {
  const sc = fakeScene(); const clk = fakeClock(); let done = 0;
  const h = S.mountPromotionStamp(sc.root, { raf: clk.raf, caf: clk.caf, onDone: () => { done += 1; } });
  clk.run(500); h.destroy(); clk.run(3000);
  assert.equal(done, 0);
});

await check("N8 main.js: playPromotionStampScene is a plain function P1 can call (mountable without P1); once-only per chain scope; overlay on body; onDone after removal; not called from anywhere in P2", async () => {
  const blk = between(MAIN, "function a897StampCleanup()", "function a897NameFillInfo(");
  assert.match(MAIN, /^function playPromotionStampScene\(\{ onDone \} = \{\}\) \{/m);
  // [A-897 merge follow-up · pre-A-897 merge baseline: 1 (definition only)] P1 now adds exactly one guarded call site, inside its own block.
  const codeOnly = MAIN.replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.equal((codeOnly.match(/playPromotionStampScene\(/g) || []).length, 2, "definition + P1's single call");
  const p1 = between(MAIN, "// ── [A-897] P1 Release-2", "// ── [A-897] end P1");
  assert.equal((p1.replace(/(^|[^:"'`])\/\/.*$/gm, "$1").match(/playPromotionStampScene\(/g) || []).length, 1, "the call site is inside the P1 block");
  assert.match(p1, /typeof playPromotionStampScene === "function"/, "guarded");
  const vm = await import("node:vm");
  const mk = ({ played = false } = {}) => {
    const store = new Map(played ? [["araso.promotionStampPlayed.v1.monad-testnet", "1"]] : []);
    const body = []; const mounts = [];
    const sandbox = {
      A897_STAMP_PLAYED_KEY: "araso.promotionStampPlayed.v1.",
      safeLocalStorage: () => ({ getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) }),
      secondJourneyScope: () => ({ chainId: "monad-testnet" }),
      prefersReducedMotion: () => false,
      promotionStampMarkup: () => "<x/>",
      document: { createElement: () => ({ set innerHTML(v) { this.firstElementChild = { remove() { this.gone = true; }, v }; } }), body: { appendChild: (e) => body.push(e) } },
      mountPromotionStamp: (root, o) => { mounts.push(o); return { destroy() { this.destroyed = true; } }; },
    };
    vm.runInNewContext(`let a897StampRoot = null; let a897StampHandle = null; ${blk}; globalThis.__play = playPromotionStampScene;`, sandbox);
    return { play: sandbox.__play, store, body, mounts };
  };
  const a = mk(); let done = 0;
  assert.deepEqual({ ...a.play({ onDone: () => { done += 1; } }) }, { played: true, reason: null });
  assert.equal(a.store.get("araso.promotionStampPlayed.v1.monad-testnet"), "1");
  assert.equal(a.body.length, 1);
  assert.equal(a.play({}).reason, "already_running");
  a.mounts[0].onDone();
  assert.equal(done, 1);
  assert.equal(a.body[0].gone, true, "overlay removed before onDone");
  assert.equal(a.play({}).reason, "already_played", "second promotion never replays");
  const b = mk({ played: true });
  assert.deepEqual({ ...b.play({ onDone: () => { throw new Error("must not run"); } }) }, { played: false, reason: "already_played" });
  assert.equal(b.body.length, 0);
});
await check("N9 main.js block uses no network / keys / WebAuthn / scene change; only the stamp module + home-paper seam are imported by P2", () => {
  const blk = between(MAIN, "// ── [A-897 P2] 승격 장면", "// ── [A-897 P2] end");
  assert.equal(/fetch\(|navigator\.credentials|setScene|render\(\)|sendPiggy|claimGift|ethers|rpc/i.test(blk.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")), false);
  const imp = between(MAIN, "// ── [A-897] P2 imports", "// ── [A-897] end P2 imports");
  assert.deepEqual(imp.split("\n").filter((l) => l.startsWith("import")), [
    'import { promotionStampMarkup, mountPromotionStamp } from "./promotion-stamp.js";',
    'import { setUnnamedNameFill, applyUnnamedNameRows } from "./home-paper.js";',
  ]);
  assert.equal(/\/\*|\*\//.test(blk + imp), false, "no block comments in main.js additions (an older stray `/*` in main.js makes stripComments-based pins swallow code)");
});
await check("N10 CSS contract: alpha! = accent yellow #e0b100 in the Chog hand font, to the stamp's right (flex row), no tape/spark art; root transparent, page carries the background; only [A-897] rules; final 640 block still last", () => {
  const b = between(CSS, "/* 승격 장면 — body 위 오버레이", "/* ── [A-897 P2] end");
  assert.match(b, /\.promotionStamp__alpha \{[^}]*font-family: var\(--font-cj\);[^}]*color: #e0b100;/);
  assert.match(b, /\.promotionStamp__group \{[^}]*display: flex;[^}]*align-items: center;/);
  assert.match(b, /\.promotionStamp \{[^}]*background: transparent;/);
  assert.match(b, /\.promotionStamp__page \{[^}]*transform-origin: left center;/);
  assert.equal(/tape|spark|burst/i.test(b.replace(/\/\*[\s\S]*?\*\//g, "")), false);
  assert.ok(CSS.endsWith("@media (max-width: 640px) {\n  .homeLiving__name { display: none; }\n}\n"), "a744 A6 / a827 N6 pin: the a681 block stays last");
});
await check("N10b sizes: alpha! = 0.18 x stamp width (mock B), stamp width follows --fmtS, aspect = the larger art", () => {
  const b = between(CSS, "/* 승격 장면 — body 위 오버레이", "/* ── [A-897 P2] end");
  assert.match(b, /font-size: calc\(var\(--st\) \* 0\.18\);/);
  assert.match(b, /--st: min\(calc\(203px \* var\(--fmtS, 1\)\), 52vw, 44vh\);/);
  assert.match(b, /aspect-ratio: 126 \/ 134;/);
});
await check("N11 PWA head: icon / manifest / apple-touch / 11 splash lines present and every referenced file exists; manifest icons exist", () => {
  const html = rd("app/index.html");
  assert.equal((html.match(/rel="apple-touch-startup-image"/g) || []).length, 11);
  const refs = [...html.matchAll(/href="(\/(?:icons|splash)\/[^"]+)"/g)].map((m) => m[1]);
  assert.equal(refs.length, 11 + 3);
  for (const r of refs) assert.ok(existsSync(path.join(REPO, "app/public", r)), r);
  const man = JSON.parse(rd("app/public/manifest.webmanifest"));
  assert.deepEqual(man.icons.map((i) => [i.sizes, i.purpose || "any"]), [["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"]]);
  for (const i of man.icons) assert.ok(existsSync(path.join(REPO, "app/public", i.src)), i.src);
  // M9: nothing bright of the ear band lies outside the 0.4 safe circle of the maskable icon — checked by the receipt render script; here the canvas only
  assert.deepEqual(png("app/public/icons/apple-touch-icon.png"), { w: 180, h: 180 });
  assert.deepEqual(png("app/public/icons/favicon-16.png"), { w: 16, h: 16 });
  assert.deepEqual(png("app/public/icons/favicon-32.png"), { w: 32, h: 32 });
  assert.deepEqual(png("app/public/icons/icon-192.png"), { w: 192, h: 192 });
  assert.deepEqual(png("app/public/icons/icon-512.png"), { w: 512, h: 512 });
  assert.deepEqual(png("app/public/icons/icon-maskable-512.png"), { w: 512, h: 512 });
  for (const f of [...html.matchAll(/splash-(\d+)x(\d+)\.png/g)]) assert.deepEqual(png(`app/public/splash/${f[0]}`), { w: Number(f[1]), h: Number(f[2]) }, f[0]);
  assert.equal(/viewport-fit=cover/.test(html), true);
});

// ═══ Part B ═══
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer(); srv.unref(); srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
async function runBrowser() {
  if (!existsSync(path.join(REPO, "_private")) && !existsSync(path.join(REPO, "..", "..", "_private"))) { console.log("SKIP  Part B — local browser harness absent"); return; }
  let chromium;
  try {
    const harness = [path.join(REPO, "_private/ops/harness/package.json"), path.join(REPO, "../../ops/harness/package.json")].find((p) => existsSync(p));
    ({ chromium } = createRequire(harness)("playwright"));
  } catch (e) { await check("B0 playwright available (local harness)", () => { throw e; }); return; }
  const port = await freePort();
  const server = spawn(path.join(REPO, "node_modules/.bin/vite"), ["app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], {
    cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", VITE_RELAYER_URL: "__HARNESS_NO_GRANT__" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let browser = null;
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 30000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    const shots = process.env.A897_SHOTS || "";
    if (shots) mkdirSync(shots, { recursive: true });
    browser = await chromium.launch({ headless: true });
    for (const [w, h] of [[390, 844], [1440, 900]]) await stampRun(browser, `http://localhost:${port}/`, shots, w, h, false);
    await stampRun(browser, `http://localhost:${port}/`, shots, 390, 844, true);
    for (const [w, h] of [[390, 844], [1440, 900]]) await unnamedRun(browser, `http://localhost:${port}/`, shots, w, h);
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { server.kill("SIGTERM"); } catch {}
    await sleep(300);
    try { server.kill("SIGKILL"); } catch {}
  }
}
async function newPage(browser, BASE, W, H, reduced) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: reduced ? "reduce" : "no-preference" });
  await context.route("**/*", (route) => (/eth_send|eth_sendRawTransaction|eth_sendUserOperation/.test(route.request().postData() || "") ? route.abort() : route.continue()));
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 200)));
  await p.goto(BASE, { waitUntil: "load" });
  await sleep(800);
  return { context, p, errors };
}
async function stampRun(browser, BASE, shots, W, H, reduced) {
  const tag = `${W}x${H}${reduced ? " reduced" : ""}`;
  const { context, p, errors } = await newPage(browser, BASE, W, H, reduced);
  try {
    await p.evaluate(async () => {
      const m = await import("/src/promotion-stamp.js");
      window.__ps = { done: 0 };
      document.body.insertAdjacentHTML("beforeend", m.promotionStampMarkup());
      const root = document.querySelector(".promotionStamp");
      window.__ps.h = m.mountPromotionStamp(root, { reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, onDone: () => { window.__ps.done += 1; root.remove(); } });
    });
    const probe = () => p.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const arm = document.querySelector('.promotionStamp [data-part="arm"]');
      const m = arm ? /matrix\(([^)]+)\)/.exec(getComputedStyle(arm).transform) : null;
      const ang = m ? Math.atan2(Number(m[1].split(",")[1]), Number(m[1].split(",")[0])) * 180 / Math.PI : null;
      return {
        stamp: r("[data-ps-stamp]"), alpha: r("[data-ps-alpha]"), chog: r(".promotionStamp__chog .chogInvite"), vw: innerWidth, vh: innerHeight, ang,
        eyeSrc: document.querySelector('.promotionStamp [data-part="eye-left"]')?.getAttribute("src") || null,
        alphaColor: document.querySelector("[data-ps-alpha]") ? getComputedStyle(document.querySelector("[data-ps-alpha]")).color : null,
        gone: !document.querySelector(".promotionStamp"), done: window.__ps.done,
      };
    });
    const shot = async (n) => { if (shots) await p.screenshot({ path: path.join(shots, `a897_stamp_${W}_${reduced ? "rm_" : ""}${n}.png`) }); };
    const t0 = Date.now();
    await sleep(reduced ? 200 : 1250);
    const mid = await probe();
    await shot("mid");
    await check(`B1 [${tag}] stamp, Chog inside the frame, alpha! outside-right of the stamp and inside the viewport, yellow, > < eyes`, () => {
      assert.ok(mid.stamp && mid.stamp.w > 100, "stamp drawn");
      assert.ok(mid.alpha.l >= mid.stamp.r - 1, `alpha! is to the stamp's right (${mid.alpha.l} >= ${mid.stamp.r})`);
      assert.ok(mid.alpha.r <= mid.vw + 0.5 && mid.stamp.l >= -0.5, "group fits the viewport");
      assert.ok(mid.chog.l >= mid.stamp.l && mid.chog.r <= mid.stamp.r + 1 && mid.chog.t >= mid.stamp.t - 12 && mid.chog.b <= mid.stamp.b, "Chog box is inside the stamp frame");
      assert.ok(mid.chog.h > mid.stamp.h * 0.6, "Chog is bigger than the old still drawing");
      assert.equal(mid.alphaColor, "rgb(224, 177, 0)");
      assert.equal(mid.eyeSrc, "/motion/chog-invite/eye-left-squint.png");
      if (!reduced) assert.ok(Math.abs(mid.ang) <= 14.6, `arm angle ${mid.ang}`);
    });
    if (!reduced) await check(`B1b [${tag}] ~2 s, removed once, onDone once, no page errors`, async () => {
      const t = Date.now() - t0;
      for (let i = 0; i < 30 && !(await probe()).gone; i += 1) await sleep(100);
      const end = await probe();
      assert.equal(end.gone, true); assert.equal(end.done, 1);
      assert.ok(Date.now() - t0 >= 1800 && Date.now() - t0 < 3500, `scene lasted ${Date.now() - t0} ms (t=${t})`);
      assert.deepEqual(errors, []);
    });
    else await check(`B2 [${tag}] reduced motion: complete scene, ends once`, async () => {
      for (let i = 0; i < 30 && !(await probe()).gone; i += 1) await sleep(100);
      assert.equal((await probe()).done, 1);
      assert.deepEqual(errors, []);
    });
  } catch (e) {
    await check(`B [${tag}] stamp flow`, () => { throw e; });
  } finally { await context.close(); }
}
async function unnamedRun(browser, BASE, shots, W, H) {
  const tag = `${W}x${H}`;
  const { context, p, errors } = await newPage(browser, BASE, W, H, false);
  try {
    await p.evaluate(async () => {
      const hp = await import("/src/home-paper.js");
      document.body.insertAdjacentHTML("beforeend", `<div id="a897fx" style="position:fixed;inset:0;z-index:5000">${hp.homePaperMarkup({ mode: "home", name: "Piggy", residents: [{ id: "p1", name: "", unnamed: true, label: "", recordsEntryMarkup: "" }, { id: "p2", name: "Bebe", label: "", recordsEntryMarkup: "" }] })}</div>`);
      window.__fill = { saved: [] };
      hp.setUnnamedNameFill({ isUnnamed: (c) => c.dataset.piggyId === "p1", save: (c, n) => { window.__fill.saved.push([c.dataset.piggyId, n]); return true; } });
      hp.applyUnnamedNameRows(document.querySelector("#a897fx .homePaper"));
    });
    await p.evaluate(() => { const i = document.querySelector("#a897fx .homePaper__nameUnderline"); return i.complete ? 0 : i.decode().catch(() => 0); });
    const row = await p.evaluate(() => {
      const b = document.querySelector('#a897fx [data-name-fill="underline"]'); const bb = b.getBoundingClientRect(); const cs = getComputedStyle(b);
      const named = document.querySelectorAll("#a897fx .homePaper__name:not([data-name-fill])").length;
      const after = getComputedStyle(b, "::after");
      const imgEl = b.querySelector("img");
      const img = imgEl.getBoundingClientRect();
      return { w: bb.width, h: bb.height, lh: b.offsetHeight, fs: parseFloat(cs.fontSize), pe: cs.pointerEvents, named, imgW: img.width, imgDone: b.querySelector("img").naturalWidth, afterInset: after.inset };
    });
    await check(`B3 [${tag}] unnamed row: yellow underline in the name slot, button only on the unnamed row, named row stays a plain div`, () => {
      assert.ok(row.imgDone > 0 && row.imgW > 20, "underline asset loaded and drawn");
      assert.equal(row.pe, "auto");
      assert.equal(row.named, 1, "the named Piggy keeps its plain name div");
      assert.ok(row.lh >= row.fs * 1.1 && row.lh <= row.fs * 1.4, `row height is em-based (layout ${row.lh} vs font ${row.fs}; the paper is scaled so getBoundingClientRect is not comparable)`);
      assert.ok(row.fs >= 20, `row inherits the name font (${row.fs}px), not the 16px button default`);
    });
    if (shots) await p.screenshot({ path: path.join(shots, `a897_unnamed_${W}_row.png`) });
    await p.locator('#a897fx [data-name-fill="underline"]').click();
    await check(`B3b [${tag}] tap -> in-place input focused (Name-it grammar), save disabled until text, Enter saves once with the typed name`, async () => {
      assert.equal(await p.evaluate(() => document.activeElement?.className), "homePaper__nameInput");
      assert.equal(await p.evaluate(() => document.querySelector(".homePaper__nameSave").disabled), true);
      await p.keyboard.type("Mochi");
      assert.equal(await p.evaluate(() => document.querySelector(".homePaper__nameSave").disabled), false);
      if (shots) await p.screenshot({ path: path.join(shots, `a897_unnamed_${W}_input.png`) });
      await p.keyboard.press("Enter");
      await sleep(100);
      assert.deepEqual(await p.evaluate(() => window.__fill.saved), [["p1", "Mochi"]]);
      assert.deepEqual(errors, []);
    });
  } catch (e) {
    await check(`B [${tag}] unnamed flow`, () => { throw e; });
  } finally { await context.close(); }
}

if (process.env.A897_NODE_ONLY === "1") console.log("SKIP  Part B (A897_NODE_ONLY=1; run with ARASO_TEST_BROWSER=1)");
else await runBrowser();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
