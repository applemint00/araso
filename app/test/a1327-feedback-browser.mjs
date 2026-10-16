import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launch, sleep } from "./helpers/a803-browser.mjs";

// Home paper foot `feedback ♡` (A5) → one paper (C) → Send → server line → Chog "got it. thank you" (D) → back to Home.
// Other Home elements keep their place: rects are compared with a baseline run (A1327_BASE_RECTS = that run's rects.json).
if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a1327 feedback browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }

const OUT = path.resolve(process.argv[2] || "screenshots/a1327-feedback");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.A1327_BASE_RECTS && existsSync(process.env.A1327_BASE_RECTS) ? JSON.parse(readFileSync(process.env.A1327_BASE_RECTS, "utf8")) : null;
const sizes = [{ w: 390, h: 844 }, { w: 810, h: 1080 }, { w: 1440, h: 900 }];
const H = await launch();
const { p } = H;
const rects = {};
const posts = [];
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails += 1; console.log(`FAIL  ${msg}`); } else console.log(`PASS  ${msg}`); };
const visible = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== "hidden"; }, sel);
async function waitVisible(sel, ms = 6000) { for (let t = Date.now(); Date.now() - t < ms;) { if (await visible(sel)) return true; await sleep(100); } return false; }
const homeRects = () => p.evaluate(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]; };
  const out = {};
  for (const sel of [".homePaper", ".homePaper__stamp", ".homePaper__logo", "#chogHome", "#a905Jar", ".homePaper__card--status"]) { const e = document.querySelector(sel); if (e) out[sel] = r(e); }
  document.querySelectorAll(".homePaper__card").forEach((e, i) => { out[`card${i}`] = r(e); });
  return out;
});

try {
  await H.context.route("**/api/fork-entry", (r) => r.fulfill({ json: { ok: true, publicEntry: true, bound: false } }));
  await H.seedSolo("Honeybun");
  await p.route("**/api/feedback", async (route) => { posts.push(route.request().postDataJSON()); await route.fulfill({ status: 204, body: "" }); });
  for (const size of sizes) {
    await p.setViewportSize({ width: size.w, height: size.h });
    await p.reload({ waitUntil: "networkidle" });
    await sleep(700);
    await H.unlock();
    assert.equal(await H.waitScene(["sendstay"], 9000), "sendstay");
    await sleep(4000);
    if (await p.locator("#stayButton").count()) { await p.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(1300); }
    await H.closeRecords();
    assert.equal(await H.openHomePaper(), true, "Home paper open");
    await sleep(900);
    rects[size.w] = await homeRects();
    await p.screenshot({ path: path.join(OUT, `home-${size.w}.png`) });
    const entry = await p.evaluate(() => {
      const e = document.querySelector("#homeFeedback");
      if (!e) return null;
      const b = e.getBoundingClientRect(); const logo = document.querySelector(".homePaper__logo")?.getBoundingClientRect(); const paper = document.querySelector(".homePaper")?.getBoundingClientRect();
      const word = e.querySelector(".homeFeedback__word"); const scale = paper ? paper.width / 400 : 1; const wb = word?.getBoundingClientRect() || b;
      return { text: e.textContent.trim(), top: wb.top, bottom: wb.bottom, h: b.height, w: b.width, cx: b.left + b.width / 2, logoBottom: logo?.bottom ?? null, logoCx: logo ? logo.left + logo.width / 2 : null, paperBottom: paper?.bottom ?? null, fontPx: word ? Number.parseFloat(getComputedStyle(word).fontSize) * scale : null, hit: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest?.("#homeFeedback") ? true : false };
    });
    const tag = `${size.w}`;
    check(entry && entry.text === "feedback", `${tag} A5 Home paper foot shows "feedback" (${JSON.stringify(entry)})`);
    if (entry) {
      check(entry.top >= entry.logoBottom - 0.5 && entry.bottom <= entry.paperBottom + 0.5, `${tag} A5 words under the ARASO logo, inside the paper`);
      check(Math.abs(entry.cx - entry.logoCx) < 2, `${tag} A5 centred on the logo line (cx ${entry.cx.toFixed(1)} vs ${entry.logoCx.toFixed(1)})`);
      check(entry.fontPx >= 12.5 && entry.fontPx <= 15.5 * (size.w / 390), `${tag} A5 words ≈ 13–14 px on screen at 390 (${entry.fontPx?.toFixed(2)})`);
      check(entry.h >= 44 && entry.hit, `${tag} A5 tap area ≥ 44 and reachable (${entry.h.toFixed(1)})`);
    }
    if (BASE && BASE[size.w]) {
      const moved = Object.entries(BASE[size.w]).filter(([k, v]) => JSON.stringify(rects[size.w][k]) !== JSON.stringify(v)).map(([k]) => k);
      check(moved.length === 0, `${tag} other Home elements in place (moved=${JSON.stringify(moved)})`);
    }
    if (size.w !== 390 || !entry) continue;
    await H.mustTap("#homeFeedback", "feedback");
    check(await waitVisible('.a911-screen[data-a911="feedback"]'), "C form opens");
    const form = await p.evaluate(() => ({ title: document.querySelector(".fb-title")?.textContent, hint: document.querySelector(".fb-hint")?.textContent, with: document.querySelector(".fb-with")?.textContent, send: document.querySelector("#feedbackSend")?.textContent.trim(), disabled: document.querySelector("#feedbackSend")?.disabled, inputPx: Number.parseFloat(getComputedStyle(document.querySelector("#feedbackText")).fontSize) }));
    check(form.title === "Tell us" && form.hint === "anything that felt strange" && form.send === "Send", `C copy as design (${JSON.stringify(form)})`);
    check(/^sent with: Home · \S+ · \d\d:\d\d$/.test(form.with || ""), `C sent-with line (${form.with})`);
    check(form.disabled === true && form.inputPx >= 16, "C Send off until words · text ≥ 16 px");
    await p.screenshot({ path: path.join(OUT, "form-390.png") });
    await p.locator("#feedbackText").fill("the bell rang twice");
    check((await p.evaluate(() => document.querySelector("#feedbackSend")?.disabled)) === false, "C Send on with words");
    await p.screenshot({ path: path.join(OUT, "form-typed-390.png") });
    check((await p.evaluate(() => document.querySelector('.a911-screen[data-a911="feedback"]')?.dataset.typing)) === "1", "C typing: the paper is in keyboard mode (Send waits, as Gift)");
    await p.evaluate(() => document.activeElement?.blur());
    await sleep(300);
    await H.mustTap("#feedbackSend", "Send");
    await sleep(500);
    const said = await p.evaluate(() => [...document.querySelectorAll(".chogCheckLine")].map((e) => e.textContent.trim()));
    await p.screenshot({ path: path.join(OUT, "thanks-390.png") });
    check(posts.length === 1 && JSON.stringify(Object.keys(posts[0]).sort()) === JSON.stringify(["os", "screen", "text"]) && posts[0].text === "the bell rang twice" && posts[0].screen === "home", `server got one line (${JSON.stringify(posts)})`);
    check(said.includes("got it. thank you") && !(await visible('.a911-screen[data-a911="feedback"]')), `D Chog says the line, form gone (${JSON.stringify(said)})`);
    await sleep(3300);
    const after = await p.evaluate(() => [...document.querySelectorAll(".chogCheckLine")].map((e) => e.textContent.trim()));
    check(!after.includes("got it. thank you") && (await H.scene()) === "sendstay", `D back to Home after 3 s (${JSON.stringify(after)})`);
  }
} finally {
  writeFileSync(path.join(OUT, "rects.json"), JSON.stringify(rects, null, 2));
  await H.close();
}
console.log(`A-1327 feedback browser: ${fails === 0 ? "PASS" : `FAIL ${fails}`} · ${OUT}`);
process.exit(fails === 0 ? 0 : 1);
