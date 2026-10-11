import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launch, sleep } from "./helpers/a803-browser.mjs";

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a979 badge browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }

const OUT = path.resolve(process.argv[2] || "screenshots/a979-fork-badge-r2");
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
    localStorage.setItem(key, JSON.stringify({ version: 1, accountId: address, chainId: key.split(".")[2], piggies: [{ id: first.id, name: first.name || "Honeybun", address: first.address || address, createdAt: at, historyKey: `araso.piggyRegistry.history.${first.id}`, location: "home", assets: [{ symbol: "USDC", quantity: "38", decimals: 6, sourceTimestamp: at }], valuation: null }] }));
  }, { key, address });
}

async function visible(sel) {
  return p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }, sel);
}
async function waitVisible(sel, ms = 8000) {
  for (let t = Date.now(); Date.now() - t < ms;) { if (await visible(sel)) return true; await sleep(120); }
  return false;
}
async function waitGiftSettled() {
  await p.locator(".a911-card.is-picked").waitFor({ state: "visible" });
  await p.waitForFunction(() => [...document.querySelectorAll(".a911-card.is-away")].every((e) => Number.parseFloat(getComputedStyle(e).opacity) === 0));
}
async function badgeFacts() {
  return p.evaluate(() => {
    const badge = document.querySelector(".a979-forkBadge");
    const b = badge.getBoundingClientRect();
    const brand = document.querySelector(".a911-brand")?.getBoundingClientRect();
    const title = document.querySelector(".a911-title")?.getBoundingClientRect();
    const css = getComputedStyle(badge);
    const overlap = (a, c) => !!a && !!c && a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top;
    return { text: badge.textContent, surface: badge.dataset.a979Surface, rect: { x: b.x, y: b.y, width: b.width, height: b.height }, fontSize: css.fontSize, pointerEvents: css.pointerEvents, brandOverlap: overlap(b, brand), titleOverlap: overlap(b, title) };
  });
}

try {
  await H.seedSolo("Honeybun");
  await p.evaluate((k) => localStorage.setItem(k, "1"), H.secondKey("araso.secondJourneyClosed"));
  await seedRegistry();
  for (const size of sizes) {
    await p.setViewportSize({ width: size.w, height: size.h });
    await p.reload({ waitUntil: "networkidle" });
    await sleep(700);
    await H.unlock();
    assert.equal(await H.waitScene(["sendstay"], 9000), "sendstay");
    await sleep(2500);
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("araso.giftSendDraft.v1.")) localStorage.removeItem(k); });
    assert.equal(await visible(".a979-forkBadge"), false, "Home has no badge");
    await H.mustTap("#a905Jar", "honey jar");
    assert.equal(await waitVisible('.a911-screen[data-a911="money"]'), true, "Money screen");
    assert.equal(await visible(".a979-forkBadge"), true, "Money badge");
    await H.mustTap("#a905GiftPiggy", "Gift a Piggy");
    assert.equal(await waitVisible('.a911-screen[data-a911="gift"]'), true, "Gift screen");
    const giftOpen = await p.evaluate(() => ({ stage: document.querySelector(".a911-screen")?.dataset?.a911Stage, badge: document.querySelector(".a979-forkBadge")?.dataset?.a979Surface || null }));
    assert.equal(giftOpen.stage, "fan", `Gift opens on picker (${JSON.stringify(giftOpen)})`);
    assert.equal(await visible(".a979-forkBadge"), false, `Gift picker has no badge (${JSON.stringify(giftOpen)})`);
    await H.mustTap(".a911-card.is-centre", "Gift centre card");
    assert.equal(await waitVisible('.a911-screen[data-a911="gift"][data-a911-stage="pick"]'), true, "Gift send screen");
    await waitGiftSettled();
    assert.equal(await visible(".a979-forkBadge"), true, "G3 amount/Send badge");
    const g3 = await badgeFacts();
    assert.equal(g3.surface, "gift-amount-send");
    assert.equal(g3.text, "virtual money · fork");
    assert.equal(g3.fontSize, "12px");
    assert.equal(g3.pointerEvents, "none");
    assert.equal(g3.brandOverlap, false);
    assert.equal(g3.titleOverlap, false);
    const g3File = path.join(OUT, `a979-g3-amount-send-${size.w}.png`);
    await p.screenshot({ path: g3File });
    const before = await p.locator('[data-a898-act="gift-amount"]').first().getAttribute("aria-pressed");
    await H.mustTap('[data-a898-act="gift-amount"]', "amount choice");
    assert.equal(await visible(".a979-forkBadge"), false, "first tap hides badge");
    const after = await p.locator('[data-a898-act="gift-amount"]').first().getAttribute("aria-pressed");
    assert.notEqual(after, before, "first tap still reaches original amount choice");
    await H.mustTap(".a911-card.is-picked", "turn picked Gift card over");
    assert.equal(await waitVisible(".a911-card.is-picked.is-flipped"), true, "G4 back");
    assert.equal(await waitVisible(".a979-forkBadge"), true, "G4 back/Send badge reappears");
    await sleep(600);
    const g4 = await badgeFacts();
    assert.equal(g4.surface, "gift-back-send");
    assert.equal(g4.brandOverlap, false);
    assert.equal(g4.titleOverlap, false);
    const g4File = path.join(OUT, `a979-g4-back-send-${size.w}.png`);
    await p.screenshot({ path: g4File });
    evidence.push({ viewport: size, g3: { file: path.basename(g3File), ...g3 }, g4: { file: path.basename(g4File), ...g4 }, firstTapDelivered: true, stateEntryReappeared: true });
  }
  writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`A-979 badge browser: 6/6 G3/G4 screenshots · first-tap delivery + state-entry redisplay verified · ${OUT}`);
} finally {
  await H.close();
}
