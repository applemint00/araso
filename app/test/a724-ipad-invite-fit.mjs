// [A-724] iPad wide-Invite fit — grid-track CONTAINMENT regression (browser + static CSS).
//   node app/test/a724-ipad-invite-fit.mjs
// Defect (A-722 B1): for 900 <= W < 1280 the `.stage--invite` grid's implicit auto column resolved to the fixed
// 1280px `.invite--wide` layout box, the board centred inside that 1280 track, and `transform: scale()` (fitInvite)
// kept its centre at x=640 instead of W/2 → board shifted right by (1280-W)/2 and right-clipped.
// Fix: the A-697 `grid-template-columns: minmax(0, 1fr)` pin now applies below 1280 (not only <=640), so the
// track IS the viewport. >=1280 is untouched (track already == viewport there).
// Asserts per viewport: track width <= viewport, board centred (L/R ±1px), board fully inside viewport,
// no stage/doc horizontal overflow, Face ID control reachable via elementFromPoint; mobile 390/430 paper centred.
// Env: A724_BASE_URL reuses a running server (else spawns vite on a free port, preferring 5797, and kills it);
//      A724_OUT=<dir> writes rects.json + shots/*.png there; A724_PHASE label (default "run").
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, extra = "") {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); } else { fail += 1; console.log(`FAIL  ${name}${extra ? ` (${extra})` : ""}`); }
}

// ---- static: the containment pin covers the wide-Invite tablet band, and is the only one
const noComments = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const pins = [...noComments.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{\s*\.stage--invite\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);?\s*\}\s*\}/g)];
check("exactly one @media .stage--invite minmax(0,1fr) pin", pins.length === 1, String(pins.length));
const maxW = pins[0] ? Number(pins[0][1]) : 0;
check("pin covers the wide-Invite tablet band (max-width >= 1279px)", maxW >= 1279, String(maxW));
check("pin does not reach >=1280 (canonical wide artboard untouched)", maxW < 1280, String(maxW));

// ---- browser
const VIEWPORTS = [
  { w: 390, h: 844, band: "mobile" }, { w: 430, h: 932, band: "mobile" },
  { w: 700, h: 800, band: "tablet" }, { w: 861, h: 800, band: "tablet" },
  { w: 900, h: 675, band: "tablet" }, { w: 1024, h: 768, band: "tablet" }, { w: 1024, h: 694, band: "tablet" },
  { w: 1180, h: 820, band: "tablet" }, { w: 1279, h: 800, band: "tablet" },
  { w: 1280, h: 800, band: "desktop" }, { w: 1366, h: 1024, band: "desktop" },
];

function freePort(prefer) {
  const tryPort = (p) => new Promise((resolve) => {
    const s = net.createServer(); s.unref();
    s.once("error", () => resolve(null));
    s.listen(p, "127.0.0.1", () => { const got = s.address().port; s.close(() => resolve(got)); });
  });
  return tryPort(prefer).then((p) => p ?? tryPort(0));
}

async function measure(page) {
  return page.evaluate(() => {
    const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: +r.left.toFixed(2), t: +r.top.toFixed(2), r: +r.right.toFixed(2), b: +r.bottom.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
    const vw = window.innerWidth, vh = window.innerHeight;
    const stage = document.querySelector(".stage--invite");
    const inv = document.querySelector(".invite");
    const paper = document.querySelector(".invite__paper");
    const face = document.querySelector("#inviteFaceButton");
    const de = document.documentElement;
    const fr = face ? face.getBoundingClientRect() : null;
    const hitEl = fr ? document.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2) : null;
    const cols = stage ? getComputedStyle(stage).gridTemplateColumns : "";
    return {
      vw, vh, kind: inv?.dataset.kind ?? null, transform: inv?.style.transform ?? null,
      cols, track: parseFloat(cols) || null,
      stage: stage ? { sw: stage.scrollWidth, cw: stage.clientWidth, sh: stage.scrollHeight, ch: stage.clientHeight } : null,
      doc: { sw: de.scrollWidth, cw: de.clientWidth, sh: de.scrollHeight, ch: de.clientHeight },
      scroll: { x: window.scrollX, y: window.scrollY },
      board: R(inv), paper: R(paper), face: R(face),
      // [A-839] the content group (the art margins of the board are transparent now) and the group scale fitInvite writes
      s: inv ? parseFloat(getComputedStyle(inv).getPropertyValue("--invS")) : null,
      content: [".invite__hero", "#inviteFaceButton", ".invite__chog", ".invite__chogNative", ".invite__burst"].map((q) => R(document.querySelector(q))).filter(Boolean),
      faceHit: !!(face && hitEl && (hitEl === face || face.contains(hitEl))),
    };
  });
}

async function main() {
  if (!existsSync(privatePath("ops/harness/package.json"))) {
    console.log("SKIP  browser part — local harness absent (public checkout)");
    return;
  }
  const { chromium } = createRequire(privatePath("ops/harness/package.json"))("playwright");
  const OUT = process.env.A724_OUT || "";
  const PHASE = process.env.A724_PHASE || "run";
  if (OUT) mkdirSync(path.join(OUT, "shots"), { recursive: true });
  let server = null, BASE = process.env.A724_BASE_URL || "";
  if (!BASE) {
    const port = await freePort(5797);
    server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", String(port), "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, detached: true,
      env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 30000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    BASE = `http://localhost:${port}/`;
    console.log(`INFO  vite pid ${server.pid} on ${BASE}`);
  }
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let tx = 0;
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      await ctx.route("**/*", (route) => {
        const req = route.request(); const body = req.postData() || "";
        if (/eth_sendRawTransaction|eth_sendTransaction|eth_sendUserOperation/.test(body)) { tx += 1; return route.abort(); }
        return route.continue();
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e?.message || e).slice(0, 160)));
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForSelector(".invite", { timeout: 15000 });
      await sleep(1500);
      const m = await measure(page);
      m.viewport = `${vp.w}x${vp.h}`; m.band = vp.band; m.errors = errors;
      results.push(m);
      if (OUT) await page.screenshot({ path: path.join(OUT, "shots", `${PHASE}_invite_${vp.w}x${vp.h}.png`) });
      const tag = `${m.viewport}`;
      const bL = m.board ? m.board.l : NaN, bR = m.board ? +(vp.w - m.board.r).toFixed(2) : NaN;
      check(`${tag} invite present, kind=${vp.w >= 700 ? "wide" : "mobile"}`, m.kind === (vp.w >= 700 ? "wide" : "mobile"), String(m.kind));
      check(`${tag} grid track width <= viewport (no oversized implicit track)`, m.track != null && m.track <= vp.w + 0.5, m.cols);
      // pre-A-839 baseline: check(`${tag} no stage horizontal overflow (scrollWidth <= clientWidth)`, m.stage && m.stage.sw <= m.stage.cw, ...) - the board (art margins included) was always inside the viewport.
      // A-839: the board's art margins are transparent and may extend past the viewport (clipped by .stage--invite, no scrollbar: doc check below); the CONTENT group must stay inside (A-724 containment intent).
      check(`${tag} content group fully inside the viewport (A-724 containment; the transparent board margins may overhang)`, m.content.length > 0 && m.content.every((c) => c.l >= -0.5 && c.r <= vp.w + 0.5 && c.t >= -0.5 && c.b <= vp.h + 0.5), JSON.stringify(m.content));
      check(`${tag} no page scroll/overflow`, m.doc.sw <= m.doc.cw && m.doc.sh <= m.doc.ch && m.scroll.x === 0 && m.scroll.y === 0, JSON.stringify({ doc: m.doc, scroll: m.scroll }));
      check(`${tag} Face ID reachable (elementFromPoint)`, m.faceHit);
      check(`${tag} no page errors`, errors.length === 0, errors.join(" | "));
      if (vp.band === "mobile") {
        const pL = m.paper.l, pR = +(vp.w - m.paper.r).toFixed(2);
        check(`${tag} A-697 mobile paper centred (L ${pL} / R ${pR}, ±1px)`, Math.abs(pL - pR) <= 1);
      } else {
        // pre-A-839 baseline: const s = Math.min(vp.w / 1280, vp.h / 800); A-839: the group scale is fitInvite's --invS (HomeCard rule + containment guard)
        const s = m.s;
        check(`${tag} board L/R margins symmetric (L ${bL} / R ${bR}, ±1px)`, Math.abs(bL - bR) <= 1);
        // pre-A-839 baseline: check(`${tag} board fully inside viewport horizontally (no right clipping)`, bL >= -0.5 && m.board.r <= vp.w + 0.5, ...) - see the content check above.
        check(`${tag} board width = 1280 x fitInvite scale (${s.toFixed(4)})`, Math.abs(m.board.w - 1280 * s) <= 1, String(m.board.w));
        check(`${tag} board left = (W - 1280s)/2`, Math.abs(bL - (vp.w - 1280 * s) / 2) <= 1, String(bL));
      }
      await ctx.close();
    }
    check("no tx-type requests", tx === 0, String(tx));
  } finally {
    await browser.close();
    if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); } }
  }
  if (OUT) writeFileSync(path.join(OUT, `rects_${PHASE}.json`), JSON.stringify(results, null, 2));
}

try { await main(); } catch (e) { fail += 1; console.log(`FAIL  harness: ${String(e?.message || e)}`); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
