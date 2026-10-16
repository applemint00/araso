// [A-1312 ①②] ① Under the shipped CSP (vercel.json, object-src 'none') the wait screen shows the approved loading Piggy face
// (an <img> of the same file), not an empty square / a blocked plug-in. ② In WebKit (Safari's engine) a turned Gift card shows
// the letter side clean: the front's amount box does not show through, mirrored, over the FROM box.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { launch, harnessPresent, REPO } from "./helpers/a803-browser.mjs";
import { privatePath } from "./helpers/private-base.mjs";
if (!harnessPresent()) { console.log("SKIP browser harness unavailable"); process.exit(0); }
const CSP = JSON.parse(readFileSync(`${REPO}/vercel.json`, "utf8")).headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy").value;
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log("PASS", n); } catch (e) { fail += 1; console.log("FAIL", n, "—", String(e.message).split("\n")[0]); } };
const shots = process.env.A1312_SHOTS;
// mean luminance of a clip, read back through a canvas in the same page
async function lum(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4);
  }, png.toString("base64"));
}

const d = await launch();
try {
  // ── ① CSP wait screen ──
  const csp = [];
  d.p.on("console", (m) => { if (/Content Security Policy|object-src/.test(m.text())) csp.push(m.text().slice(0, 160)); });
  await d.context.route(d.BASE, async (r) => { const res = await r.fetch(); r.fulfill({ response: res, headers: { ...res.headers(), "content-security-policy": CSP } }); });
  await d.context.route("**/api/fork-entry", async (r) => { if (r.request().postDataJSON()?.action === "public_state") { await new Promise((ok) => setTimeout(ok, 2500)); return r.fulfill({ json: { ok: true, publicEntry: true } }); } return r.fulfill({ status: 404, json: { ok: false } }); });
  await d.p.setViewportSize({ width: 390, height: 844 });
  await d.p.goto(d.BASE, { waitUntil: "domcontentloaded" });
  await d.p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await d.p.goto("about:blank"); await d.p.goto(d.BASE, { waitUntil: "domcontentloaded" });
  await d.p.locator("[data-a1223-loading]").waitFor({ timeout: 5000 });
  await d.p.waitForTimeout(800);
  if (shots) await d.p.screenshot({ path: `${shots}/wait-csp-chromium-390.png` });
  await check("① CSP on: the wait screen draws the loading Piggy face (img, same file) · no object · no CSP block", async () => {
    const v = await d.p.evaluate(() => { const f = document.querySelector("[data-a1223-loading] .a995bLoading__face"); const img = f?.querySelector("img"); const r = img?.getBoundingClientRect(); return { object: !!f?.querySelector("object"), src: img?.getAttribute("src") ?? null, nw: img?.naturalWidth ?? 0, w: Math.round(r?.width ?? 0) }; });
    assert.equal(v.object, false, `object element still used ${JSON.stringify(v)} · csp ${JSON.stringify(csp)}`);
    assert.equal(v.src, "/motion/a995b-loading-piggy.svg");
    assert.ok(v.nw > 0 && v.w > 100, `face not drawn ${JSON.stringify(v)}`);
    assert.deepEqual(csp.filter((t) => /object-src/.test(t)), []);
  });

  // ── ② WebKit turned Gift card ──
  const { webkit } = createRequire(privatePath("ops/harness/package.json"))("playwright");
  const wb = await webkit.launch({ headless: true });
  try {
    const page = await wb.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await page.route("**/*", (r) => { const u = new URL(r.request().url()); return u.hostname === "localhost" || u.hostname === "127.0.0.1" ? r.continue() : r.abort(); });
    await page.goto(d.BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.evaluate(async () => {
      const m = await import("/src/a911-screens.js");
      document.querySelectorAll("body > *").forEach((e) => { if (e.tagName !== "SCRIPT") e.remove(); });
      const host = document.createElement("div"); document.body.appendChild(host);
      host.innerHTML = m.a911GiftMarkup({ stage: "pick", fronts: [{ id: "01" }, { id: "02" }, { id: "04" }], ci: 1, picked: "02", flipped: false, amountUsd: 50, fields: { to: "", message: "", from: "" }, presets: [{ id: "20", label: "$20" }, { id: "50", label: "$50", selected: true }, { id: "100", label: "$100" }], payerName: "Piggy", balanceUsd: "99.89", fees: {}, canSend: false });
      const root = host.querySelector(".a911-screen") || host.firstElementChild; m.a911Fit(root);
      await new Promise((ok) => setTimeout(ok, 300));
      host.querySelector(".a911-card.is-picked").classList.add("is-flipped");
    });
    await page.waitForTimeout(1200);
    if (shots) await page.screenshot({ path: `${shots}/gift-flipped-webkit-390.png` });
    await check("② WebKit: turned card · the FROM box shows the letter paper (front amount box does not show through)", async () => {
      const r = await page.evaluate(() => { const b = document.querySelector(".a911-card.is-picked .a911-letter__from").getBoundingClientRect(); return { x: b.x + 4, y: b.y + 4, width: b.width - 8, height: b.height - 8 }; });
      const L = await lum(page, r);
      assert.ok(L > 140, `FROM box mean luminance ${L.toFixed(0)} (letter paper ≈ 220 · dark amount box ≈ 20)`);
    });
    await check("② WebKit: the letter fields are upright (not mirrored)", async () => {
      const t = await page.evaluate(() => { const e = document.querySelector(".a911-card.is-picked .a911-letter__in--to"); const m = new DOMMatrix(getComputedStyle(document.querySelector(".a911-card.is-picked")).transform); const b = new DOMMatrix(getComputedStyle(document.querySelector(".a911-card.is-picked .a911-face--back")).transform); return { cardA: m.a, backA: b.a, w: e.getBoundingClientRect().width }; });
      assert.ok(t.cardA * t.backA > 0, `card x-scale ${t.cardA} × back x-scale ${t.backA} must face the reader`);
    });
  } finally { await wb.close(); }
} finally { await d.close(); }
console.log(`A1312 csp/flip ${pass} PASS / ${fail} FAIL / 0 SKIP (local dev server + shipped CSP header · WebKit)`);
if (fail) process.exit(1);
