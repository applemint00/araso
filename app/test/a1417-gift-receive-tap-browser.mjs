// [A-1417] The Gift receiver taps the card and the tap reaches the card's flip button (#giftOpenButton[data-gift-receive="flip"]).
// A-1409 r4 ③: style.css `.a911-card.is-picked .a911-cardTap { pointer-events: none }` (the Send card's rule) also covered the receive
// card, so a finger tap fell on the face and nothing flipped. Real pointer only: elementFromPoint + page.mouse.click on the card centre
// (no el.click() / dispatchEvent — those skip pointer-events and are how the old receive PASS missed this).
// Guards: the Send picked card's centre is still taken by the face (not .a911-cardTap); a turned receive card's centre is not .a911-cardTap.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { launch, harnessPresent } from "./helpers/a803-browser.mjs";
import { privatePath } from "./helpers/private-base.mjs";
if (!harnessPresent()) { console.log("SKIP browser harness unavailable"); process.exit(0); }
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log("PASS", n); } catch (e) { fail += 1; console.log("FAIL", n, "—", String(e.message).split("\n")[0]); } };

// draws one screen from the real a911-screens.js markup on the real app page (real style.css) and returns the picked card's centre
async function draw(page, kind) {
  return page.evaluate(async (kind) => {
    const m = await import("/src/a911-screens.js");
    document.querySelectorAll("body > *").forEach((e) => { if (e.tagName !== "SCRIPT") e.remove(); });
    const host = document.createElement("div"); document.body.appendChild(host);
    host.innerHTML = kind === "send"
      ? m.a911GiftMarkup({ stage: "pick", fronts: [{ id: "01" }, { id: "02" }, { id: "04" }], ci: 1, picked: "02", flipped: false, amountUsd: 20, fields: { to: "", message: "", from: "" }, presets: [{ id: "20", label: "$20", selected: true }, { id: "50", label: "$50" }, { id: "100", label: "$100" }], payerName: "Piggy", balanceUsd: "99.89", fees: {}, canSend: false })
      : m.a911GiftReceiveMarkup({ front: "02", amountUsd: 20, fields: { to: "you", message: "hi", from: "Piggy" }, flipped: kind === "receive-flipped" });
    const root = host.querySelector(".a911-screen") || host.firstElementChild; m.a911Fit(root);
    await new Promise((ok) => setTimeout(ok, 300));
    const card = host.querySelector(".a911-card.is-picked");
    const r = card.getBoundingClientRect();
    window.__a1417taps = 0;
    const btn = card.querySelector('#giftOpenButton[data-gift-receive="flip"]');
    if (btn) btn.addEventListener("click", () => { window.__a1417taps += 1; });
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, kind);
}
const hitAt = (page, pt) => page.evaluate(({ x, y }) => {
  const e = document.elementFromPoint(x, y);
  return { cls: e ? String(e.className) : null, inFlip: !!e?.closest('#giftOpenButton[data-gift-receive="flip"]'), isCardTap: !!e?.closest(".a911-cardTap"), inFace: !!e?.closest(".a911-face") };
}, pt);

const d = await launch();
try {
  const { webkit } = createRequire(privatePath("ops/harness/package.json"))("playwright");
  const wb = await webkit.launch({ headless: true });
  try {
    const page = await wb.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    await page.route("**/*", (r) => { const u = new URL(r.request().url()); return u.hostname === "localhost" || u.hostname === "127.0.0.1" ? r.continue() : r.abort(); });
    await page.goto(d.BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const rc = await draw(page, "receive");
    await page.waitForTimeout(600);
    await check("receive card · centre point (elementFromPoint) is inside #giftOpenButton[data-gift-receive=\"flip\"]", async () => {
      const h = await hitAt(page, rc);
      assert.ok(h.inFlip, `centre hits ${JSON.stringify(h)}`);
    });
    await check("receive card · a real pointer click at the centre reaches the flip button (1 click)", async () => {
      await page.mouse.click(rc.x, rc.y);
      assert.equal(await page.evaluate(() => window.__a1417taps), 1);
    });
    await check("receive card · a real touch tap at the centre reaches the flip button (1 click)", async () => {
      await page.evaluate(() => { window.__a1417taps = 0; });
      await page.touchscreen.tap(rc.x, rc.y);
      assert.equal(await page.evaluate(() => window.__a1417taps), 1);
    });

    const rf = await draw(page, "receive-flipped");
    await page.waitForTimeout(1200);
    await check("receive card turned (is-flipped) · centre is not .a911-cardTap (the flip button steps aside, Face ID is the next tap)", async () => {
      const h = await hitAt(page, rf);
      assert.equal(h.isCardTap, false, `centre hits ${JSON.stringify(h)}`);
    });

    const sc = await draw(page, "send");
    await page.waitForTimeout(600);
    await check("send picked card · centre is not .a911-cardTap (the face takes the tap as before)", async () => {
      const h = await hitAt(page, sc);
      assert.equal(h.isCardTap, false, `centre hits ${JSON.stringify(h)}`);
      assert.ok(h.inFace, `centre hits ${JSON.stringify(h)}`);
    });
  } finally { await wb.close(); }
} finally { await d.close(); }
console.log(`A1417 gift receive tap ${pass} PASS / ${fail} FAIL / 0 SKIP (local dev server · WebKit · real pointer)`);
if (fail) process.exit(1);
