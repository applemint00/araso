// [A-736] Common dark background = Invite's existing CSS language (#161616 + 32px/1px/rgba(255,255,255,.04) rule lines). CSS-only.
//   node app/test/a736-common-background.mjs     (static part always; browser part if local harness exists)
// Env: A736_BASE_URL reuses a server (else spawns vite --mode a172-local --strictPort on 5835); A736_OUT=<dir> for screenshots.
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutOracle } from "./helpers/a831-sweep.mjs"; // [A-839] pitch = 32 x HomeCard / 282
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN_SRC = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const NC = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, extra = "") { if (ok) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}${extra ? ` (${extra})` : ""}`); } }
const block = (sel) => { const i = NC.indexOf(sel + " {"); if (i < 0) return ""; return NC.slice(i, NC.indexOf("}", i)); };

// ---- static
const inv = block(".invite__paper");
const body = block("body");
const RULE = /repeating-linear-gradient\(\s*to bottom,\s*transparent 0px,\s*transparent 31px,\s*rgba\(255, 255, 255, 0\.04\) 31px,\s*rgba\(255, 255, 255, 0\.04\) 32px\s*\)/;
// pre-A-839 baseline (A-736): Invite paper kept #161616 + the 31/32px rule gradient; body used the SAME 31/32px gradient with `background-size: 100% 32px`; `.invite` kept #050505;
// `body:has(.stage--invite) { background-image: none }` existed exactly once. A-839 (A-835 items 6-7): the whole viewport is the notebook - the paper/board carry no ground of their own, the body
// notebook (pitch 32 x HomeCard / 282 = 32 k, via --fmtS) shows under every scene including Invite, and nothing hides it.
const RULE_K = /repeating-linear-gradient\(\s*to bottom,\s*transparent 0px,\s*transparent calc\(31px \* var\(--fmtS, 1\)\),\s*rgba\(255, 255, 255, 0\.04\) calc\(31px \* var\(--fmtS, 1\)\),\s*rgba\(255, 255, 255, 0\.04\) calc\(32px \* var\(--fmtS, 1\)\)\s*\)/;
check("Invite paper draws no ground of its own (no background / gradient / shadow)", !/background/.test(inv) && !/box-shadow/.test(inv));
check("Invite paper carries no notebook gradient (the body is the notebook)", !/repeating-linear-gradient/.test(inv));
check("body uses var(--paper) (#161616) colour", /background-color:\s*var\(--paper\)/.test(body) && /--paper:\s*#161616/.test(NC));
check("body rule gradient = 31 k / 32 k stops (k = --fmtS = HomeCard / 282)", RULE_K.test(body));
check("body gradient tile = 32 k tall (calc(32px * var(--fmtS, 1))), origin 0 0", /background-size:\s*100% calc\(32px \* var\(--fmtS, 1\)\)/.test(body) && /background-position:\s*0 0/.test(body));
check("body no longer references bg_notebook_dark.png", !/bg_notebook_dark/.test(NC));
check("no #050505 stage ground remains on sendstay/hatch/name/return",
  !/\.stage\[data-scene="sendstay"\]\s*\{[^}]*#050505/.test(NC) && !/\.stage--name\s*\{[^}]*#050505/.test(NC) && !/\.stage\[data-scene="return"\]\s*\{[^}]*#050505/.test(NC));
check("Invite board has no dark outer box (#050505 gone, transparent)", !/\.invite\s*\{[^}]*#050505/.test(NC) && /\.invite\s*\{[^}]*background:\s*transparent/.test(NC));
check("nothing hides the body notebook under Invite (no body:has(...) background-image:none)", (NC.match(/body:has\([^)]*\)[^{]*\{\s*background-image:\s*none/g) || []).length === 0);
check("paper_tex_ivory references unchanged (count)", (CSS.match(/paper_tex_ivory/g) || []).length === Number(process.env.A736_IVORY_COUNT || 16), String((CSS.match(/paper_tex_ivory/g) || []).length));
check("no new url() image in body rule", !/url\(/.test(body));

// ---- browser
async function main() {
  if (!existsSync(privatePath("ops/harness/package.json"))) { console.log("SKIP  browser part — harness absent"); return; }
  if (process.env.A736_NODE_ONLY === "1") { console.log("SKIP  browser part — A736_NODE_ONLY"); return; }
  const { chromium } = createRequire(privatePath("ops/harness/package.json"))("playwright");
  const OUT = process.env.A736_OUT || "";
  if (OUT) mkdirSync(OUT, { recursive: true });
  let server = null, BASE = process.env.A736_BASE_URL || "";
  if (!BASE) {
    server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", "5835", "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, detached: true, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("vite start timeout")), 30000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); res(); } });
      server.on("exit", (c) => { clearTimeout(t); rej(new Error(`vite exited ${c}`)); }); });
    BASE = "http://localhost:5835/";
  }
  const browser = await chromium.launch({ headless: true });
  const VPS = [[390, 844], [430, 932], [700, 900], [1024, 768], [1180, 820], [1440, 900]];
  const SCENES = ["sendstay", "hatch", "name", "away", "return", "explore", "secondAway", "birth", "filebox"];
  try {
    for (const [w, h] of VPS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errs = []; page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForSelector(".invite", { timeout: 15000 });
      await sleep(1200);
      const t = `${w}x${h}`;
      const iv = await page.evaluate(() => {
        const b = getComputedStyle(document.body), p = document.querySelector(".invite__paper");
        const pc = getComputedStyle(p), r = p.getBoundingClientRect();
        return { bodyBg: b.backgroundColor, bodyImg: b.backgroundImage, paperBg: pc.backgroundColor, paperImg: pc.backgroundImage, paperTop: r.top, doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth] };
      });
      // pre-A-839 baseline: check(`${t} Invite body flat #161616, no image`, iv.bodyBg === "rgb(22, 22, 22)" && iv.bodyImg === "none", ...); check(`${t} Invite paper still #161616 + rule gradient`, iv.paperBg === "rgb(22, 22, 22)" && /repeating-linear-gradient/.test(iv.paperImg));
      check(`${t} Invite: body #161616 + the common rule gradient (no image url)`, iv.bodyBg === "rgb(22, 22, 22)" && /repeating-linear-gradient/.test(iv.bodyImg) && !/url\(/.test(iv.bodyImg), JSON.stringify(iv));
      check(`${t} Invite paper is transparent (no own ground)`, iv.paperBg === "rgba(0, 0, 0, 0)" && iv.paperImg === "none", `${iv.paperBg} ${iv.paperImg}`);
      if (OUT) await page.screenshot({ path: path.join(OUT, `invite_${t}.png`) });
      const prevInvite = iv.bodyBg;
      for (const sc of SCENES) {
        const r = await page.evaluate((sc) => {
          const app = document.querySelector(".stage")?.parentElement || document.body;
          document.querySelectorAll(".stage").forEach((s) => s.remove());
          const s = document.createElement("section"); s.className = sc === "hatch" ? "stage stage--hatch" : sc === "name" ? "stage stage--name" : "stage"; s.dataset.scene = sc;
          app.appendChild(s);
          const b = getComputedStyle(document.body), sg = getComputedStyle(s);
          return { bg: b.backgroundColor, img: b.backgroundImage, size: b.backgroundSize, pos: b.backgroundPosition, stageBg: sg.backgroundColor, stageImg: sg.backgroundImage, ow: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
        }, sc);
        check(`${t} ${sc} body colour = Invite #161616`, r.bg === "rgb(22, 22, 22)", r.bg);
        // pre-A-839 baseline: gradient stops 31px / 32px and size /32px/ (k = 1). A-839: pitch = 32 x HomeCard / 282 in every scene.
        const pitch = (32 * layoutOracle(MAIN_SRC)(w, h).cardW) / 282;
        check(`${t} ${sc} body rule gradient = common notebook (pitch 32 x HomeCard / 282 = ${pitch.toFixed(2)}, origin 0 0)`, /repeating-linear-gradient\(.*rgba\(255, 255, 255, 0\.04\) [\d.]+px, rgba\(255, 255, 255, 0\.04\) [\d.]+px\)/.test(r.img) && !/url\(/.test(r.img) && Math.abs(parseFloat(r.size.split(" ")[1]) - pitch) <= 0.05 && r.pos === "0px 0px", `${r.img} | ${r.size} | ${r.pos}`);
        check(`${t} ${sc} stage adds no own ground (transparent, no image)`, r.stageBg === "rgba(0, 0, 0, 0)" && r.stageImg === "none", `${r.stageBg} ${r.stageImg}`);
        check(`${t} ${sc} colour step vs Invite = none`, r.bg === prevInvite);
        check(`${t} ${sc} no horizontal overflow`, r.ow);
        if (sc === "sendstay" || sc === "explore") {
          await sleep(100);
          const shot = await page.screenshot({ clip: { x: 0, y: 0, width: Math.min(w, 64), height: 96 } });
          if (OUT) await page.screenshot({ path: path.join(OUT, `${sc}_${t}.png`) });
          const png = (await import("node:zlib")); // decode via page canvas instead
          const px = await page.evaluate(async (b64) => {
            const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
            const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
            const at = (y) => Array.from(g.getImageData(4, y, 1, 1).data.slice(0, 3));
            return { y10: at(10), col: Array.from({ length: Math.min(img.height, 96) }, (_, y) => at(y)[0]) };
          }, shot.toString("base64"));
          // pre-A-839 baseline: px.y10 #161616, y=31 and y=63 lighter, y=32 #161616 (pitch 32 px exactly). A-839: the rule rows sit at 31 k / 63 k (pitch 32 k): a lighter row within 1 px of each.
          const kk = layoutOracle(MAIN_SRC)(w, h).k; const m1 = Math.floor(31.5 * kk), m2 = Math.floor(63.5 * kk);
          check(`${t} ${sc} pixel: y=10 is #161616 (above the first line at 31 k), a rule row lies at ~31.5 k and ~63.5 k (k = ${kk.toFixed(3)})`, px.y10.join() === "22,22,22" && [m1 - 1, m1, m1 + 1].some((y) => px.col[y] > 22) && [m2 - 1, m2, m2 + 1].some((y) => px.col[y] > 22), JSON.stringify({ m1, m2, y10: px.y10 }));
        }
      }
      check(`${t} no page errors`, errs.length === 0, errs.join("|"));
      await ctx.close();
    }
  } finally { await browser.close(); if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch {} } }
}
await main();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
