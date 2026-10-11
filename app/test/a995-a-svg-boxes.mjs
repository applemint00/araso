import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { launch, sleep } from "./helpers/a803-browser.mjs";

if (process.env.ARASO_TEST_BROWSER !== "1") {
  console.log("SKIP A-995-a SVG boxes (ARASO_TEST_BROWSER=1 to run)");
  process.exit(0);
}

const out = path.resolve(process.argv[2] || "A995_a_BOXES.tsv");
const rows = [];
let H;
let p;

async function startHarness() {
  H = await launch({ forkMode: true });
  ({ p } = H);
}

async function visible(selector) {
  return p.evaluate((s) => {
    const element = document.querySelector(s);
    const box = element?.getBoundingClientRect();
    return !!box && box.width > 0 && box.height > 0;
  }, selector);
}

async function waitFor(selector, ms = 8000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await visible(selector)) return;
    await sleep(100);
  }
  throw new Error(`not visible: ${selector}`);
}

async function seedGiftBalance() {
  await p.evaluate((scope) => {
    const address = localStorage.getItem("araso.address");
    const key = `araso.piggyRegistry.${scope}.${address}`;
    const at = new Date().toISOString();
    const current = JSON.parse(localStorage.getItem(key) || "null");
    const first = current?.piggies?.[0] || { id: "solo", name: "Honeybun", address, createdAt: at };
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      accountId: address,
      chainId: scope,
      piggies: [{ ...first, name: first.name || "Honeybun", address: first.address || address, location: "home", assets: [{ symbol: "USDC", quantity: "38", decimals: 6, sourceTimestamp: at }], valuation: null }],
    }));
  }, H.scope);
}

async function openGiftFan() {
  await H.mustTap("#a905Jar", "honey jar");
  await waitFor('.a911-screen[data-a911="money"]');
  await H.mustTap("#a905GiftPiggy", "Gift a Piggy");
  await waitFor('.a911-screen[data-a911="gift"]');
  await p.waitForFunction(() => document.querySelectorAll('svg[data-a995-eye-face="gift"]').length === 2, null, { timeout: 8000 });
  await sleep(200);
}

async function measure(viewport) {
  await p.setViewportSize({ width: viewport, height: 900 });
  await p.reload({ waitUntil: "networkidle" });
  await sleep(600);
  await H.unlock();
  await H.waitScene(["sendstay"], 9000);
  await seedGiftBalance();
  await p.reload({ waitUntil: "networkidle" });
  await sleep(600);
  await H.unlock();
  await H.waitScene(["sendstay"], 9000);
  await sleep(600);
  await openGiftFan();

  const measured = await p.evaluate(async () => {
    const sources = { "02": "/card/gift/piggy_seat_listen.svg", "04": "/card/gift/piggy_watching_fit.svg" };
    const result = [];
    for (const id of ["01", "02", "04"]) {
      const card = document.querySelector(`[data-a898-front="${id}"]`);
      const art = card?.querySelector(".a911-face--front img[data-a995-gift-eye='front'], .a911-face--front svg[data-a995-eye-face='gift']");
      const after = art?.getBoundingClientRect();
      const afterBox = after && { x: after.x, y: after.y, width: after.width, height: after.height };
      let before = afterBox;
      if (art?.tagName.toLowerCase() === "svg") {
        const image = document.createElement("img");
        image.className = art.getAttribute("class") || "";
        image.setAttribute("style", art.getAttribute("style") || "");
        image.src = sources[id];
        art.replaceWith(image);
        await image.decode();
        const box = image.getBoundingClientRect();
        before = { x: box.x, y: box.y, width: box.width, height: box.height };
        image.replaceWith(art);
      }
      result.push({ id, before, after: afterBox });
    }
    return result;
  });

  for (const item of measured) {
    assert.ok(item.before && item.after, `${viewport}/${item.id}: before and after boxes exist`);
    const delta = Math.max(...["x", "y", "width", "height"].map((key) => Math.abs(item.after[key] - item.before[key])));
    rows.push({ viewport, id: item.id, ...Object.fromEntries(["x", "y", "width", "height"].flatMap((key) => [[`before_${key}`, item.before[key]], [`after_${key}`, item.after[key]]])), max_delta: delta });
  }
}

try {
  await startHarness();
  await H.seedSolo("Honeybun");
  await p.evaluate((key) => localStorage.setItem(key, "1"), H.secondKey("araso.secondJourneyClosed"));
  await seedGiftBalance();
  await measure(390);
  await H.close();
  await startHarness();
  await H.seedSolo("Honeybun");
  await p.evaluate((key) => localStorage.setItem(key, "1"), H.secondKey("araso.secondJourneyClosed"));
  await seedGiftBalance();
  await measure(1440);
} finally {
  await H?.close();
}

const columns = ["viewport", "id", "before_x", "after_x", "before_y", "after_y", "before_width", "after_width", "before_height", "after_height", "max_delta"];
const table = [columns.join("\t"), ...rows.map((row) => columns.map((key) => typeof row[key] === "number" ? row[key].toFixed(3) : row[key]).join("\t"))].join("\n") + "\n";
writeFileSync(out, table);
console.log(table.trim());
for (const row of rows) assert.ok(row.max_delta <= 0.5, `${row.viewport}/${row.id}: max delta ${row.max_delta.toFixed(3)}px`);
