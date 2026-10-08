// [A-819] browser scaffold + measurement library for the UI Wave-1 responsive-composition card
// (UI-14 Home / UI-10 Name / UI-17 Return Receipt / UI-22 Second work Piggy / UI-03 Invite).
// Reuses the A-803 launcher (a172-local vite dev server + virtual passkey, offline context, DEV scene jump).
//
//   CLI (writes JSON + screenshots):  ARASO_TEST_BROWSER=1 node app/test/helpers/a819-browser.mjs <phase> <item|all> [outDir]
//     phase = before | after ; item = home | name | return | second | invite | all
//   Library (used by app/test/a819-responsive-composition-wave1.mjs): launchSeeded(), measureHome/Name/Return/Second/Invite().
//
// Every measurement is a plain getBoundingClientRect / computed-style fact, in CSS px. Nothing here edits the app.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep, REPO } from "./a803-browser.mjs";

export { sleep, REPO, launch };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const r2 = (x) => Math.round(x * 100) / 100;

// ---- matrices (card: boundary matrix + representative matrix) -------------------------------------------------------
export const HEIGHTS_BOUNDARY = [755, 805, 600];
export const BOUNDARY_640 = [639, 640, 641];
export const BOUNDARY_653 = [653, 654];
export const REPRESENTATIVE = [[390, 844], [430, 932], [700, 900], [1024, 768], [1180, 820], [1440, 900]];

// ---- page helpers -----------------------------------------------------------------------------------------------------
const RECT_FN = `(sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); if (!(b.width > 0 || b.height > 0)) return null; return { l: +b.left.toFixed(2), t: +b.top.toFixed(2), r: +b.right.toFixed(2), b: +b.bottom.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; }`;
export const rectOf = (p, sel) => p.evaluate(`(${RECT_FN})(${JSON.stringify(sel)})`);
const rectsOf = (p, sels) => p.evaluate(`(() => { const f = ${RECT_FN}; const o = {}; for (const s of ${JSON.stringify(sels)}) o[s] = f(s); return o; })()`);

export async function launchSeeded(name = "Honeybun") {
  const H = await launch();
  await H.seedSolo(name);
  return H;
}

/** Fresh load at (w,h) landing on Home (sendstay). settle=true waits the Home arrival/settle (A-803 atWidth shape). */
export async function loadHomeAt(H, w, h, { settle = true } = {}) {
  const { p } = H;
  await p.setViewportSize({ width: w, height: h });
  await p.reload({ waitUntil: "networkidle" });
  await sleep(600);
  await H.unlock();
  await H.waitScene(["sendstay"], 9000);
  await sleep(settle ? 4500 : 500);
}

const unionRect = (rs) => {
  const v = rs.filter(Boolean);
  if (!v.length) return null;
  const l = Math.min(...v.map((x) => x.l)), t = Math.min(...v.map((x) => x.t)), r = Math.max(...v.map((x) => x.r)), b = Math.max(...v.map((x) => x.b));
  return { l: r2(l), t: r2(t), r: r2(r), b: r2(b), w: r2(r - l), h: r2(b - t) };
};

// ---- UI-14 Home ---------------------------------------------------------------------------------------------------------
export async function measureHome(H, w, h, { shot = null, paper = false } = {}) {
  const { p } = H;
  await loadHomeAt(H, w, h);
  const rs = await rectsOf(p, ["#homeBoard", "#homeSeat", "#homeWalk", "#chogHome img", "#homeName", ".arasoBrand"]);
  const floor = await p.evaluate(() => { const g = document.querySelector(".homeCharScaleFloor"); return g ? { style: g.getAttribute("style"), drop: g.getAttribute("data-mid-band-drop"), floor: g.getAttribute("data-scale-floor") } : null; });
  const piggy = rs["#homeSeat"] || rs["#homeWalk"];
  const chog = rs["#chogHome img"];
  const out = {
    vw: w, vh: h, group: floor,
    brand: rs[".arasoBrand"],
    piggy: piggy && { ...piggy, footY: piggy.b, cx: r2((piggy.l + piggy.r) / 2) },
    chog: chog && { ...chog, footY: chog.b, cx: r2((chog.l + chog.r) / 2) },
    // A-815 review metrics
    chogToPiggyH: piggy && chog ? r2(chog.h / piggy.h) : null,
    chogToPiggyW: piggy && chog ? r2(chog.w / piggy.w) : null,
    stage: unionRect([piggy, chog, rs["#homeName"]]),
  };
  if (paper) {
    const open = await H.openHomePaper();
    await sleep(900);
    out.paperOpen = open;
    out.paper = await rectOf(p, "#homePaper");
  }
  if (shot) await p.screenshot({ path: shot });
  return out;
}

// ---- UI-10 Name ---------------------------------------------------------------------------------------------------------
export async function measureName(H, w, h, { shot = null } = {}) {
  const { p } = H;
  await loadHomeAt(H, w, h, { settle: false });
  await p.evaluate(() => window.__arasoScene("name", { resumed: true }));
  await sleep(2600);
  const rs = await rectsOf(p, ["#nameScene", ".nameCard", "#namePiggy .pgsvg", ".nameScene__chog img", ".nameScene__chogWeb", ".nameScene__chog", ".arasoBrand"]);
  const tr = await p.evaluate(() => { const b = document.querySelector("#nameScene"); const m = b ? new DOMMatrix(getComputedStyle(b).transform) : null; return m ? { scale: +m.a.toFixed(5), tx: +m.e.toFixed(2), ty: +m.f.toFixed(2) } : null; });
  const chog = rs[".nameScene__chog img"] || rs[".nameScene__chogWeb"];
  const card = rs[".nameCard"], piggy = rs["#namePiggy .pgsvg"];
  const out = {
    vw: w, vh: h, board: tr, brand: rs[".arasoBrand"],
    card, piggy, chog, chogVariant: rs[".nameScene__chog img"] ? "stage-sibling" : "in-board",
    cardW_over_460: card ? r2(card.w / 460) : null,
    chogToCardW: card && chog ? r2(chog.w / card.w) : null,
    chogFootY: chog ? chog.b : null,
    // composition footprint = card + main Piggy (peek rig) + Chog
    footprint: unionRect([card, piggy, chog]),
  };
  if (shot) await p.screenshot({ path: shot });
  return out;
}

// ---- UI-17 Return delivered Receipt -------------------------------------------------------------------------------------
export async function measureReturn(H, w, h, { shot = null } = {}) {
  const { p } = H;
  await loadHomeAt(H, w, h, { settle: false });
  await p.evaluate(() => window.__arasoScene("return", { arrival: true }));
  let got = false;
  for (let i = 0; i < 30 && !got; i += 1) {
    await sleep(500);
    got = await p.evaluate(() => { const t = document.querySelector("#returnTap"); return !!t && !t.hidden && t.getBoundingClientRect().width > 4; });
  }
  await sleep(700);
  const m = await p.evaluate(() => {
    const paper = document.querySelector(".receiptPaper");
    if (!paper) return null;
    const mat = new DOMMatrix(getComputedStyle(paper).transform);
    const sc = Math.hypot(mat.a, mat.b);
    const fs = (s) => { const e = document.querySelector(s); return e ? parseFloat(getComputedStyle(e).fontSize) : null; };
    const row = fs(".receiptPaper__row"), date = fs(".receiptPaper__date");
    return { paperScale: +sc.toFixed(4), bodyCss: row, bodyEffective: row ? +(row * sc).toFixed(3) : null, dateCss: date, dateEffective: date ? +(date * sc).toFixed(3) : null };
  });
  const rs = await rectsOf(p, [".receiptPaper", "#returnTap", "#returnStage", "#chogHome img", ".arasoBrand", "#returnHint"]);
  const out = {
    vw: w, vh: h, delivered: got, ...m,
    paper: rs[".receiptPaper"] || rs["#returnTap"], tap: rs["#returnTap"], stage: rs["#returnStage"], chog: rs["#chogHome img"], brand: rs[".arasoBrand"], hint: rs["#returnHint"],
    overflow: (() => { const q = rs["#returnTap"]; return q ? !(q.l >= -0.5 && q.t >= -0.5 && q.r <= w + 0.5 && q.b <= h + 0.5) : null; })(),
  };
  if (shot) await p.screenshot({ path: shot });
  return out;
}

// ---- UI-22 Second work Piggy --------------------------------------------------------------------------------------------
// The Explore (Second) work canvas is the whole 1256x772 board, drawn with Piggy's foot at board point (HOME_CENTER 1041, HOME_FLOOR 648).
// So Piggy foot / centre are read from the canvas rect, the same way the First Send canvas is.
const HOME_BOARD_W = 1256, HOME_BOARD_H = 772, HOME_CENTER = 1041, HOME_FLOOR = 648;
export async function seedSecondFixture(H) {
  const { p } = H;
  await p.evaluate(() => { const a = localStorage.getItem("araso.address"); const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a819f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa819-dep", redeemTxHash: "0xa819-red", grantTxHash: "0xa819-grant", status: "success", at: Date.parse("2026-09-29T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` }; localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1"); });
}
export async function measureSecond(H, w, h, { shot = null } = {}) {
  const { p } = H;
  await loadHomeAt(H, w, h, { settle: false });
  await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true }));
  await sleep(2600);
  const canvasSel = "#secondWorkStage";
  const c = await rectOf(p, canvasSel);
  const rs = await rectsOf(p, ["#chogHome img", ".arasoBrand", ".cardAnchor", "#homeSeat"]);
  const seatHidden = await p.evaluate(() => { const s = document.querySelector("#homeSeat"); return s ? getComputedStyle(s).visibility === "hidden" : null; });
  const k = c ? c.w / HOME_BOARD_W : null;
  const out = {
    vw: w, vh: h, canvas: c, seatHidden,
    pivotX: c ? r2(c.l + HOME_CENTER * k) : null,
    footY: c ? r2(c.t + HOME_FLOOR * k) : null,
    effectiveScale: k ? r2(k) : null,
    chog: rs["#chogHome img"], chogFootY: rs["#chogHome img"] ? rs["#chogHome img"].b : null, card: rs[".cardAnchor"], brand: rs[".arasoBrand"],
    // the resident Home seat (hidden while the work canvas draws) keeps its layout box: the shared stage baseline the work Piggy must agree with
    seat: rs["#homeSeat"], seatFootY: rs["#homeSeat"] ? rs["#homeSeat"].b : null,
  };
  out.footMinusSeatFoot = out.seatFootY != null && out.footY != null ? r2(out.footY - out.seatFootY) : null;
  if (shot) await p.screenshot({ path: shot });
  return out;
}

// ---- UI-03 Invite -------------------------------------------------------------------------------------------------------
export async function launchFresh() {
  const H = await launch();
  await H.p.goto(H.BASE, { waitUntil: "networkidle" });
  return H;
}
const inviteFacts = (p) => p.evaluate(() => {
  const f = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { l: +b.left.toFixed(2), t: +b.top.toFixed(2), r: +b.right.toFixed(2), b: +b.bottom.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; };
  const board = document.querySelector(".invite");
  const env = document.querySelector(".invite__env");
  const anims = env ? env.getAnimations().map((a) => ({ name: a.animationName, t: a.currentTime == null ? null : Math.round(Number(a.currentTime)), local: (() => { try { const lt = a.effect.getComputedTiming().localTime; return lt == null ? null : Math.round(Number(lt)); } catch { return null; } })(), active: (() => { try { const ct = a.effect.getComputedTiming(); return ct.localTime == null ? null : Math.round(Number(ct.localTime) - Number(ct.delay || 0)); } catch { return null; } })() })) : [];
  return {
    vw: innerWidth, vh: innerHeight, kind: board?.dataset.kind || null, phase: board?.dataset.phase || null, tr: board ? getComputedStyle(board).transform : null,
    board: f(".invite"), paper: f(".invite__paper"), hero: f(".invite__hero"), envImg: f(".invite__envImg--closed"), face: f("#inviteFaceButton"), brand: f(".arasoBrand"),
    envAnim: env ? env.style.animation : null, anims,
  };
});
export async function measureInviteStatic(H, w, h, { shot = null } = {}) {
  const { p } = H;
  await p.setViewportSize({ width: w, height: h });
  await p.reload({ waitUntil: "networkidle" });
  await sleep(900);
  const o = await inviteFacts(p);
  if (shot) await p.screenshot({ path: shot });
  return o;
}
/** Start the envelope at `fromW`, resize across the 900 boundary at `at` ms into the timeline, report the phase before/after. */
export async function measureInvitePhaseResize(H, fromW, toW, h, { atMs = 1500, afterMs = [60, 400, 1200] } = {}) {
  const { p } = H;
  await p.setViewportSize({ width: fromW, height: h });
  await p.reload({ waitUntil: "networkidle" });
  await sleep(900);
  await p.evaluate(() => document.querySelector("#inviteFaceButton")?.click());
  const t0 = Date.now();
  await sleep(atMs);
  const before = await inviteFacts(p);
  before.elapsedMs = Date.now() - t0;
  await p.setViewportSize({ width: toW, height: h });
  const samples = [];
  let last = 0;
  for (const d of afterMs) { await sleep(d - last); last = d; const s = await inviteFacts(p); s.sinceResizeMs = d; s.elapsedMs = Date.now() - t0; samples.push(s); }
  return { fromW, toW, h, before, after: samples };
}

// ---- CLI ----------------------------------------------------------------------------------------------------------------
async function cli() {
  const [phase = "before", item = "all", outArg] = process.argv.slice(2);
  const out = path.resolve(outArg || path.join(REPO, "_private/ops/receipts/A819_ui_wave1_responsive", phase));
  mkdirSync(path.join(out, "shots"), { recursive: true });
  const want = (n) => item === "all" || item === n;
  const save = (name, obj) => writeFileSync(path.join(out, name), JSON.stringify(obj, null, 1));
  const shotPath = (n) => path.join(out, "shots", `${n}.png`);
  const boundary = [];
  for (const h of HEIGHTS_BOUNDARY) for (const w of BOUNDARY_640) boundary.push([w, h]);
  for (const w of BOUNDARY_653) boundary.push([w, 755]);
  const rep = REPRESENTATIVE;

  if (want("home")) {
    const H = await launchSeeded();
    try {
      const rows = [];
      const list = [...boundary, [653, 805], [654, 805], ...rep];
      for (const [w, h] of list) { rows.push(await measureHome(H, w, h, { shot: shotPath(`home_${w}x${h}`), paper: h !== 600 })); console.log("home", w, h); }
      save("home.json", rows);
    } finally { await H.close(); }
  }
  if (want("name")) {
    const H = await launchSeeded();
    try {
      const rows = [];
      const list = [...BOUNDARY_640.flatMap((w) => [805, 600].map((h) => [w, h])), ...rep];
      for (const [w, h] of list) { rows.push(await measureName(H, w, h, { shot: shotPath(`name_${w}x${h}`) })); console.log("name", w, h); }
      save("name.json", rows);
    } finally { await H.close(); }
  }
  if (want("return")) {
    const H = await launchSeeded();
    try {
      const rows = [];
      const list = [...BOUNDARY_640.flatMap((w) => [808, 600].map((h) => [w, h])), [653, 808], [654, 808], ...rep];
      for (const [w, h] of list) { rows.push(await measureReturn(H, w, h, { shot: shotPath(`return_${w}x${h}`) })); console.log("return", w, h); }
      save("return.json", rows);
    } finally { await H.close(); }
  }
  if (want("second")) {
    const H = await launchSeeded();
    try {
      await seedSecondFixture(H);
      const rows = [];
      const list = [...BOUNDARY_640.map((w) => [w, 755]), ...BOUNDARY_653.map((w) => [w, 755]), [640, 805], [641, 805], [653, 805], [654, 805], ...rep];
      for (const [w, h] of list) { rows.push(await measureSecond(H, w, h, { shot: shotPath(`second_${w}x${h}`) })); console.log("second", w, h); }
      save("second.json", rows);
    } finally { await H.close(); }
  }
  if (want("invite")) {
    const H = await launchFresh();
    try {
      const stat = [];
      for (const [w, h] of [[899, 675], [900, 675], [901, 675], [899, 800], [900, 800], [901, 800], [899, 1000], [900, 1000], [901, 1000], ...rep]) { stat.push(await measureInviteStatic(H, w, h, { shot: shotPath(`invite_${w}x${h}`) })); console.log("invite", w, h); }
      const resize = [];
      for (const [a, b] of [[901, 899], [899, 901]]) { resize.push(await measureInvitePhaseResize(H, a, b, 800)); console.log("invite resize", a, b); }
      save("invite.json", { static: stat, resize });
    } finally { await H.close(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP - set ARASO_TEST_BROWSER=1"); process.exit(0); }
  cli().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
