// [A-918] Honey jar on the mock spot: browser frames + 1 px sweep.
//   ARASO_TEST_BROWSER=1 node app/test/a918-honey-jar-spot-browser.mjs            (serves this tree's app/)
//   A918_ROOT=<dir> ...                                                           (serve another tree, e.g. _private/wt/a918d from main)
//   A918_SWEEP_STEP=1 (default 1; the real run) · A918_OUT=<receipt dir>
// Skipped unless ARASO_TEST_BROWSER=1 (Chromium cannot launch inside the sandbox: run with the sandbox disabled via the permission gate).
// Proves: the jar art sits at the mock ratio to the seat Piggy art box at every width (centre x = left-foot anchor, bottom = floor line, size = mock/seat ratio),
// tap box >= 44, neighbouring widths differ <= 1 %, the jar never overlaps Chog / the name / the brand (pixel masks), and writes mock-vs-app frames.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testOutDir } from "./helpers/test-out.mjs"; // [A-932]

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a918 honey jar spot browser (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.A918_ROOT ? path.resolve(process.env.A918_ROOT) : path.resolve(HERE, "..");
let REPO = HERE; while (!existsSync(path.join(REPO, "_private/ops/harness/package.json"))) { const up = path.dirname(REPO); if (up === REPO) throw new Error("repo root not found"); REPO = up; }
const OUT = testOutDir("a918-honey-jar-spot-browser", process.env.A918_OUT); // [A-932] pre-A-932 baseline default: receipts/A918_honey_jar_spot
const FR = path.join(OUT, "frames");
mkdirSync(FR, { recursive: true });
const FREEZE = process.env.ARASO_SWEEP === "freeze"; // [A-926] ARASO_SWEEP=freeze → full sweep; otherwise 390/390i/810/1440 only (A-923 rule 2: 1px sweep once, at freeze)
const STEP = process.env.A918_SWEEP_STEP ? Number(process.env.A918_SWEEP_STEP) : 1;
const J = await import(pathToFileURL(path.join(APP, "src/honey-jar.js")).href);
const { FORK_MODE_ENV } = await import(pathToFileURL(path.join(REPO, "app/test/helpers/fork-mode.mjs")).href); // [A-950]
const MOCK_HTML = path.join(REPO, "_private/design/gift_card_20261004/honey_jar_mock.html");

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const port = await freePort();
const vite = spawn(path.join(REPO, "node_modules/.bin/vite"), [APP, "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], { cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", VITE_RELAYER_URL: "__HARNESS_NO_GRANT__", ...FORK_MODE_ENV }, stdio: ["ignore", "pipe", "pipe"] }); // [A-950] fork env (helpers/fork-mode.mjs)
await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("vite start timeout")), 30000); vite.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } }); vite.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); }); });
process.env.A803_BASE_URL = `http://localhost:${port}/`;
process.env.A803_BASE_FORK = "1"; // [A-950] this server carries the fork env → launch({ forkMode: true }) may reuse it
const { launch, sleep } = await import(pathToFileURL(path.join(REPO, "app/test/helpers/a803-browser.mjs")).href);
const H = await launch({ forkMode: true }); // [A-950] fork-profile mode (STALE_TESTS class (a)): Second / "Second done" features open only on the fork profile since A-948
const { p } = H;
const failures = [];
const must = (c, m) => { if (!c) { failures.push(m); console.log(`ASSERT FAIL  ${m}`); } };

// ── A. the mock, measured in a browser ─────────────────────────────────────────────────────────────────────────────
const mockPage = await H.context.newPage();
await mockPage.setViewportSize({ width: 900, height: 600 });
await mockPage.setContent(readFileSync(MOCK_HTML, "utf8"), { waitUntil: "load" });
await sleep(400);
const mock = await mockPage.evaluate(async () => {
  const scene = document.querySelector(".scene"); const jar = document.querySelector(".scene .jar");
  const sb = scene.getBoundingClientRect(), jb = jar.getBoundingClientRect();
  const bg = getComputedStyle(scene).backgroundImage.match(/url\("?([^")]+)"?\)/)[1];
  const img = new Image(); img.src = bg; await img.decode();
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; const W = c.width;
  const box = (x0, y0, x1, y1) => { let a = 1e9, b = 1e9, e = -1, f = -1; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (d[(y * W + x) * 4] > 150) { a = Math.min(a, x); b = Math.min(b, y); e = Math.max(e, x + 1); f = Math.max(f, y + 1); } return [a, b, e, f]; };
  return { scene: [sb.left, sb.top, sb.width, sb.height], jar: [jb.left - sb.left, jb.top - sb.top, jb.width, jb.height], bgSize: [c.width, c.height], piggy: box(170, 0, 390, 212), name: box(170, 213, 390, 260), chog: box(0, 0, 165, 260) };
});
const pg = mock.piggy, pw = pg[2] - pg[0], ph = pg[3] - pg[1];
const mockRatio = { cx: (mock.jar[0] + mock.jar[2] / 2 - pg[0]) / pw, bottom: (mock.jar[1] + mock.jar[3] - pg[1]) / ph, size: mock.jar[2] / pw, centreFromLeft_px: mock.jar[0] + mock.jar[2] / 2 - pg[0] };
must(Math.abs(mockRatio.cx - J.JAR_MOCK_CX) < 0.002 && Math.abs(mockRatio.bottom - J.JAR_MOCK_BOTTOM) < 0.002 && Math.abs(mockRatio.size - J.JAR_MOCK_W) < 0.002, `honey-jar.js JAR_MOCK_* equal the measured mock ratio (${JSON.stringify(mockRatio)})`);
const mockShot = await mockPage.locator(".scene").screenshot();
writeFileSync(path.join(FR, "mock_scene.png"), mockShot);
const mockB64 = mockShot.toString("base64");

// ── seed ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const INSETS = "html:root{--mobile-top-safe:calc(59px + 14px)!important;--mobile-bottom-safe:calc(34px + 20px)!important}";
const VPS = [{ id: "390", w: 390, h: 844 }, { id: "390i", w: 390, h: 844, insets: true }, { id: "810", w: 810, h: 1080 }, { id: "1440", w: 1440, h: 900 }];

const PAGE_MEASURE = () => {
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const q = (s) => document.querySelector(s);
  return { vw: innerWidth, vh: innerHeight, seat: R(q("#homeSeat")), name: R(q("#homeName")), brand: R(q(".arasoBrand")), art: R(q("#a905Jar .a905-jar__art")), tap: R(q("#a905Jar")), chogBox: R(q("#chogHome")) };
};
// pixel masks (viewport shots; a hidden element is diffed away): overlap of the jar with Chog / name / brand / paper
const PIXELS = async (shots, art) => p.evaluate(async ({ shots, art }) => {
  // shots = { jar: {a, b2, v}, <k>: {a, v} } : a = unhidden shot taken right before v (hidden shot) so transient motion cancels in pairs; b2 = a second unhidden shot (noise)
  const load = async (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const bmp = await createImageBitmap(new Blob([u], { type: "image/png" })); const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; const g = c.getContext("2d"); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
  const sad = (a, b, i) => Math.abs(a.data[i * 4] - b.data[i * 4]) + Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]) + Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]);
  const mask = async (s) => { const A = await load(s.a), V = await load(s.v), N = s.b2 ? await load(s.b2) : null; const W = A.width, Hh = A.height; const m = new Uint8Array(W * Hh); let n = 0; for (let i = 0; i < W * Hh; i++) { if (N && sad(A, N, i) > 8) continue; if (sad(A, V, i) > 40) { m[i] = 1; n++; } } return { m, n, W, Hh }; };
  const out = {};
  for (const k of Object.keys(shots)) { const o = await mask(shots[k]); let ov = 0, gap = 1e9; for (let y = 0; y < o.Hh; y++) for (let x = 0; x < o.W; x++) if (o.m[y * o.W + x]) { if (x >= art.x && x <= art.r && y >= art.y && y <= art.b) ov++; const dx = Math.max(art.x - x, 0, x - art.r), dy = Math.max(art.y - y, 0, y - art.b); gap = Math.min(gap, Math.max(dx, dy)); } out[k] = { px: o.n, overlapJarPx: ov, gapToArtPx: o.n ? Math.round(gap * 10) / 10 : null }; }
  return out;
}, { shots, art });
const hide = (sels, on) => p.evaluate(([s, h]) => { document.querySelectorAll(s).forEach((e) => { if (h) e.style.setProperty("visibility", "hidden", "important"); else e.style.removeProperty("visibility"); }); }, [sels, on]);
const PIGGY = "#homeSeat, #homeChar img, .homeLiving"; // the Piggies animate continuously (not CSS): hidden in every pixel shot, the jar is checked against Chog / name / brand / paper
async function overlapPixels() {
  const art = await p.evaluate(() => { const b = document.querySelector("#a905Jar .a905-jar__art").getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom }; });
  await hide(PIGGY, true);
  await p.addStyleTag({ content: "html *,html *::before,html *::after{animation:none!important;transition:none!important}" }).then((h) => h.evaluate((n) => { n.id = 'a918Freeze'; }));
  await sleep(300);
  const shot = async (sel) => { if (sel) await hide(sel, true); const b = (await p.screenshot({ type: "png" })).toString("base64"); if (sel) await hide(sel, false); return b; };
  const pair = async (sel) => ({ a: await shot(null), b2: await shot(null), v: await shot(sel) });
  await hide(".a905-jarLayer", true); // the jar is out of every shot: each element's own ink is tested against the jar ART rect
  const shots = { chog: await pair("#chogHome"), name: await pair("#homeName"), brand: await pair(".arasoBrand"), paper: await pair("#homePaper, .homePaper") };
  await hide(PIGGY, false); await hide(".a905-jarLayer", false);
  const res = await PIXELS(shots, art);
  await p.evaluate(() => document.getElementById('a918Freeze')?.remove());
  return res;
}

// ── frames ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const rel = (m) => { const S = m.seat, A = m.art; return { cx: (A.x + A.w / 2 - S.x) / S.w, bottom: (A.b - S.y) / S.h, size: A.w / S.w }; };
const expectPx = (m) => { const S = m.seat; return { cx: S.x + J.JAR_MOCK_CX * S.w, bottom: S.y + J.JAR_MOCK_BOTTOM * S.h, size: J.JAR_MOCK_W * S.w }; };
async function waitJar(ms = 9000) { for (let t0 = Date.now(); Date.now() - t0 < ms;) { if (await p.locator("#a905Jar").count()) { await sleep(900); return true; } await sleep(200); } return false; }
async function settle(vp) {
  await p.setViewportSize({ width: vp.w, height: vp.h });
  await H.atWidth(vp.w, vp.h); await H.closeRecords();
  if (vp.insets) { await p.addStyleTag({ content: INSETS }); await p.evaluate(() => window.dispatchEvent(new Event("resize"))); await sleep(900); }
  await waitJar(); await sleep(600);
}
async function sideBySide(vp, m, name) {
  const appShot = (await p.screenshot({ type: "png" })).toString("base64");
  const s = (pg[2] - pg[0]) / m.seat.w; // mock px per app px (seat art width = mock Piggy ink width)
  const b64 = await mockPage.evaluate(async ({ appShot, mockB64, seat, s, pg, label }) => {
    const L = async (u) => { const i = new Image(); i.src = u; await i.decode(); return i; };
    const app = await L("data:image/png;base64," + appShot), mk = await L("data:image/png;base64," + mockB64);
    const c = document.createElement("canvas"); c.width = 390 * 2 + 30; c.height = 260 + 24; const g = c.getContext("2d");
    g.fillStyle = "#161616"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(mk, 0, 24);
    g.save(); g.beginPath(); g.rect(420, 24, 390, 260); g.clip();
    g.translate(420, 24); g.scale(s, s); g.translate(-(seat.x - pg[0] / s), -(seat.y - pg[1] / s)); g.drawImage(app, 0, 0); g.restore();
    g.fillStyle = "#EDE8DC"; g.font = "12px sans-serif"; g.fillText("mock (honey_jar_mock.html)", 4, 14); g.fillText(label, 424, 14);
    return c.toDataURL("image/png").split(",")[1];
  }, { appShot, mockB64, seat: m.seat, s, pg, label: `app ${vp.id} (Piggy art matched to mock scale x${s.toFixed(3)})` });
  writeFileSync(path.join(FR, `mock_vs_app_${vp.id}.png`), Buffer.from(b64, "base64"));
}

const frameRows = [];
try {
  await H.seedSolo("Honeybun");
  await p.evaluate((k) => localStorage.setItem(k, "1"), H.secondKey("araso.secondJourneyClosed"));
  for (const vp of VPS) {
    await settle(vp);
    const m = await p.evaluate(PAGE_MEASURE);
    must(Boolean(m.art && m.seat), `[${vp.id}] jar and seat Piggy present`);
    if (!m.art || !m.seat) continue;
    const r = rel(m), e = expectPx(m);
    const dx = m.art.x + m.art.w / 2 - e.cx, dy = m.art.b - e.bottom;
    await p.screenshot({ path: path.join(FR, `app_${vp.id}.png`) });
    await sideBySide(vp, m, vp.id);
    const px = await overlapPixels();
    const row = { vp: vp.id, vw: m.vw, vh: m.vh, seat: m.seat, art: m.art, tap: m.tap, rel: r, dxPx: dx, dyPx: dy, sizeOverSeat: r.size, tapW: m.tap.w, tapH: m.tap.h, pixels: px };
    frameRows.push(row);
    must(Math.abs(dx) <= 1 && Math.abs(dy) <= 1, `[${vp.id}] jar centre x / bottom y within 1 px of the mock spot (dx ${dx.toFixed(2)} dy ${dy.toFixed(2)})`);
    must(m.tap.w >= 43.9 && m.tap.h >= 43.9, `[${vp.id}] tap box >= 44 (${m.tap.w.toFixed(1)} x ${m.tap.h.toFixed(1)})`);
    must(Math.abs(r.size / J.JAR_MOCK_W - 1) <= 0.01, `[${vp.id}] jar size / seat art width = mock ratio +-1 % (${r.size.toFixed(4)})`);
    must(Math.abs(m.tap.x + m.tap.w / 2 - (m.art.x + m.art.w / 2)) <= 0.6 && Math.abs(m.tap.y + m.tap.h / 2 - (m.art.y + m.art.h / 2)) <= 0.6, `[${vp.id}] tap box centred on the art (twinkle burst is centred on the art)`);
    for (const k of ["chog", "name", "brand", "paper"]) must(!(px[k] && px[k].overlapJarPx > 0), `[${vp.id}] jar art never overlaps ${k} ink (${px[k]?.overlapJarPx} px) (D: report in OUTBOX, no fallback spot)`);
    console.log(`gaps [${vp.id}] ` + JSON.stringify(Object.fromEntries(["chog", "name", "brand", "paper"].map((k) => [k, px[k]?.gapToArtPx]))));
    // A-904 burst centre: the ::after box centre == art centre
    const burst = await p.evaluate(() => { const j = document.querySelector("#a905Jar"); if (!j) return null; j.setAttribute("data-a904", "twinkle"); const a = getComputedStyle(j, "::after"); const b = j.getBoundingClientRect(); const bc = getComputedStyle(j); const out = { left: parseFloat(a.left), top: parseFloat(a.top), w: parseFloat(a.width), h: parseFloat(a.height), bw: parseFloat(bc.width), bh: parseFloat(bc.height) }; /* board-local px (the board is scaled) */ j.removeAttribute("data-a904"); return out; });
    if (burst) { const cxB = burst.left + burst.w / 2, cyB = burst.top + burst.h / 2; must(Math.abs(cxB - burst.bw / 2) < 0.6 && Math.abs(cyB - burst.bh / 2) < 0.6, `[${vp.id}] A-904 twinkle burst centred on the jar (${cxB.toFixed(1)},${cyB.toFixed(1)} vs ${(burst.bw / 2).toFixed(1)},${(burst.bh / 2).toFixed(1)})`); row.burst = burst; }
    // twinkle frame
    await p.evaluate(() => document.querySelector("#a905Jar")?.setAttribute("data-a904", "twinkle")); await sleep(450);
    await p.screenshot({ path: path.join(FR, `twinkle_${vp.id}.png`) });
    await p.evaluate(() => document.querySelector("#a905Jar")?.removeAttribute("data-a904"));
  }

  // ── E. Away Home = the SAME spot (Owner "같은 자리", Cowork 20:53): seated jar box == Away jar box; the board-derived seat box == the real #homeSeat ──
  const BOARD_SEAT = () => { // the same maths as main.js a918SeatBoxFromBoard (board units → viewport px)
    const b = document.querySelector("#homeBoard")?.getBoundingClientRect(); if (!b || !(b.width > 0)) return null;
    const k = b.width / 1256, W = 150, H = (150 * 551) / 528, L = 1041 - 0.4991 * 150, T = 648 - H * (550 / 551);
    return { x: b.left + L * k, y: b.top + T * k, w: W * k, h: H * k };
  };
  const awayRows = [];
  for (const vp of VPS) {
    await p.evaluate(() => window.__arasoScene && window.__arasoScene("sendstay")); await settle(vp);
    const seated = await p.evaluate(PAGE_MEASURE); const calc = await p.evaluate(BOARD_SEAT);
    if (seated.seat && calc) must(Math.abs(calc.x - seated.seat.x) <= 0.5 && Math.abs(calc.y - seated.seat.y) <= 0.5 && Math.abs(calc.w - seated.seat.w) <= 0.5 && Math.abs(calc.h - seated.seat.h) <= 0.5,
      `[E ${vp.id}] board-derived seat box == real #homeSeat (calc ${JSON.stringify(calc)} real ${JSON.stringify(seated.seat)})`);
    await p.evaluate(() => window.__arasoScene && window.__arasoScene("away")); await sleep(600); await waitJar(); await sleep(600);
    const away = await p.evaluate(PAGE_MEASURE);
    must(Boolean(away.art), `[E ${vp.id}] Away Home shows the jar`);
    if (away.art && seated.art) {
      const d = Math.max(Math.abs(away.art.x - seated.art.x), Math.abs(away.art.y - seated.art.y), Math.abs(away.art.w - seated.art.w), Math.abs(away.art.h - seated.art.h));
      awayRows.push({ vp: vp.id, seated: seated.art, away: away.art, maxDiffPx: d });
      must(d <= 0.5, `[E ${vp.id}] Away jar box == seated jar box (max diff ${d.toFixed(2)} px)`);
      await p.screenshot({ path: path.join(FR, `away_${vp.id}.png`) });
    }
    await p.evaluate(() => window.__arasoScene && window.__arasoScene("sendstay")); await sleep(600);
  }
  console.log("away rows " + JSON.stringify(awayRows.map((r) => [r.vp, +r.maxDiffPx.toFixed(2)])));
  writeFileSync(path.join(OUT, "AWAY.json"), JSON.stringify(awayRows, null, 1));

  // [A-926] ARASO_SWEEP=freeze → full sweep; otherwise 390/390i/810/1440 only (A-923 rule 2: 1px sweep once, at freeze)
  if (FREEZE) {
    // ── 1 px sweep 360 -> 1600 ──────────────────────────────────────────────────────────────────────────────────────────
    const hFor = (w) => (w <= 500 ? 844 : w <= 1000 ? 1080 : 900);
    const sweep = [];
    let band = null;
    for (let w = 360; w <= 1600; w += STEP) {
      const h = hFor(w);
      if (band !== h) { band = h; await settle({ w, h }); } else { await p.setViewportSize({ width: w, height: h }); await sleep(720); }
      let m = await p.evaluate(PAGE_MEASURE);
      if (!m.art) { await sleep(900); m = await p.evaluate(PAGE_MEASURE); }
      if (!m.art || !m.seat) { sweep.push({ w, h, missing: true }); continue; }
      const r = rel(m), e = expectPx(m);
      const row = { w, h, seatW: m.seat.w, artW: m.art.w, tapW: m.tap.w, cx: r.cx, bottom: r.bottom, size: r.size, dx: m.art.x + m.art.w / 2 - e.cx, dy: m.art.b - e.bottom, ratioErr: r.size / J.JAR_MOCK_W - 1, art: m.art, seat: m.seat, name: m.name, brand: m.brand };
      if (w % 10 === 0 || w === 360) { const px = await overlapPixels(); row.ov = Object.fromEntries(["chog", "name", "brand", "paper"].map((k) => [k, px[k]?.overlapJarPx ?? 0])); }
      sweep.push(row);
    }
    // sweep verdicts
    const ok = sweep.filter((x) => !x.missing);
    must(sweep.length > 0 && ok.length === sweep.length, `sweep: jar present at every width (${sweep.length - ok.length} missing: ${sweep.filter((x) => x.missing).map((x) => x.w).slice(0, 20).join(",")})`);
    let maxDx = 0, maxDy = 0, maxRatio = 0, maxStepRel = 0, minTap = 1e9; const stepFails = [];
    for (let i = 0; i < ok.length; i++) {
      const a = ok[i]; maxDx = Math.max(maxDx, Math.abs(a.dx)); maxDy = Math.max(maxDy, Math.abs(a.dy)); maxRatio = Math.max(maxRatio, Math.abs(a.ratioErr)); minTap = Math.min(minTap, a.tapW);
      if (i > 0 && ok[i - 1].w === a.w - STEP) { const b = ok[i - 1]; const ch = Math.max(STEP === 1 ? Math.abs(a.artW / b.artW - 1) : 0, Math.abs(a.cx / b.cx - 1), Math.abs(a.bottom / b.bottom - 1), Math.abs(a.size / b.size - 1)); maxStepRel = Math.max(maxStepRel, ch); if (ch > 0.01 && a.h === b.h) stepFails.push(`${b.w}->${a.w}: ${(ch * 100).toFixed(2)} %`); }
    }
    must(maxDx <= 1 && maxDy <= 1, `sweep: jar centre / bottom within 1 px of the mock spot everywhere (max dx ${maxDx.toFixed(2)} dy ${maxDy.toFixed(2)})`);
    must(maxRatio <= 0.01, `sweep: jar size / seat art width constant +-1 % (max ${(maxRatio * 100).toFixed(3)} %)`);
    must(minTap >= 43.9, `sweep: tap box >= 44 everywhere (min ${minTap.toFixed(2)})`);
    must(stepFails.length === 0, `sweep: adjacent widths differ <= 1 % (${stepFails.slice(0, 8).join("; ")})`);
    const ovFails = ok.filter((x) => x.ov && Object.values(x.ov).some((v) => v > 0));
    must(ovFails.length === 0, `sweep: jar art never overlaps Chog / name / brand / paper ink (${ovFails.slice(0, 8).map((x) => x.w + JSON.stringify(x.ov)).join("; ")})`);
    console.log(`sweep: ${ok.length} widths, max dx ${maxDx.toFixed(3)} dy ${maxDy.toFixed(3)} px, size ratio err ${(maxRatio * 100).toFixed(3)} %, max neighbour change ${(maxStepRel * 100).toFixed(3)} %, min tap ${minTap.toFixed(1)}, overlap samples ${ok.filter((x) => x.ov).length}, with overlap ${ovFails.length}`);
    // SWEEP csv + table
    const csv = ["w,h,seatW,artW,tapW,cx_ratio,bottom_ratio,size_ratio,dx_px,dy_px,ov_chog,ov_name,ov_brand,ov_paper"];
    for (const x of sweep) csv.push(x.missing ? `${x.w},${x.h},missing` : [x.w, x.h, x.seatW.toFixed(2), x.artW.toFixed(2), x.tapW.toFixed(2), x.cx.toFixed(5), x.bottom.toFixed(5), x.size.toFixed(5), x.dx.toFixed(3), x.dy.toFixed(3), x.ov?.chog ?? "", x.ov?.name ?? "", x.ov?.brand ?? "", x.ov?.paper ?? ""].join(","));
    writeFileSync(path.join(OUT, "SWEEP.csv"), csv.join("\n") + "\n");
    const pick = [360, 390, 420, 600, 810, 900, 1000, 1200, 1440, 1600].map((w) => ok.find((x) => x.w === w)).filter(Boolean);
    const tbl = ["| w | h | seat art w | jar art | tap | cx | bottom | size/seat | dx | dy |", "|---|---|---|---|---|---|---|---|---|---|", ...pick.map((x) => `| ${x.w} | ${x.h} | ${x.seatW.toFixed(1)} | ${x.artW.toFixed(1)} | ${x.tapW.toFixed(1)} | ${x.cx.toFixed(4)} | ${x.bottom.toFixed(4)} | ${x.size.toFixed(4)} | ${x.dx.toFixed(2)} | ${x.dy.toFixed(2)} |`)];
    writeFileSync(path.join(OUT, "SWEEP_TABLE.md"), `# A-918 sweep ${STEP} px, 360..1600\n\nMock ratio (centre x / bottom y / size, fractions of the seat art box): ${J.JAR_MOCK_CX.toFixed(5)} / ${J.JAR_MOCK_BOTTOM.toFixed(5)} / ${J.JAR_MOCK_W.toFixed(5)}\n\nwidths ${ok.length}; max |dx| ${maxDx.toFixed(3)} px, max |dy| ${maxDy.toFixed(3)} px, size ratio err ${(maxRatio * 100).toFixed(3)} %, max neighbour change ${(maxStepRel * 100).toFixed(3)} %, min tap ${minTap.toFixed(1)} px\n\nPixel-overlap samples (every 10 px): ${ok.filter((x) => x.ov).length}; widths where the jar art overlaps Chog / name / brand / paper ink:\n${ovFails.map((x) => `- ${x.w}: ${JSON.stringify(x.ov)}`).join("\n") || "- none"}\n\n${tbl.join("\n")}\n`);
    writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify({ mock: { ...mock, ratio: mockRatio }, constants: { cx: J.JAR_MOCK_CX, bottom: J.JAR_MOCK_BOTTOM, size: J.JAR_MOCK_W }, frames: frameRows, sweepSummary: { widths: ok.length, maxDx, maxDy, maxRatio, maxStepRel, minTap, overlapWidths: ovFails.map((x) => ({ w: x.w, ov: x.ov })) }, failures }, null, 1));
  } else {
    console.log("sweep skipped (ARASO_SWEEP!=freeze)");
    writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify({ mock: { ...mock, ratio: mockRatio }, constants: { cx: J.JAR_MOCK_CX, bottom: J.JAR_MOCK_BOTTOM, size: J.JAR_MOCK_W }, frames: frameRows, sweepSummary: "skipped (ARASO_SWEEP!=freeze)" }, null, 1));
  }
} catch (e) { failures.push(`exception: ${String((e && e.stack) || e).slice(0, 400)}`); console.log("EXCEPTION", e); }
finally { await H.close(); try { vite.kill("SIGTERM"); } catch {} }
console.log(failures.length ? `a918: ${failures.length} FAIL` : `a918: PASS${FREEZE ? "" : " (sweep skipped)"}`); // [A-926 review note]
process.exit(failures.length ? 1 : 0);
