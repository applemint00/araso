import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launch, sleep } from "./helpers/a803-browser.mjs";

// iOS taps the words: the first tap on Money's sparkling "Gift a Piggy" words opens Gift (and ends the sparkle), not only the sparkle.
if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a1325 Gift first tap browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }

const OUT = path.resolve(process.argv[2] || "screenshots/a1325-gift-first-tap");
mkdirSync(OUT, { recursive: true });
const sizes = [{ w: 390, h: 844 }, { w: 810, h: 1080 }, { w: 1440, h: 900 }];
const H = await launch({ forkMode: true });
const { p } = H;
const evidence = [];

async function seedRegistry() {
  const address = await p.evaluate(() => localStorage.getItem("araso.address"));
  const key = `araso.piggyRegistry.${H.scope}.${address}`;
  await p.evaluate(({ key, address }) => {
    const at = new Date().toISOString();
    const idxKey = Object.keys(localStorage).find((k) => /^araso\.myPiggies/.test(k));
    const idx = idxKey ? JSON.parse(localStorage.getItem(idxKey)) : null;
    const first = idx?.piggies?.[0] || { id: "solo", name: "Honeybun", address };
    localStorage.setItem(key, JSON.stringify({ version: 1, accountId: address, chainId: key.split(".")[2], piggies: [{ id: first.id, name: first.name || "Honeybun", address: first.address || address, createdAt: at, historyKey: `araso.piggyRegistry.history.${first.id}`, location: "home", assets: [{ symbol: "USDC", quantity: "99.886735", decimals: 6, sourceTimestamp: at }], valuation: null }] }));
  }, { key, address });
}
async function visible(sel) {
  return p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }, sel);
}
async function waitVisible(sel, ms = 8000) {
  for (let t = Date.now(); Date.now() - t < ms;) { if (await visible(sel)) return true; await sleep(120); }
  return false;
}
async function facts() {
  return p.evaluate(() => {
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height, left: b.left, right: b.right, top: b.top, bottom: b.bottom } : null; };
    const hit = (a, c) => !!a && !!c && a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top;
    const badge = r(document.querySelector(".a979-forkBadge"));
    const screen = document.querySelector('.a911-screen[data-a911="money"]');
    const parts = {
      brand: r(screen?.querySelector(".a911-brand")),
      title: r(screen?.querySelector(".a911-title")),
      paper: r(screen?.querySelector(".a911-paper")),
      total: r(screen?.querySelector(".a911-money__total")),
      assets: r(screen?.querySelector(".a911-money__assets")),
      back: r(screen?.querySelector(".a911-back, [data-a905-act=back]")),
    };
    const overlaps = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, hit(badge, v)]));
    return {
      total: screen?.querySelector(".a911-money__total")?.textContent ?? null,
      assets: screen?.querySelector(".a911-money__assets")?.textContent ?? null,
      rows: [...(screen?.querySelectorAll(".a911-piggy") || [])].map((e) => e.textContent),
      badge, parts, overlaps,
    };
  });
}

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails += 1; console.log(`FAIL  ${msg}`); } else console.log(`PASS  ${msg}`); };
try {
  await H.seedSolo("Honeybun");
  await p.evaluate((k) => localStorage.setItem(k, "1"), H.secondKey("araso.secondJourneyClosed"));
  await seedRegistry();
  await p.evaluate(() => localStorage.removeItem("araso.giftSparkle"));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload({ waitUntil: "networkidle" });
  await sleep(700);
  await H.unlock();
  assert.equal(await H.waitScene(["sendstay"], 9000), "sendstay");
  await sleep(2500);
  await H.mustTap("#a905Jar", "honey jar");
  assert.equal(await waitVisible('.a911-screen[data-a911="money"]'), true, "Money screen");
  await sleep(600);
  check(await visible("#a905GiftPiggy .a1288Txt"), "sparkle on before the first tap");
  await p.screenshot({ path: path.join(OUT, "before-tap.png") });
  await p.click("#a905GiftPiggy .a1288Txt");
  const opened = await waitVisible('.a911-screen[data-a911="gift"]', 3000);
  await p.screenshot({ path: path.join(OUT, "after-first-tap.png") });
  const after = await p.evaluate(() => ({ screen: document.querySelector(".a911-screen")?.dataset?.a911 || null, sparkle: localStorage.getItem("araso.giftSparkle") }));
  evidence.push(after);
  check(opened, `first tap on the words opens Gift (${JSON.stringify(after)})`);
  check(after.sparkle === "done", "sparkle marked done on the first tap");
} finally {
  writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify(evidence, null, 2));
  await H.close?.();
}
console.log(`A-1325 Gift first tap browser: ${fails === 0 ? "PASS" : `FAIL ${fails}`} · ${OUT}`);
process.exit(fails === 0 ? 0 : 1);
