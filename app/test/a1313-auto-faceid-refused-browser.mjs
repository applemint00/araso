// [A-1313 · Owner 13:5x] Reopening asks Face ID by itself (A-1290). iOS Safari turns down a WebAuthn get that no tap started
// (observed live: passkey_get cancel + flow_error unlock on each reopen). Here the browser does the same: a get without user
// activation is refused with NotAllowedError. Reopen → the logo stays (no failure card, no "Couldn't find"), one tap → Face ID → Home.
import assert from "node:assert/strict";
import { launch, harnessPresent, sleep } from "./helpers/a803-browser.mjs";
if (!harnessPresent()) { console.log("SKIP browser harness unavailable"); process.exit(0); }
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log("PASS", n); } catch (e) { fail += 1; console.log("FAIL", n, "—", String(e.message).split("\n")[0]); } };
const shots = process.env.A1313_SHOTS;
const d = await launch();
await d.context.route("**/api/fork-entry", (r) => r.request().postDataJSON()?.action === "public_state" ? r.fulfill({ json: { ok: true, publicEntry: true } }) : r.fulfill({ status: 404, json: { ok: false } }));
try {
  await d.p.setViewportSize({ width: 390, height: 844 });
  await d.seedSolo("Tappy");
  assert.equal(await d.scene(), "sendstay", "seed reached Home");
  // iOS-like policy from here on: no tap = refused
  await d.context.addInitScript(() => {
    try { localStorage.removeItem("araso.entryEnvelope.v1"); } catch {} // the live entry: logo lock + the automatic ask (A-1289/A-1290)
    const c = navigator.credentials; if (!c) return; const get = c.get.bind(c);
    window.__a1313 = { refused: 0, asked: 0 };
    c.get = (o) => { if (!navigator.userActivation?.isActive) { window.__a1313.refused += 1; return Promise.reject(new DOMException("The request is not allowed by the user agent", "NotAllowedError")); } window.__a1313.asked += 1; return get(o); };
  });
  await d.p.goto("about:blank"); await d.p.goto(d.BASE, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  const s = await d.p.evaluate(() => ({ scene: document.querySelector("[data-scene]")?.dataset.scene ?? null, lock: document.querySelector("[data-app-lock]")?.dataset.appLock ?? null, logo: !!document.querySelector(".stage--lockLogo"), text: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160), refused: window.__a1313?.refused ?? -1 }));
  if (shots) await d.p.screenshot({ path: `${shots}/reopen-no-tap-390.png` });
  await check("reopen · the automatic Face ID is refused (no tap) → the logo stays · no failure card · no \"Couldn't find\"", () => {
    assert.ok(s.refused >= 1, `the automatic ask did not happen ${JSON.stringify(s)}`);
    assert.equal(s.logo, true, `logo gone ${JSON.stringify(s)}`);
    assert.equal(/Couldn't (find|open) your Piggy|Couldn't open Piggy|Face ID was cancelled|Try again/.test(s.text), false, `failure shown: ${s.text}`);
  });
  await check("reopen · one tap on the logo → Face ID → Home", async () => {
    await d.p.locator("#loginChogButton").click();
    assert.equal(await d.waitScene(["sendstay"], 15000), "sendstay");
    assert.ok((await d.p.evaluate(() => window.__a1313.asked)) >= 1);
    if (shots) await d.p.screenshot({ path: `${shots}/reopen-tap-home-390.png` });
  });
  await check("no page errors", () => assert.deepEqual(d.errors, []));
} finally { await d.close(); }
console.log(`A1313 auto Face ID refused ${pass} PASS / ${fail} FAIL / 0 SKIP (local · iOS-like no-tap refusal)`);
if (fail) process.exit(1);
