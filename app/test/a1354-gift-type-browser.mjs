// [A-1354 · Owner 10-17 13:5x–14:0x · Design canvas "Gift 글자 · 뒷면 안내 시안" A.dc.html (390 base)] Gift (pick stage) at 390 · 810 · 1440:
// amount chips 24 · from line 17 · the hint "tap to turn it over to write then send" 17 gold, under the from line with room above ·
// the fee / gas lines 14 on the Send row, left of Send, never cut (down to 12 when tight). Sizes ride --a911-z like the rest of the screen.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { launch, sleep } from "./helpers/a803-browser.mjs";

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a1354 Gift type browser part (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }
const OUT = path.resolve(process.argv[2] || "screenshots/a1354-gift-type");
mkdirSync(OUT, { recursive: true });
const HINT = "tap to turn it over to write then send";
const H = await launch({ forkMode: true });
const { p } = H;
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails += 1; console.log(`FAIL  ${msg}`); } else console.log(`PASS  ${msg}`); };
const near = (a, b, tol = 0.75) => Math.abs(a - b) <= tol;

async function seed() {
  await H.seedSolo("Honeybun");
  await p.evaluate((k) => localStorage.setItem(k, "1"), H.secondKey("araso.secondJourneyClosed"));
  const address = await p.evaluate(() => localStorage.getItem("araso.address"));
  const key = `araso.piggyRegistry.${H.scope}.${address}`;
  await p.evaluate(({ key, address }) => {
    const at = new Date().toISOString();
    const idxKey = Object.keys(localStorage).find((k) => /^araso\.myPiggies/.test(k));
    const idx = idxKey ? JSON.parse(localStorage.getItem(idxKey)) : null;
    const first = idx?.piggies?.[0] || { id: "solo", name: "Honeybun", address };
    localStorage.setItem(key, JSON.stringify({ version: 1, accountId: address, chainId: key.split(".")[2], piggies: [{ id: first.id, name: first.name || "Honeybun", address: first.address || address, createdAt: at, historyKey: `araso.piggyRegistry.history.${first.id}`, location: "home", assets: [{ symbol: "USDC", quantity: "99.886735", decimals: 6, sourceTimestamp: at }], valuation: null }] }));
    localStorage.setItem("araso.giftSparkle", "done");
  }, { key, address });
}
async function openGiftPick(w, h) {
  await p.setViewportSize({ width: w, height: h });
  await p.reload({ waitUntil: "networkidle" }); await sleep(700);
  await H.unlock(); await H.waitScene(["sendstay"], 9000); await sleep(2500);
  await H.mustTap("#a905Jar", "jar"); await sleep(1200);
  await p.click("#a905GiftPiggy"); await sleep(1500);
  if ((await p.evaluate(() => document.querySelector(".a911-screen")?.dataset.a911Stage)) !== "pick") {
    const taps = await p.$$(".a911-screen .a911-cardTap");
    await taps[Math.floor(taps.length / 2)].click({ force: true }); await sleep(1200);
  }
}
const measure = () => p.evaluate(() => {
  const s = document.querySelector('.a911-screen[data-a911="gift"]');
  const z = parseFloat(getComputedStyle(s).getPropertyValue("--a911-z")) || 1;
  const fs = (e) => (e ? parseFloat(getComputedStyle(e).fontSize) : null);
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const chip = s.querySelector(".a911-chip"), pay = s.querySelector(".a911-pay"), hint = s.querySelector(".a911-hint"), send = s.querySelector(".a911-act--send");
  const info = s.querySelector(".a911-sendInfo");
  const lines = info ? [...info.children].filter((e) => e.textContent.trim()) : [];
  return {
    stage: s.dataset.a911Stage, z, chip: fs(chip), pay: fs(pay), hint: fs(hint), hintText: hint?.textContent.trim(), hintColor: hint ? getComputedStyle(hint).color : null,
    hintBelowPay: !!(hint && pay && R(hint).t >= R(pay).b), send: R(send), info: R(info), infoFs: fs(info), infoCut: info ? info.scrollWidth > info.clientWidth + 1 || lines.some((e) => e.scrollWidth > e.clientWidth + 1) : null,
    lines: lines.map((e) => ({ text: e.textContent.trim(), ...R(e) })), vw: innerWidth,
  };
});

try {
  await seed();
  for (const [w, h] of [[390, 844], [810, 1080], [1440, 900]]) {
    await openGiftPick(w, h);
    const m = await measure();
    await p.screenshot({ path: path.join(OUT, `gift-${w}.png`) });
    const z = m.z;
    check(m.stage === "pick", `${w}: Gift is at the pick stage (${m.stage})`);
    check(near(m.chip, 24 * z), `${w}: amount chips ${m.chip?.toFixed(2)} px = 24 × z ${(24 * z).toFixed(2)}`);
    check(near(m.pay, 17 * z), `${w}: from line ${m.pay?.toFixed(2)} px = 17 × z ${(17 * z).toFixed(2)}`);
    check(m.hintText === HINT && near(m.hint, 17 * z) && m.hintColor === "rgb(224, 177, 0)" && m.hintBelowPay, `${w}: hint "${m.hintText}" ${m.hint?.toFixed(2)} px ${m.hintColor} under the from line=${m.hintBelowPay}`);
    const sendMid = m.send ? (m.send.t + m.send.b) / 2 : 0, infoMid = m.info ? (m.info.t + m.info.b) / 2 : -99;
    check(!!m.info && m.lines.length >= 1 && Math.abs(infoMid - sendMid) <= 6 && m.info.r <= m.send.l - 4 && m.info.l >= 0,
      `${w}: fee / gas lines on the Send row, left of Send (info ${JSON.stringify(m.info && [m.info.l, m.info.t, m.info.r, m.info.b].map(Math.round))} · Send ${JSON.stringify(m.send && [m.send.l, m.send.t, m.send.r, m.send.b].map(Math.round))} · ${JSON.stringify(m.lines.map((x) => x.text))})`);
    check(!!m.info && m.infoCut === false && m.infoFs >= 12 * z - 0.5 && m.infoFs <= 14 * z + 0.5, `${w}: fee / gas never cut · ${m.infoFs?.toFixed(2)} px between 12 × z and 14 × z`);
  }
} finally {
  await H.close?.();
}
console.log(`A-1354 Gift type: ${fails === 0 ? "PASS" : `FAIL ${fails}`} · ${OUT}`);
process.exit(fails === 0 ? 0 : 1);
