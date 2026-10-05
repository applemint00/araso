// [A-736] Common dark background = Invite's existing CSS language (#161616 + 32px/1px/rgba(255,255,255,.04) rule lines). CSS-only.
//   node app/test/a736-common-background.mjs     (static part always; browser part if local harness exists)
// Env: A736_BASE_URL reuses a server (else spawns vite --mode a172-local --strictPort on 5835); A736_OUT=<dir> for screenshots.
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
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
check("Invite paper keeps #161616", /background:\s*#161616/.test(inv));
check("Invite paper keeps 32px/.04 rule gradient", RULE.test(inv));
check("body uses var(--paper) (#161616) colour", /background-color:\s*var\(--paper\)/.test(body) && /--paper:\s*#161616/.test(NC));
check("body uses the SAME rule gradient as Invite (31/32px, .04)", RULE.test(body));
check("body gradient tile pinned to 32px, origin 0 0", /background-size:\s*100% 32px/.test(body) && /background-position:\s*0 0/.test(body));
check("body no longer references bg_notebook_dark.png", !/bg_notebook_dark/.test(NC));
check("no #050505 stage ground remains on sendstay/hatch/name/return",
  !/\.stage\[data-scene="sendstay"\]\s*\{[^}]*#050505/.test(NC) && !/\.stage--name\s*\{[^}]*#050505/.test(NC) && !/\.stage\[data-scene="return"\]\s*\{[^}]*#050505/.test(NC));
check("Invite board keeps #050505", /\.invite\s*\{[^}]*#050505/.test(NC));
check("body background-image:none only for Invite", /body:has\(\.stage--invite\)\s*\{\s*background-image:\s*none;\s*\}/.test(NC) && (NC.match(/body:has\([^)]*\)[^{]*\{\s*background-image:\s*none/g) || []).length === 1);
check("paper_tex_ivory references unchanged (count)", (CSS.match(/paper_tex_ivory/g) || []).length === Number(process.env.A736_IVORY_COUNT || 16), String((CSS.match(/paper_tex_ivory/g) || []).length));
check("no new url() image in body rule", !/url\(/.test(body));

// ---- browser
async function main() {
  if (!existsSync(path.join(REPO, "_private/ops/harness/package.json"))) { console.log("SKIP  browser part — harness absent"); return; }
  if (process.env.A736_NODE_ONLY === "1") { console.log("SKIP  browser part — A736_NODE_ONLY"); return; }
  const { chromium } = createRequire(path.join(REPO, "_private/ops/harness/package.json"))("playwright");
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
      check(`${t} Invite body flat #161616, no image`, iv.bodyBg === "rgb(22, 22, 22)" && iv.bodyImg === "none", JSON.stringify(iv));
      check(`${t} Invite paper still #161616 + rule gradient`, iv.paperBg === "rgb(22, 22, 22)" && /repeating-linear-gradient/.test(iv.paperImg));
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
        check(`${t} ${sc} body rule gradient = Invite (32px pitch, origin 0 0)`, /repeating-linear-gradient\(.*rgba\(255, 255, 255, 0\.04\) 31px, rgba\(255, 255, 255, 0\.04\) 32px\)/.test(r.img) && !/url\(/.test(r.img) && /32px/.test(r.size) && r.pos === "0px 0px", `${r.img} | ${r.size} | ${r.pos}`);
        check(`${t} ${sc} stage adds no own ground (transparent, no image)`, r.stageBg === "rgba(0, 0, 0, 0)" && r.stageImg === "none", `${r.stageBg} ${r.stageImg}`);
        check(`${t} ${sc} colour step vs Invite = none`, r.bg === prevInvite);
        check(`${t} ${sc} no horizontal overflow`, r.ow);
        if (sc === "sendstay" || sc === "explore") {
          await sleep(100);
          const shot = await page.screenshot({ clip: { x: 0, y: 0, width: Math.min(w, 64), height: 66 } });
          if (OUT) await page.screenshot({ path: path.join(OUT, `${sc}_${t}.png`) });
          const png = (await import("node:zlib")); // decode via page canvas instead
          const px = await page.evaluate(async (b64) => {
            const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
            const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
            const at = (y) => Array.from(g.getImageData(4, y, 1, 1).data.slice(0, 3));
            return { y10: at(10), y31: at(31), y63: at(63), y32: at(32) };
          }, shot.toString("base64"));
          check(`${t} ${sc} pixel: y=10 is #161616, y=31 and y=63 are rule rows (lighter)`, px.y10.join() === "22,22,22" && px.y31[0] > 22 && px.y63[0] > 22 && px.y32.join() === "22,22,22", JSON.stringify(px));
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
