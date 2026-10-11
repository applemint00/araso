import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launch, sleep } from "./helpers/a803-browser.mjs";
import { testOutDir } from "./helpers/test-out.mjs"; // [A-1007] merge with the A-932 output contract

if (process.env.ARASO_TEST_BROWSER !== "1") {
  console.log("SKIP A-995 visual evidence (ARASO_TEST_BROWSER=1 to run)");
  process.exit(0);
}

const out = testOutDir("a995-visual-evidence", process.argv[2]);
const framesDir = path.join(out, "recording_frames");
mkdirSync(framesDir, { recursive: true });
const H = await launch({ forkMode: true });
const { p } = H;
const result = { screenshots: [], frames: [], measurements: {}, pageErrors: H.errors };

async function visible(selector) {
  return p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, selector);
}

async function waitFor(selector, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await visible(selector)) return true;
    await sleep(100);
  }
  return false;
}

async function openGift() {
  await H.mustTap("#a905Jar", "honey jar");
  await waitFor('.a911-screen[data-a911="money"]');
  await H.mustTap("#a905GiftPiggy", "Gift a Piggy");
  if (!(await waitFor('.a911-screen[data-a911="gift"]'))) {
    const state = await p.evaluate(() => ({
      screen: document.querySelector(".a911-screen")?.dataset.a911 || null,
      scene: document.querySelector("[data-scene]")?.dataset.scene || null,
      giftButton: document.querySelector("#a905GiftPiggy")?.outerHTML || null,
      text: document.body.innerText.slice(0, 500),
    }));
    throw new Error(`Gift screen did not open: ${JSON.stringify(state)}`);
  }
  await H.mustTap('.a911-card[data-a898-front="02"]', "headphone card to centre");
  await sleep(500);
  if (await visible('.a911-card.is-centre[data-a898-front="02"]')) {
    await H.mustTap('.a911-card.is-centre[data-a898-front="02"]', "headphone card pick");
    await sleep(650);
  }
  if (await visible(".a911-card.is-picked:not(.is-flipped)")) {
    await H.mustTap(".a911-card.is-picked", "headphone card flip");
    await sleep(650);
  }
  await p.waitForFunction(() => document.querySelectorAll('svg[data-a995-eye-face="gift"]').length >= 2, null, { timeout: 8000 });
  await sleep(300);
}

async function offsets() {
  return p.evaluate(() => [...document.querySelectorAll('.a911-screen[data-a911="gift"] .a995-eye')].map((eye) => ({
    x: eye.style.getPropertyValue("--a995-eye-x"),
    y: eye.style.getPropertyValue("--a995-eye-y"),
  })));
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

try {
  await H.seedSolo("Honeybun");
  await p.evaluate((key) => localStorage.setItem(key, "1"), H.secondKey("araso.secondJourneyClosed"));
  await seedGiftBalance();

  await H.atWidth(1440, 900);
  await openGift();
  await p.mouse.move(1250, 210);
  await sleep(180);
  result.measurements.desktopCursor = await offsets();
  const desktop = path.join(out, "gift_cursor_1440.png");
  await p.screenshot({ path: desktop });
  result.screenshots.push(desktop);

  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload({ waitUntil: "networkidle" });
  await sleep(600);
  await H.unlock();
  await H.waitScene(["sendstay"], 9000);
  await sleep(1200);
  await seedGiftBalance();
  await p.reload({ waitUntil: "networkidle" });
  await sleep(600);
  await H.unlock();
  await H.waitScene(["sendstay"], 9000);
  await sleep(900);
  await openGift();
  await p.evaluate(() => window.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true })));
  await sleep(140);
  result.measurements.touchBefore = await offsets();
  await p.evaluate(() => window.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", clientX: 350, clientY: 180, bubbles: true })));
  await sleep(140);
  result.measurements.touchHeld = await offsets();
  const touch = path.join(out, "gift_touch_390.png");
  await p.screenshot({ path: touch });
  result.screenshots.push(touch);

  for (let i = 0; i < 12; i += 1) {
    const file = path.join(framesDir, `frame-${String(i).padStart(3, "0")}.png`);
    await p.screenshot({ path: file });
    result.frames.push(file);
    await sleep(60);
  }
  result.measurements.touchAfter = await offsets();
  result.measurements.inlineGiftFaces = await p.locator('svg[data-a995-eye-face="gift"]').count();
  result.measurements.homeEyeLook = await p.locator('#homeChar[data-a995-eye-face], .homeLiving [data-a995-eye-face]').count();
  writeFileSync(path.join(out, "VISUAL_MEASUREMENTS.json"), JSON.stringify(result, null, 2));
} finally {
  await H.close();
}

console.log(JSON.stringify(result.measurements));
