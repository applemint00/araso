// [A-837] Second / Name / Return v10 measurement + sweep helper (A-835 items 1-5, 8). Reuses the A-819 browser scaffold.
//   CLI (local browser + vite port; run unsandboxed, one at a time):
//     ARASO_TEST_BROWSER=1 node app/test/helpers/a837-sweep.mjs snapshot <outDir> [w,h ...]
//     ARASO_TEST_BROWSER=1 node app/test/helpers/a837-sweep.mjs sweep <outDir> [wFrom=360] [wTo=1920] [step=1] [heights=900,1080]
//   Library: measureScenes(H, w, h) -> { home, name, second, ret } with plain getBoundingClientRect facts (CSS px); stepReport(rows, keys).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { launchSeeded, loadHomeAt, rectOf, sleep } from "./a819-browser.mjs";
import { layoutOracle } from "./a831-sweep.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = path.resolve(HERE, "..", "..", "src", "main.js");
export { sleep, launchSeeded, loadHomeAt, layoutOracle };
const r2 = (x) => Math.round(x * 100) / 100;

function fnSrc(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} missing`);
  let depth = 0, started = false;
  for (let j = src.indexOf("{", i); j < src.length; j += 1) {
    if (src[j] === "{") { depth += 1; started = true; } else if (src[j] === "}") { depth -= 1; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`${name} unterminated`);
}

/** The pure scene layouts from main.js evaluated in a vm: { L, nameSceneLayout, returnLayout }. */
export function sceneOracle(main = readFileSync(MAIN_PATH, "utf8")) {
  const ctx = { Math, window: { innerWidth: 1440, innerHeight: 900 } };
  vm.createContext(ctx);
  const consts = ["HK_STAGE_W", "HK_SIDE_M", "HK_BOTTOM", "HK_CAP", "HK_PAPER_H_PER_W", "HK_CARD_REF_W", "HK_F_PORTRAIT", "HK_F_LANDSCAPE", "HK_INK_L", "HK_INK_R", "HK_INK_FOOT", "HK_INK_TOP",
    "NAME_CARD_BOARD_W", "NAME_CARD_BOARD_CX", "NAME_CARD_BOARD_TOP", "NAME_PEEK_CONTACT_X", "NAME_PEEK_VISIBLE", "NAME_RIG_RATIO", "NAME_CHOG_BOX_W", "NAME_CHOG_BOX_H_PX", "HOME_CHOG_INK_W", "HOME_CHOG_FOOT_GAP",
    "RECEIPT_HOME_CARD_RATIO", "RECEIPT_ASPECT_H_PER_W", "RET_STAGE_REF_W", "RET_GATE_PIGGY_TOP", "RET_CLUSTER_OFF", "RET_CLUSTER_W"].map((n) => main.match(new RegExp(`const ${n} = [^;]+;`))[0]);
  vm.runInContext([
    "const HOME_SEAT_W = 150; const HOME_SEAT_H = (HOME_SEAT_W * 551) / 528; const HOME_CENTER = 1041; const HOME_SEAT_L = HOME_CENTER - 0.4991 * HOME_SEAT_W;",
    ...consts, main.match(/const NAME_CHOG_INK = [^;]+;/)[0],
    main.match(/const hkClamp = [^;]+;/)[0], fnSrc(main, "hkKey"), fnSrc(main, "homeKeyframeLayout"), fnSrc(main, "nameSceneLayout"), fnSrc(main, "returnLayout"),
    "globalThis.__o = { L: homeKeyframeLayout, name: nameSceneLayout, ret: returnLayout };",
  ].join("\n"), ctx);
  return ctx.__o;
}

const FACTS = `(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); if (!(b.width > 0)) return null; return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const brand = document.querySelector(".arasoBrand");
  return { vw: innerWidth, vh: innerHeight, brand: r(".arasoBrand"), brandFont: brand ? parseFloat(getComputedStyle(brand).fontSize) : null,
    bodyBg: getComputedStyle(document.body).backgroundSize, scrollW: document.documentElement.scrollWidth };
})()`;

const rectsIn = (p, sels) => p.evaluate(`(() => { const o = {}; for (const s of ${JSON.stringify(sels)}) { const e = document.querySelector(s); const b = e && e.getBoundingClientRect(); o[s] = b && b.width > 0 ? { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } : null; } return o; })()`);

export async function measureHome(H, w, h) {
  await loadHomeAt(H, w, h, { settle: true });
  const rs = await rectsIn(H.p, ["#homeSeat", "#chogHome img", "#homePaper"]);
  return { ...(await H.p.evaluate(FACTS)), seat: rs["#homeSeat"], chog: rs["#chogHome img"] };
}
export async function measureName(H, w, h, { arrival = false } = {}) {
  await loadHomeAt(H, w, h, { settle: false });
  // arrival = the first-hatch frame: Piggy peeks from behind the card (A-607 arrival pose); the default resumed frame keeps Piggy hidden until Save
  await H.p.evaluate((a) => window.__arasoScene("name", a ? {} : { resumed: true }), arrival);
  await sleep(arrival ? 6500 : 2600);
  const rs = await rectsIn(H.p, [".nameCard", "#namePiggy .pgsvg", ".nameScene__chog img", ".nameScene__chog"]);
  const shot = (await H.p.screenshot()).toString("base64");
  // ink pixels (differing from the ground, outline included) inside the Chog box (+-8 px) and in the band above the card top (the Piggy peek head)
  const px = await H.p.evaluate(async ([b, cb, card]) => { const img = new Image(); img.src = "data:image/png;base64," + b; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, img.width, img.height).data;
    const on = (x, y) => { const i = (y * img.width + x) * 4; return Math.abs(d[i] - 22) > 14; };
    let l = 1e9, r = -1, bt = -1; if (cb) for (let y = Math.max(0, Math.floor(cb.t - 8)); y < Math.min(img.height, Math.ceil(cb.b + 8)); y += 1) for (let x = Math.max(0, Math.floor(cb.l - 8)); x < Math.min(img.width, Math.ceil(cb.r + 8)); x += 1) if (on(x, y)) { if (x < l) l = x; if (x > r) r = x; if (y > bt) bt = y; }
    let peek = 0; if (card) for (let y = Math.max(0, Math.floor(card.t - 140)); y < Math.floor(card.t) - 1; y += 1) for (let x = Math.floor(card.l); x < Math.ceil(card.r); x += 1) if (on(x, y)) peek += 1;
    return { chogInk: r < 0 ? null : { left: l, right: r, bottom: bt }, peekPx: peek }; }, [shot, rs[".nameScene__chog"], rs[".nameCard"]]);
  return { ...(await H.p.evaluate(FACTS)), card: rs[".nameCard"], piggy: rs["#namePiggy .pgsvg"], chog: rs[".nameScene__chog img"], chogBox: rs[".nameScene__chog"], chogInk: px.chogInk, peekPx: px.peekPx };
}
export async function measureSecond(H, w, h) {
  await loadHomeAt(H, w, h, { settle: false });
  await H.p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true }));
  await sleep(2600);
  const rs = await rectsIn(H.p, [".cardAnchor", "#sendCard", "#secondJourneyCard", "#secondWorkStage", "#chogHome img", "#homeSeat"]);
  return { ...(await H.p.evaluate(FACTS)), anchor: rs[".cardAnchor"], card: rs["#secondJourneyCard"] || rs["#sendCard"], canvas: rs["#secondWorkStage"], chog: rs["#chogHome img"], seat: rs["#homeSeat"] };
}
export async function measureReturn(H, w, h) {
  await loadHomeAt(H, w, h, { settle: false });
  await H.p.evaluate(() => window.__arasoScene("return", { arrival: true }));
  for (let i = 0; i < 30; i += 1) {
    await sleep(500);
    if (await H.p.evaluate(() => { const t = document.querySelector("#returnTap"); return !!t && !t.hidden && t.getBoundingClientRect().width > 4; })) break;
  }
  await sleep(700);
  const rs = await rectsIn(H.p, [".receiptPaper", "#returnTap", "#returnStage", "#chogHome img", "#returnChogHop"]);
  const f = await H.p.evaluate(FACTS);
  const paper = rs[".receiptPaper"] || rs["#returnTap"];
  // settled-frame cluster bbox from pixels: everything below / right of the Receipt that differs from the notebook ground (22 +- 14), caption (yellow) excluded
  // [A-845 · Cowork] the "… is coming home" line (#returnArrivalAlarm) is Chog text, not the character cluster: hidden (visibility only) for the scan, restored after.
  // pre-A-845: scan included the arrival line (passed by coincidence)
  const alarmVis = await H.p.evaluate(() => { const a = document.querySelector("#returnArrivalAlarm"); if (!a) return null; const v = a.style.visibility; a.style.visibility = "hidden"; return v; });
  const shot = (await H.p.screenshot()).toString("base64");
  if (alarmVis !== null) await H.p.evaluate((v) => { const a = document.querySelector("#returnArrivalAlarm"); if (a) a.style.visibility = v; }, alarmVis);
  const cluster = await H.p.evaluate(async ([b, px0, py0]) => { const img = new Image(); img.src = "data:image/png;base64," + b; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, img.width, img.height).data; let l = 1e9, r = -1; for (let y = Math.floor(py0); y < img.height; y += 1) for (let x = Math.floor(px0); x < img.width; x += 1) { const i = (y * img.width + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2]; if (R > 150 && G > 110 && B < 90) continue; if (Math.abs(R - 22) > 14) { if (x < l) l = x; if (x > r) r = x; } } return r < 0 ? null : { left: l, right: r, centre: (l + r) / 2 }; }, [shot, ...(paper && Math.abs((paper.l + paper.r) / 2 - f.vw / 2) < f.vw * 0.08 ? [0, paper.b + 24] : [paper ? paper.r + 12 : 0, 0])]);
  return { ...f, paper, tap: rs["#returnTap"], canvas: rs["#returnStage"], chog: rs["#chogHome img"], hop: rs["#returnChogHop"], cluster };
}

/** rows (sorted by width, same height) -> { key: { maxStepPct, atW } } for numeric keys (dot paths). */
export function stepReport(rows, keys) {
  const get = (o, k) => k.split(".").reduce((a, c) => (a == null ? null : a[c]), o);
  const out = {};
  for (const k of keys) {
    let max = 0, at = null;
    for (let i = 1; i < rows.length; i += 1) {
      const a = get(rows[i - 1], k), b = get(rows[i], k);
      if (typeof a !== "number" || typeof b !== "number" || !a) continue;
      const pct = Math.abs(b - a) / Math.abs(a) * 100;
      if (pct > max) { max = pct; at = rows[i].vw; }
    }
    out[k] = { maxStepPct: r2(max), atW: at };
  }
  return out;
}

// the first evaluate after a scene jump can race a reload ("Execution context was destroyed"): retry the whole measurement
const retry = async (fn, n = 3) => { for (let i = 0; ; i += 1) { try { return await fn(); } catch (e) { if (i >= n - 1) throw e; await sleep(800); } } };
async function main() {
  const [cmd, outDir, ...rest] = process.argv.slice(2);
  if (!cmd || !outDir) throw new Error("usage: a837-sweep.mjs snapshot|sweep <outDir> ...");
  mkdirSync(outDir, { recursive: true });
  const H = await launchSeeded();
  try {
    if (cmd === "snapshot") {
      const sizes = (rest.length ? rest : ["390,844", "810,1080", "1440,900"]).map((s) => s.split(",").map(Number));
      const all = [];
      for (const [w, h] of sizes) {
        const row = { w, h, home: await retry(() => measureHome(H, w, h)) };
        await H.p.screenshot({ path: path.join(outDir, `home_${w}x${h}.png`) });
        row.name = await retry(() => measureName(H, w, h)); await H.p.screenshot({ path: path.join(outDir, `name_${w}x${h}.png`) });
        row.nameArrival = await retry(() => measureName(H, w, h, { arrival: true })); await H.p.screenshot({ path: path.join(outDir, `name_arrival_${w}x${h}.png`) });
        row.second = await retry(() => measureSecond(H, w, h)); await H.p.screenshot({ path: path.join(outDir, `second_${w}x${h}.png`) });
        row.ret = await retry(() => measureReturn(H, w, h)); await H.p.screenshot({ path: path.join(outDir, `return_${w}x${h}.png`) });
        all.push(row);
      }
      writeFileSync(path.join(outDir, "snapshot.json"), JSON.stringify(all, null, 1));
    } else if (cmd === "sweep") {
      const [from = "360", to = "1920", step = "1", heights = "900,1080"] = rest;
      const summary = {};
      for (const h of heights.split(",").map(Number)) {
        const rows = [];
        for (let w = Number(from); w <= Number(to); w += Number(step)) {
          await H.p.setViewportSize({ width: w, height: h });
          await sleep(120);
          const f = await H.p.evaluate(FACTS);
          rows.push({ vw: w, ...f });
        }
        writeFileSync(path.join(outDir, `sweep_${h}.json`), JSON.stringify(rows));
        summary[h] = stepReport(rows, ["brandFont", "brand.l", "brand.t"]);
      }
      writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 1));
    }
  } finally {
    await H.close?.();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
