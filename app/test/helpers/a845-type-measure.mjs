// [A-845 · A-843] Text-style measurement helper: ON-SCREEN px per text role, card widths, overflow / clipping / overlap, 1 px sweeps.
// Reuses the A-803 launcher (a172-local vite dev server + virtual passkey, offline context, DEV scene jump). Read-only: nothing here edits
// the app. The Home Chog lines are probes = the real classes / ids inserted into #chogHome (same parent as the real ones), because the
// real "… is coming home" / away lines need an on-chain trip; the real "tap me!" is also sampled at 390x844 on first arrival.
//   Library: measureAll(outDir) -> result (also written to outDir/a845_measure.json + outDir/shots/*.png); evaluate(result) -> misses.
//   CLI:     ARASO_TEST_BROWSER=1 node app/test/helpers/a845-type-measure.mjs [outDir]   (also writes outDir/a845_evaluate.json)
//   BEFORE:  A845_CSS_FROM=_private/ops/receipts/A845_type_styles/pre/app_src_style.css ARASO_TEST_BROWSER=1 \
//              node app/test/helpers/a845-type-measure.mjs _private/ops/receipts/A845_type_styles/browser_pre
//            (same walk, page style.css swapped to the pre-A-845 copy; compare overflow / hitAreaReach / lineBoxOverlaps / overlaps)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep, REPO } from "./a803-browser.mjs";

export const STYLE_PX = { title: 26, choice: 18, button: 16, body: 14, label: 13, detail: 12, weekday: 12 * 0.7 };
export const SIZES = [[390, 844], [810, 1080], [1440, 900]];
export const SWEEP_H = 900;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export const SWEEP_W = [...range(385, 395), ...range(630, 650), ...range(805, 815), ...range(1095, 1105), ...range(1435, 1445)];
// scene -> reference box (card; Chog = the Chog hit box, i.e. the character stage) + [selector, role]. Every visible match is measured.
export const SCENES = {
  send: { card: "#sendCard", roles: [["#sendCard .sendCard__titleText", "title"], ["#sendCard .sendCard__termLabel", "body"], ["#sendCard .sendCard__message", "body"], ["#sendCard .sendCard__detail", "detail"], ["#sendCard .sendCard__day", "detail"], ["#sendCard .sendCard__weekday", "weekday"], ["#sendCard .sendCard__dom", "detail"], ["#sendCard #sendButton .pkbtn__word", "button"]] },
  interests: { card: "#secondJourneyCard", roles: [["#secondJourneyCard .secondJourney__exploreText", "title"], ["#secondJourneyCard .secondJourney__list--interests .secondJourney__item", "body"], ["#secondJourneyCard #stayButton", "label"], ["#secondJourneyCard .secondJourney__date", "detail"], ["#secondJourneyCard .secondJourney__date small", "weekday"], ["#secondJourneyCard .secondJourney__page", "detail"], ["#secondJourneyCard .pkbtn__word", "button"], ["#secondJourneyCard .secondJourney__hint", "body"], ["#secondJourneyCard .secondJourney__reason", "body"]] },
  candidates: { card: "#secondJourneyCard", roles: [["#secondJourneyCard .secondJourney__exploreText", "title"], ["#secondJourneyCard .secondJourney__pick", "choice"], ["#secondJourneyCard #stayButton", "label"], ["#secondJourneyCard #secondOkButton .pkbtn__word", "button"], ["#secondJourneyCard .secondJourney__date", "detail"], ["#secondJourneyCard .secondJourney__date small", "weekday"], ["#secondJourneyCard #secondPickedLine", "body"], ["#secondJourneyCard #secondSendReason", "body"]] },
  nameArrival: { card: ".nameCard", roles: [[".nameCard__gotLine", "title"], [".nameCard__day", "detail"], [".nameCard__weekday", "weekday"], [".nameCard__ok .pkbtn__word", "button"]] },
  nameName: { card: ".nameCard", roles: [[".nameCard__titleText", "title"], ["#piggyNameInput", "choice"], [".nameCard__day", "detail"], [".nameCard__weekday", "weekday"], [".nameCard__save .pkbtn__word", "button"]] },
  chog: { card: "#chogHomeHit", roles: [["#a845TapCue", "choice"], ["#returnArrivalAlarm", "choice"], ["#awayRestoreLine", "choice"]] },
  exploreSay: { card: "#chogHomeHit", roles: [["#exploreChogSay", "choice"]] },
  receipt: { card: "#returnTap .receiptPaper", roles: [["#returnTap .receiptPaper__date", "receipt"], ["#returnTap .receiptPaper__name", "receipt"], ["#returnTap .receiptPaper__row", "receipt"], ["#returnTap .receiptPaper__status", "receipt"]] },
  // [A-845 R3 · review] Second readiness / claim step. "unknown" = the large numerals left UNKNOWN by Cowork Q2 (a): recorded, no size target.
  readiness: { card: "#secondJourneyCard", roles: [["#secondJourneyCard h1.job", "choice"], ["#secondJourneyCard .amount label", "label"], ["#secondJourneyCard .receive label", "label"], ["#secondJourneyCard #secondBalanceLine", "detail"], ["#secondJourneyCard #secondConditionLine", "body"], ["#secondJourneyCard #secondAmountError", "body"], ["#secondJourneyCard .claim-bring", "detail"], ["#secondJourneyCard #stayButton", "label"], ["#secondJourneyCard .pkbtn__word", "button"], ["#secondJourneyCard .secondJourney__date", "detail"], ["#secondJourneyCard .secondJourney__date small", "weekday"], ["#secondJourneyCard #secondSendReason", "body"], ["#secondJourneyCard #secondAmount", "unknown"], ["#secondJourneyCard .field span", "unknown"], ["#secondJourneyCard .claim-value", "unknown"]] },
  // [A-845 R2 · review] the same receipt paper in its other two homes: the Second Return delivery (main.js renderSecondReturn) and the filebox
  // scene (renderFileBox, fixed .filebox__paper box) — with a seeded real receipt, so the fields carry values, not "—" / "> Unknown".
  secondReceipt: { card: "#returnTap .receiptPaper", roles: [["#returnTap .receiptPaper__date", "receipt"], ["#returnTap .receiptPaper__name", "receipt"], ["#returnTap .receiptPaper__row", "receipt"], ["#returnTap .receiptPaper__status", "receipt"]] },
  filebox: { card: ".filebox__paper .receiptPaper", roles: [[".filebox__paper .receiptPaper__date", "receipt"], [".filebox__paper .receiptPaper__name", "receipt"], [".filebox__paper .receiptPaper__row", "receipt"], [".filebox__paper .receiptPaper__status", "receipt"]] },
};
const CARD_SCENES = ["send", "interests", "candidates", "nameArrival", "nameName", "readiness"];
const RECEIPT_SCENES = ["receipt", "secondReceipt", "filebox"];
const CHOG_SCENES = ["chog", "exploreSay"];

// In-page measurement (stringified). k = product of the horizontal scale of every transform / `scale` / zoom from the element up.
const MEASURE = `(([cardSel, roles]) => {
  const r2 = (n) => Math.round(n * 100) / 100;
  const vis = (e) => { if (!e || e.closest("[hidden]")) return false; const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.display !== "none" && cs.visibility !== "hidden" && b.width > 0 && b.height > 0; };
  const kOf = (e) => { let k = 1; for (let a = e; a && a.nodeType === 1; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.transform && cs.transform !== "none") { const m = new DOMMatrix(cs.transform); k *= Math.hypot(m.a, m.b); } if (cs.scale && cs.scale !== "none") k *= parseFloat(cs.scale); if (cs.zoom && cs.zoom !== "normal" && cs.zoom !== "1") k *= parseFloat(cs.zoom); } return k; };
  const textRect = (e) => { if (e.tagName === "INPUT") return e.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(e); const b = rg.getBoundingClientRect(); return b.width > 0 ? b : e.getBoundingClientRect(); };
  // rotation (rad) accumulated from the element up (titles are rotate(-2deg))
  const angOf = (e) => { let t = 0; for (let a = e; a && a.nodeType === 1; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.transform && cs.transform !== "none") { const m = new DOMMatrix(cs.transform); t += Math.atan2(m.b, m.a); } } return t; };
  // INK quads: each line's content-area rect (Range client rect; for a rotated element its axis-aligned bbox is un-rotated back to W x H),
  // narrowed vertically to the string's real glyph extent from canvas TextMetrics (actualBoundingBoxAscent/Descent vs fontBoundingBox*),
  // then rotated again. A content-area (line-box) overlap with no ink overlap is not a visible collision.
  const ctx2d = document.createElement("canvas").getContext("2d");
  const inkQuads = (e, txt) => {
    if (e.tagName === "INPUT") { const b = e.getBoundingClientRect(); return [[[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]]]; }
    const cs = getComputedStyle(e);
    ctx2d.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    const mt = ctx2d.measureText(txt || "Hg");
    const fA = mt.fontBoundingBoxAscent, fD = mt.fontBoundingBoxDescent, iA = mt.actualBoundingBoxAscent, iD = mt.actualBoundingBoxDescent;
    const rg = document.createRange(); rg.selectNodeContents(e);
    const th = angOf(e), c = Math.cos(th), s = Math.abs(Math.sin(th)), rot = Math.abs(th) > 1e-3;
    return [...rg.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5).map((r) => {
      const den = c * c - s * s;
      const W = rot ? (r.width * c - r.height * s) / den : r.width, Hh = rot ? (r.height * c - r.width * s) / den : r.height;
      const kk = Hh / (fA + fD); // on-screen px per font unit for this line box (includes any scaleY)
      const y0 = -Hh / 2 + (fA - iA) * kk, y1 = -Hh / 2 + (fA + iD) * kk;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return [[-W / 2, y0], [W / 2, y0], [W / 2, y1], [-W / 2, y1]].map(([x, y]) => [Math.round((cx + x * Math.cos(th) - y * Math.sin(th)) * 100) / 100, Math.round((cy + x * Math.sin(th) + y * Math.cos(th)) * 100) / 100]);
    });
  };
  // horizontal reach of a transparent ::after tap-area box (A-412 / A-621 / A-735): it inflates scrollWidth but draws nothing
  const afterReach = (e) => { const a = getComputedStyle(e, "::after"); if (!a || a.content === "none" || a.position !== "absolute") return 0; const r = parseFloat(a.right); return Number.isFinite(r) && r < 0 ? -r : 0; };
  const card = document.querySelector(cardSel);
  const cardOk = vis(card);
  const ck = cardOk ? kOf(card) : null;
  const cr = cardOk ? card.getBoundingClientRect() : null;
  const out = { vw: innerWidth, vh: innerHeight, card: cardOk ? { w: r2(card.offsetWidth * ck), k: ck, rect: { l: r2(cr.left), t: r2(cr.top), r: r2(cr.right), b: r2(cr.bottom) } } : null, items: [] };
  for (const [sel, role] of roles) {
    for (const e of document.querySelectorAll(sel)) {
      if (!vis(e)) continue;
      const cs = getComputedStyle(e); const k = kOf(e); const fs = parseFloat(cs.fontSize); const tr = textRect(e);
      const lh = parseFloat(cs.lineHeight) || fs * 1.2;
      const block = cs.display !== "inline";
      const txt = (e.value || e.textContent || "").trim().replace(/\\s+/g, " ");
      const reach = afterReach(e);
      // text overflow = the text itself (its Range width, in the element's own px) wider than the box; scrollWidth also counts the ::after tap area
      const textW = e.tagName === "INPUT" ? 0 : tr.width / k;
      out.items.push({ sel, role, text: txt.slice(0, 40), css: r2(fs), lhCss: cs.lineHeight, k: Math.round(k * 1e5) / 1e5, px: r2(fs * k),
        rect: { l: r2(tr.left), t: r2(tr.top), r: r2(tr.right), b: r2(tr.bottom) }, ink: inkQuads(e, txt), lines: Math.max(1, Math.round(tr.height / (lh * k))),
        overflowX: block && e.clientWidth > 0 ? e.scrollWidth > e.clientWidth + 1 : false, sw: e.scrollWidth, cw: e.clientWidth, afterReach: reach,
        textOverflowX: block && e.clientWidth > 0 ? textW > e.clientWidth + 1 || e.scrollWidth - reach > e.clientWidth + 1 : false, textW: r2(textW) });
    }
  }
  return out;
})`;

const vp = async (H, w, h) => { await H.p.setViewportSize({ width: w, height: h }); await sleep(450); };
const measureScene = (H, key) => H.p.evaluate(`${MEASURE}(${JSON.stringify([SCENES[key].card, SCENES[key].roles])})`);
const visible = (H, sel) => H.p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && !e.closest("[hidden]") && getComputedStyle(e).visibility !== "hidden"; }, sel);
const waitFor = async (H, sel, ms) => { for (let t0 = Date.now(); Date.now() - t0 < ms;) { if (await visible(H, sel)) return true; await sleep(150); } return false; };

async function sizesAndSweep(H, key, shots, { sweep = true } = {}) {
  const S = { sizes: {}, sweep: [] };
  for (const [w, h] of SIZES) {
    await vp(H, w, h);
    S.sizes[`${w}x${h}`] = await measureScene(H, key);
    await H.p.screenshot({ path: path.join(shots, `${key}_${w}x${h}.png`) });
  }
  if (sweep) for (const w of SWEEP_W) { await vp(H, w, SWEEP_H); S.sweep.push(await measureScene(H, key)); }
  await vp(H, 390, 844);
  return S;
}

const CHOG_PROBES = `(() => {
  const root = document.querySelector("#chogHome"); const hit = root && root.querySelector(".chogHome__hit"); if (!root || !hit) return false;
  for (const id of ["a845TapCue", "returnArrivalAlarm", "awayRestoreLine"]) document.getElementById(id)?.remove();
  const tap = document.createElement("div"); tap.className = "chogHome__tapCue"; tap.id = "a845TapCue"; tap.textContent = "tap me!"; tap.style.left = "449.5px"; tap.style.top = "calc(276px - 0.2222em)"; root.append(tap);
  const al = document.createElement("span"); al.className = "chogCheckLine"; al.id = "returnArrivalAlarm"; al.textContent = "Honeybun is coming home"; root.insertBefore(al, hit);
  const aw = document.createElement("span"); aw.className = "chogCheckLine"; aw.id = "awayRestoreLine"; aw.textContent = "Piggy is still out."; root.insertBefore(aw, hit);
  return true;
})()`;

export async function measureAll(outDir = path.join(REPO, "_private/ops/receipts/A845_type_styles/browser")) {
  const shots = path.join(outDir, "shots"); mkdirSync(shots, { recursive: true });
  const R = { at: new Date().toISOString(), sizes: SIZES, sweepH: SWEEP_H, sweepW: SWEEP_W, notes: [] };
  const H = await launch();
  const { p } = H;
  try {
    await vp(H, 390, 844);
    await p.goto(H.BASE, { waitUntil: "networkidle" });
    // BEFORE comparison (measurement only): A845_CSS_FROM=<path to a style.css copy, e.g. the A845 pre/ copy> swaps the text of the dev
    // server's style.css <style> element in this page (the app files are not touched). The tap cue's size is set by chog-home.js, so the
    // probe "tap me!" is not comparable in that mode.
    if (process.env.A845_CSS_FROM) {
      const css = readFileSync(path.resolve(REPO, process.env.A845_CSS_FROM), "utf8");
      R.cssFrom = process.env.A845_CSS_FROM;
      R.cssSwapped = await p.evaluate((text) => { const s = [...document.querySelectorAll("style")].find((x) => (x.dataset.viteDevId || "").endsWith("/src/style.css")); if (!s) return false; s.textContent = text; return true; }, css);
      if (!R.cssSwapped) throw new Error("A845_CSS_FROM: style.css <style> element not found");
      await sleep(300);
    }
    for (let a = 0; a < 4; a += 1) {
      if (await p.locator("#inviteFaceButton").count()) await p.locator("#inviteFaceButton").click().catch(() => {});
      await p.waitForFunction(() => ["hatch", "name"].includes(document.querySelector("[data-scene]")?.dataset.scene) || document.querySelector("#authTryAgainButton"), { timeout: 25000 }).catch(() => {});
      if (["hatch", "name"].includes(await H.scene())) break;
      await p.locator("#authTryAgainButton").click().catch(() => {}); await sleep(800);
    }
    // Name: the arrival card ("you've got the one piggy !" + ok), then the Name it card
    if (await waitFor(H, ".nameCard__ok .pkbtn__word", 30000)) { await sleep(600); R.nameArrival = await sizesAndSweep(H, "nameArrival", shots); }
    else R.notes.push("name arrival card not seen");
    for (let t0 = Date.now(); Date.now() - t0 < 30000;) { if (await visible(H, "#piggyNameInput")) break; if (await visible(H, ".nameCard__ok .pkbtn")) await p.locator(".nameCard__ok .pkbtn").first().click({ force: true }).catch(() => {}); await sleep(700); }
    await p.locator("#piggyNameInput").fill("Honeybun"); await sleep(300);
    R.nameName = await sizesAndSweep(H, "nameName", shots);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    await H.waitScene(["sendstay"], 10000);
    // the real "tap me!" at 390x844 on first arrival, sampled at full opacity
    for (let t0 = Date.now(); Date.now() - t0 < 8000;) { const op = await p.evaluate(() => { const e = document.querySelector(".chogHome__tapCue"); return e ? Number(e.style.opacity || getComputedStyle(e).opacity) : -1; }); if (op >= 0.99) break; await sleep(60); }
    R.realTapCue = await p.evaluate(`${MEASURE}(${JSON.stringify(["#chogHomeHit", [[".chogHome__tapCue", "choice"]]])})`);
    // First Send card
    if (await waitFor(H, "#sendCard #sendButton", 15000)) { await sleep(3500); R.send = await sizesAndSweep(H, "send", shots); } else R.notes.push("send card not seen");
    await p.evaluate(() => document.querySelector("#sendCard #stayButton")?.click()); await sleep(1500);
    // Chog lines on Home (probes)
    await H.waitScene(["sendstay"], 6000); await sleep(1500);
    if (await p.evaluate(CHOG_PROBES)) { await sleep(200); R.chog = await sizesAndSweep(H, "chog", shots); await p.evaluate(() => ["a845TapCue", "returnArrivalAlarm", "awayRestoreLine"].forEach((id) => document.getElementById(id)?.remove())); }
    else R.notes.push("chog probes not inserted");
    // Second: interests -> candidates
    await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true })); await sleep(2600);
    if (await waitFor(H, "#exploreForm", 8000)) {
      R.interests = await sizesAndSweep(H, "interests", shots);
      if (await visible(H, "#exploreChogSay")) R.exploreSay = await sizesAndSweep(H, "exploreSay", shots, { sweep: false });
      const n = await p.evaluate(() => document.querySelectorAll("#exploreForm input[data-errand-id]").length);
      for (let i = 0; i < Math.min(2, n); i += 1) { await H.mustTap(".secondJourney__item", "tick", i); await sleep(250); }
      await H.mustTap("#exploreSaveButton", "save"); await sleep(3200);
      if (await waitFor(H, "#secondJourneyCard .secondJourney__exploreText", 6000)) {
        R.candidates = await sizesAndSweep(H, "candidates", shots);
        if (await visible(H, "#exploreChogSay")) R.exploreSayCandidates = await sizesAndSweep(H, "exploreSay", shots, { sweep: false });
        // [A-845 R3] readiness / claim step: pick the first enabled candidate, ok, answer a JIT question if one is asked (same path as the A-803
        // seedMulti walk), type an amount so the numerals and claim value are real. Nothing is sent.
        const first = await p.evaluate(() => [...document.querySelectorAll(".secondJourney__pick")].find((b) => !b.disabled && !b.hidden)?.dataset.destinationId);
        if (first) {
          await H.mustTap(`.secondJourney__pick[data-destination-id="${first}"]`, "pick"); await sleep(400);
          await H.mustTap("#secondOkButton", "ok"); await sleep(900);
          if (await visible(H, ".secondJourney__jitBtn")) { await H.mustTap(".secondJourney__jitBtn", "jit"); await sleep(900); }
          if (await waitFor(H, "#secondAmount", 6000)) {
            await p.locator("#secondAmount").fill("1"); await sleep(500);
            R.readiness = await sizesAndSweep(H, "readiness", shots);
          } else R.notes.push("readiness card (#secondAmount) not seen");
        } else R.notes.push("no enabled candidate for the readiness step");
      } else R.notes.push("candidates card not seen");
    } else R.notes.push("explore interests card not seen");
    // Return Receipt (A-843 item 5: phone size x paper scale; recorded + checked in evaluate) and the real coming-home alarm when shown
    await p.evaluate(() => window.__arasoScene("return", { arrival: true }));
    if (await waitFor(H, "#returnTap .receiptPaper", 15000)) { await sleep(800); R.receipt = await sizesAndSweep(H, "receipt", shots); }
    else R.notes.push("receipt not seen");
    // [A-845 R2] a real First receipt (same seed shape as the A-803 seedMulti walk: success, sent 0.1 of 1.0, gas, tx hashes, this Piggy's id),
    // so every receipt field shows a value. Then the Second Return delivery and the filebox scene, each with that seed in state.
    await p.evaluate(() => { const a = localStorage.getItem("araso.address"); const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a845f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa845-dep", redeemTxHash: "0xa845-red", grantTxHash: "0xa845-grant", status: "success", at: Date.parse("2026-10-08T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` }; localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1"); });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600); await H.unlock(); await sleep(1500);
    await p.evaluate(() => window.__arasoScene("secondReturn", { arrival: true }));
    if (await waitFor(H, "#returnTap .receiptPaper", 15000)) { await sleep(800); R.secondReceipt = await sizesAndSweep(H, "secondReceipt", shots); }
    else R.notes.push("second return receipt not seen");
    await p.evaluate(() => window.__arasoScene("filebox"));
    if (await waitFor(H, ".filebox__paper .receiptPaper", 8000)) {
      await sleep(600); R.filebox = await sizesAndSweep(H, "filebox", shots);
      // the filebox paper's fixed boxes: paper vs .filebox__paper / .filebox and the evidence rows (.filebox .receipt) under it, per size
      R.fileboxBoxes = {};
      for (const [w, h] of SIZES) { await vp(H, w, h); R.fileboxBoxes[`${w}x${h}`] = await p.evaluate(() => Object.fromEntries([".filebox", ".filebox__paper", ".filebox__paper .receiptPaper", ".filebox .receipt"].map((s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return [s, b ? { l: Math.round(b.left * 100) / 100, t: Math.round(b.top * 100) / 100, r: Math.round(b.right * 100) / 100, b: Math.round(b.bottom * 100) / 100 } : null]; }))); }
      await vp(H, 390, 844);
    } else R.notes.push("filebox receipt not seen");
  } catch (e) {
    R.error = String((e && e.stack) || e).slice(0, 800);
    await p.screenshot({ path: path.join(shots, "error.png") }).catch(() => {});
  } finally {
    R.pageErrors = H.errors;
    await H.close();
  }
  writeFileSync(path.join(outDir, "a845_measure.json"), JSON.stringify(R, null, 1));
  return R;
}

/** Ink penetration between two lists of convex quads (separating-axis test): max over quad pairs of the smallest overlap along any edge
 *  normal. > 0 = overlap depth in px, <= 0 = -gap (largest separation). null when either side has no ink quads. */
export function inkPenetration(A, B) {
  if (!A?.length || !B?.length) return null;
  const axes = (q) => q.map((p, i) => { const n = q[(i + 1) % q.length]; const dx = n[0] - p[0], dy = n[1] - p[1]; const L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; });
  const proj = (q, ax) => { let lo = Infinity, hi = -Infinity; for (const p of q) { const v = p[0] * ax[0] + p[1] * ax[1]; if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };
  let best = -Infinity;
  for (const a of A) for (const b of B) {
    let pen = Infinity;
    for (const ax of [...axes(a), ...axes(b)]) { const [a0, a1] = proj(a, ax), [b0, b1] = proj(b, ax); pen = Math.min(pen, Math.min(a1, b1) - Math.max(a0, b0)); }
    best = Math.max(best, pen);
  }
  return best;
}

/** Pure: evidence-contract misses from a measureAll() result. Empty arrays = pass. table = min on-screen px per role per size. */
export function evaluate(R) {
  const E = { phoneMisses: [], scaleMisses: [], overflow: [], clipped: [], overlaps: [], steps: [], weekdayMisses: [], chogMisses: [], receiptMisses: [], table: {}, receipt: {},
    info: "overflow = text wider than its box; hitAreaReach = scrollWidth inflated only by a transparent ::after tap area. overlaps = glyph ink overlap; lineBoxOverlaps = content-area boxes overlap with ink apart (gap) or touching <= 0.5 px.",
    hitAreaReach: [], lineBoxOverlaps: [], placeholders: [] };
  for (const key of [...CARD_SCENES, ...CHOG_SCENES, ...RECEIPT_SCENES]) {
    const S = R[key]; if (!S) continue;
    const phone = S.sizes["390x844"]; if (!phone || !phone.card) continue;
    E.table[key] = {};
    for (const [vpk, m] of Object.entries(S.sizes)) {
      if (!m.card) continue;
      const ratio = m.card.w / phone.card.w;
      for (const it of m.items) {
        if (RECEIPT_SCENES.includes(key)) {
          // Receipt paper (Return, Second Return, filebox): its own phone on-screen size x paper scale (A-843 item 5); fields must carry real values
          ((E.receipt[key] ??= {})[vpk] ??= {})[`${it.sel.replace(/^.*receiptPaper__/, "")}${it.text ? ` "${it.text}"` : ""}`] = it.px;
          const p0 = phone.items.find((x) => x.sel === it.sel && x.text === it.text) || phone.items.find((x) => x.sel === it.sel);
          if (p0 && Math.abs(it.px - p0.px * ratio) > 0.5) E.receiptMisses.push(`${key} ${vpk} ${it.sel} ${it.px} vs ${(p0.px * ratio).toFixed(2)}`);
          if (key !== "receipt" && /(^|\s)—(\s|$)|Unknown/.test(it.text)) E.placeholders.push(`${key} ${vpk} ${it.sel} "${it.text}"`);
        } else if (it.role !== "unknown") {
          const want = STYLE_PX[it.role] * ratio;
          if (Math.abs(it.px - want) > 0.5) (vpk === "390x844" ? E.phoneMisses : E.scaleMisses).push(`${key} ${vpk} ${it.sel} "${it.text}" ${it.px} vs ${want.toFixed(2)}`);
        }
        if (!RECEIPT_SCENES.includes(key)) { const row = (E.table[key][it.role] ??= {}); row[vpk] = Math.min(row[vpk] ?? Infinity, it.px); }
        if (it.textOverflowX ?? it.overflowX) E.overflow.push(`${key} ${vpk} ${it.sel} "${it.text}" text ${it.textW} / sw ${it.sw} (tap-area reach ${it.afterReach ?? 0}) > cw ${it.cw}`);
        else if (it.overflowX) E.hitAreaReach.push(`${key} ${vpk} ${it.sel} "${it.text}" sw ${it.sw} = cw ${it.cw} + transparent ::after reach ${it.afterReach} (text ${it.textW} fits)`);
        if (CARD_SCENES.includes(key) || RECEIPT_SCENES.includes(key)) { const c = m.card.rect, r = it.rect; if (r.l < c.l - 1 || r.t < c.t - 1 || r.r > c.r + 1 || r.b > c.b + 1) E.clipped.push(`${key} ${vpk} ${it.sel} "${it.text}" outside the ${RECEIPT_SCENES.includes(key) ? "paper" : "card"}`); }
        if (CHOG_SCENES.includes(key)) { const c0 = phone.items.find((x) => x.sel === it.sel); if (c0) { const a = c0.px / phone.card.w, b = it.px / m.card.w; if (Math.abs(b - a) / a > 0.01) E.chogMisses.push(`${key} ${vpk} ${it.sel} ${it.px} / hit ${m.card.w}`); } }
      }
      if (CARD_SCENES.includes(key) || RECEIPT_SCENES.includes(key)) {
        const its = m.items;
        for (let i = 0; i < its.length; i += 1) for (let j = i + 1; j < its.length; j += 1) {
          const a = its[i].rect, b = its[j].rect;
          const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
          // a date span contains its weekday <small>: nested boxes are not an overlap
          const nested = its[i].sel !== its[j].sel && (its[j].sel.startsWith(its[i].sel + " ") || its[i].sel.startsWith(its[j].sel + " "));
          if (nested || !(ox > 0.5 && oy > 0.5)) continue;
          // content-area boxes overlap: a collision only if the glyph INK overlaps (> 0.5 px penetration); otherwise a line-box overlap (recorded, not a miss)
          const ink = inkPenetration(its[i].ink, its[j].ink);
          if (ink === null) E.overlaps.push(`${key} ${vpk} "${its[i].text}" x "${its[j].text}" box ${ox.toFixed(1)}x${oy.toFixed(1)} (no ink data)`);
          else if (ink > 0.5) E.overlaps.push(`${key} ${vpk} "${its[i].text}" x "${its[j].text}" INK overlap ${ink.toFixed(2)} px (box ${ox.toFixed(1)}x${oy.toFixed(1)})`);
          else E.lineBoxOverlaps.push(`${key} ${vpk} "${its[i].text}" x "${its[j].text}" box ${ox.toFixed(1)}x${oy.toFixed(1)}, ink ${ink > 0 ? `touch ${ink.toFixed(2)}` : `gap ${(-ink).toFixed(2)}`} px`);
        }
        const det = m.items.find((x) => x.role === "detail" && /date|day/.test(x.sel)), wk = m.items.find((x) => x.role === "weekday");
        if (det && wk && Math.abs(wk.px - 0.7 * det.px) > 0.3) E.weekdayMisses.push(`${key} ${vpk} weekday ${wk.px} vs 0.7 x ${det.px}`);
      }
    }
    // 1 px sweeps: px / reference width per element must not step between adjacent widths (<= 1 %)
    const rows = S.sweep || [];
    for (let i = 1; i < rows.length; i += 1) {
      const a = rows[i - 1], b = rows[i]; if (!a.card || !b.card || b.vw - a.vw !== 1) continue;
      for (const it of b.items) { const q = a.items.find((x) => x.sel === it.sel && x.text === it.text); if (!q) continue; const ra = q.px / a.card.w, rb = it.px / b.card.w; if (Math.abs(rb - ra) / ra > 0.01) E.steps.push(`${key} ${a.vw}->${b.vw} ${it.sel} ${q.px}->${it.px} (ref ${a.card.w}->${b.card.w})`); }
    }
  }
  return E;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || path.join(REPO, "_private/ops/receipts/A845_type_styles/browser");
  const R = await measureAll(out);
  const E = evaluate(R);
  writeFileSync(path.join(out, "a845_evaluate.json"), JSON.stringify(E, null, 1));
  console.log(JSON.stringify({ error: R.error ?? null, notes: R.notes, table: E.table, receipt: E.receipt, misses: Object.fromEntries(Object.entries(E).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])) }, null, 1));
  process.exit(R.error ? 1 : 0);
}
