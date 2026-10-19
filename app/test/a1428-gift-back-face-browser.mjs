// [A-1428 · E38] Gift send: after the in-place flip (a911Sync patches the same card nodes so the turn animates), iOS WebKit culls
// the back face as if it faced away (backface-visibility: hidden) although it faces the viewer — the turned card shows nothing.
// Measured on the iOS 27 simulator (handoff A-1428): computed back face = visibility visible · rotateY(180deg) on a rotateY(180deg)
// card · nothing painted; the same node with backface-visibility: visible paints the letter the right way round.
// The A-1312 ② visibility switch already removes the side that faces away, so the turned card's back face needs no culling.
// This pins the computed values the fix relies on (Chromium · style.css only · no app server):
//   flipped picked card  → back face visible + backface-visibility: visible · front face hidden (A-1312 ② unchanged)
//   unflipped picked card → back face hidden (A-1312 ② unchanged) · front face keeps backface-visibility: hidden
//   receive card (A-1417 data-gift-receive-card) flipped → same as the send card
//   ARASO_TEST_BROWSER=1 ARASO_PRIVATE_BASE=<private dir> node app/test/a1428-gift-back-face-browser.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath, hasPrivate } from "./helpers/private-base.mjs";

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a1428 back face (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }
if (!hasPrivate()) { console.log("SKIP  a1428 back face — playwright lives in the private harness (public checkout)"); process.exit(0); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(HERE, "..", "src", "style.css"), "utf8");
const { chromium } = createRequire(privatePath("ops/harness/package.json"))("playwright");

const card = (flipped, receive) => `<div class="a911-screen"><div class="a911-cards" data-a911-cards="pick">
  <div class="a911-card is-picked${flipped ? " is-flipped" : ""}"${receive ? ' data-gift-receive-card="02"' : ' data-a898-front="02"'}>
    <button class="a911-cardTap" type="button"></button>
    <span class="a911-card__inner"><span class="a911-face a911-face--front">front</span><span class="a911-face a911-face--back">back</span></span>
  </div></div></div>`;

const failures = [];
const must = (ok, msg) => { if (!ok) { failures.push(msg); console.log(`ASSERT FAIL  ${msg}`); } };
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const [label, flipped, receive] of [["send flipped", true, false], ["send front", false, false], ["receive flipped", true, true]]) {
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${card(flipped, receive)}</body></html>`);
    await page.waitForTimeout(600); // past the 225 ms visibility switch and the 450 ms turn
    const f = await page.evaluate(() => {
      const cs = (sel) => { const c = getComputedStyle(document.querySelector(sel)); return { vis: c.visibility, bfv: c.backfaceVisibility || c.webkitBackfaceVisibility }; };
      return { back: cs(".a911-face--back"), front: cs(".a911-face--front") };
    });
    console.log(`${label}: back ${f.back.vis}/${f.back.bfv} · front ${f.front.vis}/${f.front.bfv}`);
    if (flipped) {
      must(f.back.vis === "visible", `${label}: back face visible (A-1312 ②)`);
      must(f.back.bfv === "visible", `${label}: back face backface-visibility visible (turned card shows its letter · E38)`);
      must(f.front.vis === "hidden", `${label}: front face hidden (A-1312 ② unchanged)`);
    } else {
      must(f.back.vis === "hidden", `${label}: back face hidden before the turn (A-1312 ② unchanged)`);
      must(f.front.bfv === "hidden", `${label}: front face keeps backface-visibility hidden`);
    }
  }
} finally { await browser.close(); }
if (failures.length) { console.log(`FAIL a1428 back face (${failures.length})`); process.exit(1); }
console.log("PASS a1428 back face: the turned Gift card's letter face is not culled; A-1312 ② sides unchanged");
