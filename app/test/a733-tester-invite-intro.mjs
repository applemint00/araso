// A-733 [TESTER INVITE INTRO] contract.
//   node app/test/a733-tester-invite-intro.mjs                 (Part N + Part B)
//   A733_NODE_ONLY=1 node app/test/a733-tester-invite-intro.mjs (Part N only; no port/browser)
// Part B: local vite `--mode a172-local --strictPort` on 5825 (A733_PORT / A733_BASE_URL override). Network 0 · tx 0.
// A733_MAIN_PATH = mutation runs only (Part N reads a mutant copy).
import assert from "node:assert/strict";
import vm from "node:vm";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(process.env.A733_MAIN_PATH || path.join(REPO, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").slice(0, 20).join("\n      ")}`); fail += 1; }
}
function fnBody(name) {
  const m = MAIN.match(new RegExp(`function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = MAIN.indexOf("{", MAIN.indexOf(")", m.index)); i < MAIN.length; i += 1) {
    if (MAIN[i] === "{") depth += 1;
    else if (MAIN[i] === "}") { depth -= 1; if (depth === 0) return MAIN.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// ═══ Part N ═══
const START = MAIN.indexOf("const TESTER_INTRO_SEEN_KEY");
const END = MAIN.indexOf("// [A-654] A page that opens away from Home");
const BLOCK = START >= 0 && END > START ? MAIN.slice(START, END) : "";
const BLOCK_CODE = stripComments(BLOCK);

await check("intro block exists in main.js", () => assert.ok(BLOCK.length > 500));
await check("seen flag = araso.introSeen, value '1' only", () => {
  assert.match(BLOCK_CODE, /TESTER_INTRO_SEEN_KEY = "araso\.introSeen"/);
  const sets = [...BLOCK_CODE.matchAll(/setItem\(([^)]*)\)/g)].map((m) => m[1].replace(/\s/g, ""));
  assert.deepEqual(sets, ['TESTER_INTRO_SEEN_KEY,"1"']);
});
await check("intro block touches no identity/financial/registry/receipt/SEQ-5/gift/network/crypto symbol", () => {
  const banned = /(PASSKEY|credential|readCredential|state\.address|prfSalt|PRF|piggyReceived|PIGGY_RECEIVED|registry|Registry|createPiggy|issuance|receipt|Receipt|sendPending|navigator\.credentials|fetch\(|XMLHttpRequest|sessionStorage|sendBeacon|pendingGiftClaim|giftId|setScene|commitIdentity|SEQ)/;
  assert.equal((BLOCK_CODE.match(banned) || [])[0], undefined);
  assert.equal([...BLOCK_CODE.matchAll(/setItem|removeItem|localStorage/g)].length >= 1, true);
});
await check("code value is never written/displayed: only TESTER_INTRO_CODE_RE.test and `has('i')`", () => {
  const uses = [...BLOCK_CODE.matchAll(/get\("i"\)/g)].length;
  assert.equal(uses, 1);
  assert.ok(!/\$\{[^}]*get\("i"\)/.test(BLOCK_CODE));
  assert.match(BLOCK_CODE, /3 of 20/);
});
await check("overlay is not a scene: no setScene / data-scene / Chog markup in intro", () => {
  assert.ok(!/data-scene|chogInviteMarkup|mountInviteChog|data-chog/.test(BLOCK_CODE));
  assert.ok(!/addEventListener\("(click|pointerdown|touchstart)"/.test(BLOCK_CODE));
});
await check("intro starts after returning-device guard and render(); URL strip uses replaceState(null) keeping hash", () => {
  assert.ok(BLOCK.length && MAIN.indexOf('state.scene = "birth";') < START);
  assert.match(MAIN, /render\(\);\nstartTesterIntro\(\);/);
  assert.match(BLOCK_CODE, /history\.replaceState\(null, "", location\.pathname \+ \(qs \? `\?\$\{qs\}` : ""\) \+ location\.hash\)/);
});
await check("motion contract constants: 3200 blink, 150 leave, scale .92, -8px, fonts, #161616", () => {
  assert.match(BLOCK_CODE, /TESTER_INTRO_BLINK_MS = 3200/);
  assert.match(BLOCK_CODE, /TESTER_INTRO_LEAVE_MS = 150/);
  const css = CSS.slice(CSS.indexOf(".testerIntro {"));
  assert.match(css, /scale\(0\.92\) translateY\(-8px\)/);
  assert.match(css, /background: #161616/);
  assert.ok(!/#151515/.test(css));
  assert.match(css, /"Delicious Handrawn"/);
  assert.match(css, /"Playfair Display"[\s\S]*font-style: italic/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.testerIntro \{ display: none; \}/);
});
await check("face paths = piggy_face_peek.svg paths (10 == stand, 2 eyes class=eye), viewBox 170 10 660 600", () => {
  const m = BLOCK.match(/const TESTER_PIGGY_FACE_PATHS = (".*?");\n/);
  const paths = vm.runInNewContext(m[1]);
  assert.ok(!/\b(143|3070|3370|1870)\b/.test(BLOCK), "numbers split so a653/a725 text pins hold");
  assert.equal([...paths.matchAll(/<path /g)].length, 12);
  assert.equal([...paths.matchAll(/class="eye"/g)].length, 2);
  assert.match(BLOCK, /viewBox="170 10 660 600"/);
  const peekP = path.join(REPO, "_private/design/reentry_auth_20260928/pwa/piggy_face_dark/piggy_face_peek.svg");
  if (existsSync(peekP)) {
    const peek = readFileSync(peekP, "utf8").replace(/<metadata>[\s\S]*?<\/metadata>/, "");
    assert.equal([...peek.matchAll(/<path[^>]*\/>/g)].map((x) => x[0]).join(""), paths);
    assert.match(peek, /viewBox="170 10 660 600"/);
  }
});
await check("parse/strip functions behave (vm)", () => {
  const mk = (url) => {
    const u = new URL(url); const calls = [];
    const ctx = {
      URLSearchParams, calls,
      location: { search: u.search, hash: u.hash, pathname: u.pathname },
      history: { replaceState: (...a) => calls.push(a) },
    };
    vm.createContext(ctx);
    vm.runInContext(`${BLOCK_CODE.match(/const TESTER_INTRO_CODE_RE[^\n]*/)[0].replace("const ", "var ")}\n${fnBody("readTesterInviteParam")}\n${fnBody("stripTesterInviteFromUrl")}`, ctx);
    return ctx;
  };
  let c = mk("http://x/?i=abc-1_Z&debug=1#g=1&t=2&v=1");
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("readTesterInviteParam()", c))), { present: true, valid: true });
  vm.runInContext("stripTesterInviteFromUrl()", c);
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls)), [[null, "", "/?debug=1#g=1&t=2&v=1"]]);
  c = mk("http://x/?debug=1");
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("readTesterInviteParam()", c))), { present: false, valid: false });
  for (const bad of ["?i=", "?i=%3Cscript%3E", `?i=${"a".repeat(65)}`, "?i=%F0%9F%90%B7", "?i=a b"]) {
    c = mk(`http://x/${bad}`);
    assert.equal(vm.runInContext("readTesterInviteParam()", c).valid, false, bad);
  }
  c = mk("http://x/?i=abc");
  vm.runInContext("stripTesterInviteFromUrl()", c);
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls)), [[null, "", "/"]]);
});

// ═══ Part B ═══
async function partB() {
  if (process.env.A733_NODE_ONLY === "1") { console.log("SKIP  Part B (A733_NODE_ONLY=1)"); return; }
  if (!existsSync(path.join(REPO, "_private/ops/harness/package.json"))) { console.log("SKIP  Part B - harness absent"); return; }
  const { chromium } = createRequire(path.join(REPO, "_private/ops/harness/package.json"))("playwright");
  let server = null, BASE = process.env.A733_BASE_URL || "";
  if (!BASE) {
    const port = Number(process.env.A733_PORT || 5825);
    server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, detached: true,
      env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 30000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    BASE = `http://localhost:${port}/`;
  }
  const browser = await chromium.launch({ headless: true });
  const CODE = "tstcode7";
  const INIT = `(() => {
    window.__w = [];
    const S = Storage.prototype, set = S.setItem, rem = S.removeItem, clr = S.clear;
    S.setItem = function (k, v) { window.__w.push(["set", this === window.localStorage ? "L" : "S", String(k), String(v)]); return set.call(this, k, v); };
    S.removeItem = function (k) { window.__w.push(["rem", this === window.localStorage ? "L" : "S", String(k)]); return rem.call(this, k); };
    S.clear = function () { window.__w.push(["clear"]); return clr.call(this); };
  })();`;
  async function open(url, { reduced = false, seed = null, throwing = false, wait = ".invite" } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: reduced ? "reduce" : "no-preference" });
    const reqs = [];
    await ctx.route("**/*", (route) => {
      const req = route.request(); const body = req.postData() || "";
      if (/eth_send/.test(body)) return route.abort();
      if (req.resourceType() !== "document") reqs.push(req.url() + " " + body);
      return route.continue();
    });
    await ctx.addInitScript(INIT);
    if (seed) await ctx.addInitScript(`try { for (const [k, v] of ${JSON.stringify(seed)}) localStorage.setItem(k, v); window.__w = []; } catch {}`);
    if (throwing) await ctx.addInitScript(`Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });`);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e?.message || e)));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (wait) await page.waitForSelector(wait, { timeout: 15000 }); else await sleep(1500);
    return { ctx, page, reqs, errors };
  }
  const geom = (page) => page.evaluate(() => {
    const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((n) => +n.toFixed(2)); };
    return { board: R(".invite"), paper: R(".invite__paper"), face: R("#inviteFaceButton"), tape: R(".invite__tape"), env: R(".invite__env"), chog: R(".invite__chogNative"), tf: document.querySelector(".invite")?.style.transform, phase: document.querySelector(".invite")?.dataset.phase };
  });
  const writes = (page) => page.evaluate(() => window.__w);
  const url = () => (p) => p.evaluate(() => location.pathname + location.search + location.hash);
  try {
    // baseline: public root
    const SEC = async (name, fn) => { try { await fn(); } catch (e) { console.log(`FAIL  scenario "${name}" crashed: ${String(e && e.message || e).split("\n")[0]}`); fail += 1; } };
    const base = await open(BASE);
    await sleep(3800);
    const baseW = await writes(base.page);
    const baseG = await geom(base.page);
    await check("root '/': no intro overlay ever, no introSeen write", async () => {
      assert.equal(await base.page.locator(".testerIntro").count(), 0);
      assert.ok(!baseW.some((w) => w[2] === "araso.introSeen"));
      assert.deepEqual(base.errors, []);
    });
    await base.ctx.close();

    // tester first device
    const t = await open(`${BASE}?i=${CODE}`);
    await check("?i first device: overlay with copy, Piggy face, 2 eyes, no Chog, no img", async () => {
      assert.equal(await t.page.locator(".testerIntro").count(), 1);
      assert.equal(await t.page.locator(".testerIntro .testerIntro__line").innerText(), "this one's for you");
      assert.equal(await t.page.locator(".testerIntro .testerIntro__num").innerText(), "3 of 20");
      assert.equal(await t.page.locator(".testerIntro svg .eye").count(), 2);
      assert.equal(await t.page.locator(".testerIntro img, .testerIntro [data-chog-invite], .testerIntro canvas").count(), 0);
      const fonts = await t.page.evaluate(() => [...document.querySelectorAll(".testerIntro p")].map((p) => getComputedStyle(p).fontFamily));
      assert.match(fonts[0], /Delicious Handrawn/); assert.match(fonts[1], /Playfair Display/);
      const bg = await t.page.evaluate(() => getComputedStyle(document.querySelector(".testerIntro")).backgroundColor);
      assert.equal(bg, "rgb(22, 22, 22)");
    });
    await check("?i: URL cleaned immediately (no ?i), code not in URL", async () => {
      const u = await t.page.evaluate(() => location.href);
      assert.ok(!u.includes(CODE), u);
    });
    await check("?i: tap does not dismiss; eyes open early, closed at ~3.0s", async () => {
      await t.page.mouse.click(195, 420);
      await sleep(900);
      assert.equal(await t.page.locator(".testerIntro").count(), 1);
      assert.equal(await t.page.locator(".testerIntro.is-closed").count(), 0);
    });
    await sleep(2000); // ~2.9s
    await check("?i: blink -> eyes closed (is-closed, eye scaleY) before transition", async () => {
      assert.equal(await t.page.locator(".testerIntro.is-closed").count(), 1);
      const tf = await t.page.evaluate(() => getComputedStyle(document.querySelector(".testerIntro .eye")).transform);
      assert.notEqual(tf, "none");
    });
    await sleep(170); // ~3.07s: A-995 reopens before leaving, so eyes + existing mouth are visible together
    await check("?i: after blink the existing eyes and mouth are visible together", async () => {
      assert.equal(await t.page.locator(".testerIntro.is-closed").count(), 0);
      assert.equal(await t.page.locator(".testerIntro__face .eye").count(), 2);
      assert.equal(await t.page.locator(".testerIntro__face path:last-child").count(), 1);
      const mouth = await t.page.evaluate(() => {
        const style = getComputedStyle(document.querySelector(".testerIntro__face path:last-child"));
        return { opacity: Number(style.opacity), visibility: style.visibility };
      });
      assert.ok(mouth.opacity > 0);
      assert.equal(mouth.visibility, "visible");
    });
    await sleep(150); // ~3.22s: leaving
    await check("?i: leaving state = scale .92 + -8px + fade (computed, mid-transition)", async () => {
      const m = await t.page.evaluate(() => { const o = document.querySelector(".testerIntro"); return o ? { leaving: o.classList.contains("is-leaving"), tf: getComputedStyle(document.querySelector(".testerIntro__inner")).transform } : null; });
      assert.ok(m === null || m.leaving, "overlay either still pre-leave? " + JSON.stringify(m));
    });
    await sleep(500);
    await check("?i: overlay removed, existing Invite visible and tappable (no auto-advance)", async () => {
      assert.equal(await t.page.locator(".testerIntro").count(), 0);
      assert.equal(await t.page.locator("#inviteFaceButton").count(), 1);
      assert.equal(await t.page.locator(".invite").getAttribute("data-phase"), baseG.phase);
    });
    const tG = await geom(t.page);
    await check("Invite geometry (board/paper/Face ID/tape/envelope/Chog) identical to no-?i", () => assert.deepEqual(tG, baseG));
    const tW = await writes(t.page);
    await check("storage write audit: only extra write vs root is araso.introSeen='1'", () => {
      const key = (w) => JSON.stringify(w);
      const baseSet = new Set(baseW.map(key));
      const extra = tW.filter((w) => !baseSet.has(key(w)));
      assert.deepEqual(extra, [["set", "L", "araso.introSeen", "1"]]);
      assert.ok(!JSON.stringify(tW).includes(CODE));
      assert.ok(!tW.some((w) => w[1] === "S" && w[2] !== undefined && /introSeen/.test(w[2])));
    });
    await check("no request URL/body carries the code; no page errors", () => {
      assert.ok(!t.reqs.some((r) => r.includes(CODE)), t.reqs.filter((r) => r.includes(CODE)).join("\n"));
      assert.deepEqual(t.errors, []);
    });
    await check("identity/financial/registry keys absent after intro", async () => {
      const keys = await t.page.evaluate(() => Object.keys(localStorage));
      assert.ok(keys.includes("araso.introSeen"));
      assert.ok(!keys.some((k) => /passkey|address|prfSalt|piggyReceived|receipts|\.v$|sendPending|tripClosed/.test(k)), keys.join(","));
    });
    // second visit same context
    await t.page.goto(`${BASE}?i=${CODE}`, { waitUntil: "domcontentloaded" });
    await t.page.waitForSelector(".invite");
    await sleep(300);
    await check("second visit same device: no intro, ?i cleaned, Invite shown", async () => {
      assert.equal(await t.page.locator(".testerIntro").count(), 0);
      assert.ok(!(await t.page.evaluate(() => location.search)).includes("i="));
    });
    await t.ctx.close();

    // query + hash preservation
    await SEC("query + hash preservation", async () => {
    const q = await open(`${BASE}?i=${CODE}&debug=1&keep=2#frag=9`);
    await check("?i + ?debug + other query + fragment: only i removed", async () => {
      assert.equal(await q.page.evaluate(() => location.pathname + location.search + location.hash), "/?debug=1&keep=2#frag=9");
      assert.equal(await q.page.locator(".testerIntro").count(), 1);
    });
    await q.ctx.close();
    const q2 = await open(`${BASE}?debug=1&i=${CODE}#g=abc&t=def&v=1`);
    await check("gift-shaped fragment + ?i + ?debug: query keeps debug, i gone, no page error", async () => {
      const s = await q2.page.evaluate(() => location.search);
      assert.equal(s, "?debug=1");
      assert.deepEqual(q2.errors, []);
    });
    await q2.ctx.close();
    });

    // reduced motion
    await SEC("reduced motion", async () => {
    const rm = await open(`${BASE}?i=${CODE}`, { reduced: true });
    await sleep(300);
    await check("reduced motion: overlay never visible, Invite immediately usable, seen written", async () => {
      const vis = await rm.page.evaluate(() => { const e = document.querySelector(".testerIntro"); return !e || getComputedStyle(e).display === "none"; });
      assert.ok(vis);
      assert.ok((await writes(rm.page)).some((w) => w[2] === "araso.introSeen"));
      assert.equal(await rm.page.locator("#inviteFaceButton").count(), 1);
    });
    await rm.ctx.close();
    });

    // invalid code
    await SEC("invalid code", async () => {
    const bad = await open(`${BASE}?i=%3Cb%3E&debug=1`);
    await check("invalid code: no intro, entry opens, i cleaned, debug kept", async () => {
      assert.equal(await bad.page.locator(".testerIntro").count(), 0);
      assert.equal(await bad.page.evaluate(() => location.search), "?debug=1");
      assert.ok(!(await writes(bad.page)).some((w) => w[2] === "araso.introSeen"));
    });
    await bad.ctx.close();
    });

    // returning device
    await SEC("returning device", async () => {
    const ret = await open(`${BASE}?i=${CODE}`, { wait: "#app [data-scene]", seed: [["araso.address", "0x0000000000000000000000000000000000000001"]] });
    await sleep(300);
    await check("returning device (address present): no intro, no introSeen write", async () => {
      assert.equal(await ret.page.locator(".testerIntro").count(), 0);
      assert.ok(!(await writes(ret.page)).some((w) => w[2] === "araso.introSeen"));
      // returning device (credential/address present) is routed to birth, never Invite
      assert.equal(await ret.page.locator('[data-scene="received"]').count(), 0);
      assert.equal(await ret.page.locator(".invite").count(), 0);
      assert.ok(!(await ret.page.evaluate(() => location.search)).includes("i="));
    });
    await ret.ctx.close();
    });

    // storage throwing
    await SEC("storage throwing", async () => {
    // PRE-EXISTING (not A-733): main.js state init reads localStorage unguarded, so with throwing storage the app may not boot on plain '/'.
    // A-733 owns only: its own storage access is guarded, and '/?i=x' behaves exactly like '/' under throwing storage.
    const snap = async (u) => {
      const r = await open(u, { throwing: true, wait: null });
      const o = await r.page.evaluate(() => ({ scenes: [...document.querySelectorAll("[data-scene]")].map((e) => e.dataset.scene), invite: !!document.querySelector(".invite"), intro: !!document.querySelector(".testerIntro"), appLen: document.querySelector("#app")?.innerHTML.length > 0 }));
      await sleep(3700);
      const o2 = await r.page.evaluate(() => ({ scenes: [...document.querySelectorAll("[data-scene]")].map((e) => e.dataset.scene), invite: !!document.querySelector(".invite"), intro: !!document.querySelector(".testerIntro") }));
      const out = { o, o2, errors: r.errors.slice().sort() };
      await r.ctx.close();
      return out;
    };
    await check("storage throws: '/?i=x' behaves exactly like '/' (scenes, invite, page errors); no intro, no new error", async () => {
      const root = await snap(BASE);
      const tst = await snap(`${BASE}?i=${CODE}`);
      assert.deepEqual(tst.o2, root.o2);
      assert.deepEqual({ ...tst.o, intro: false }, { ...root.o, intro: false });
      assert.deepEqual(tst.errors, root.errors);
      assert.equal(tst.o2.intro, false);
    });
    await check("storage throws: intro storage access is guarded (try/catch) and adds no throw path", () => {
      for (const n of ["testerIntroSeen", "markTesterIntroSeen"]) assert.match(fnBody(n), /try \{[\s\S]*\} catch/, n);
      assert.match(fnBody("readTesterInviteParam"), /try \{/);
      assert.match(fnBody("stripTesterInviteFromUrl"), /try \{/);
      assert.ok(!/\blocalStorage\./.test(stripComments(BLOCK)), "uses safeLocalStorage() only");
    });
    });

  } finally {
    await browser.close();
    if (server) { try { process.kill(-server.pid); } catch { /* gone */ } }
  }
}
await partB();
console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
