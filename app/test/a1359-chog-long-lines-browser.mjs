// [A-1359 · Owner 10-17 15:0x "긴 것들은 폰에서 문제라 · 긴 글이 있나 스윕하고 좀 나눠 넣는 걸로" · 16:1x "긴 건 옆으로 뺀 거 아닌가" · 18:0x "이 규칙으로 바로"]
// Every Chog line, said through the real cue path on Home at 390 · 810 · 1440: inside the screen, clear of Chog's ink and Piggy's ink.
// A long line (main.js CHOG_LINE_BREAKS) sits left of Chog (the #firstSendChogCue rule); where that leaves the screen it is said in the
// Owner's pieces (after a comma / full stop, else between its meaning chunks) — the words never change. Lines with their own Owner place
// (#firstSendChogCue · #a904GuideLine · #returnArrivalAlarm) are measured by their own tests.
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./helpers/a803-browser.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
let pass = 0, fail = 0;
const check = (ok, label) => { if (ok) { pass += 1; console.log(`PASS  ${label}`); } else { fail += 1; console.log(`FAIL  ${label}`); } };

// words never change: every piece list joins back to its line
const table = MAIN.match(/const CHOG_LINE_BREAKS = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
const breaks = table ? Object.fromEntries([...table[1].matchAll(/^\s*("(?:[^"\\]|\\.)*"): (\[[^\n]*\]),$/gm)].map((m) => [JSON.parse(m[1]), JSON.parse(m[2])])) : {};
check(Object.keys(breaks).length > 0 && Object.entries(breaks).every(([k, v]) => v.join(" ") === k && v.length >= 2), `the pieces are the line's own words (${Object.keys(breaks).length} lines)`);

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log(`SKIP  a1359 browser part (ARASO_TEST_BROWSER=1 to run) · ${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0); }
const OUT = path.resolve(process.argv[2] || "screenshots/a1359-chog-long-lines");
mkdirSync(OUT, { recursive: true });
const SAY = {
  closingSoon: ["nap time soon~", "if you want to explore more, tap to wake me up."],
  done: ["done!"], tryAgain: ["try again"], thanks: ["got it. thank you"],
  exploreCheck: ["let me see which jobs can go."], pickTwo: ["two can go. pick one?"], pickMany: ["pick one of these."], pickOne: ["only this one can go. go?"],
  pickNone: ["none of these can go now.", "something else?"], exploreWait: ["oh… no jobs to go.", "wait for the next bell?"],
  awayOut: ["still out working."], returnKeep: ["tucked away at home~"], secondIntro: ["ooh, more jobs to try~", "work's coming!"],
  "job:market": ["piggy trades one coin for another.", "a quick swap at the market."], "job:order": ["piggy leaves a price and waits.", "buy only if the price comes."],
  "job:clean": ["want me to sweep the crumbs into MON?", "little bits everywhere. make them one MON pile?"], "job:lp": ["earn a little when people swap", "piggy helps others trade."],
  "job:claim": ["piggy picks up what's yours.", "something's waiting for you."], "job:grow": ["piggy parks money where it earns a little.", "let money sit and grow."],
  "job:asset-piece": ["piggy brings back a small piece of something."], "job:move": ["piggy moves to a spot that pays better."], "job:stay": ["piggy stays home today. nothing moves."],
};
const H = await launch({ forkMode: true });
const { p } = H;
try {
  await H.seedSolo("Honeybun");
  for (const [w, h] of [[390, 844], [810, 1080], [1440, 900]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600); await H.unlock(); await H.waitScene(["sendstay"], 9000); await sleep(1500);
    // Chog's ink box (shot with / without its parts) · Piggy's seat ink box
    const shot = async () => (await p.screenshot({ type: "png" })).toString("base64");
    const hide = (on) => p.evaluate((v) => document.querySelectorAll("#chogHome .chogHome__part").forEach((e) => { e.style.visibility = v ? "hidden" : ""; }), on);
    const a = await shot(); await hide(true); const b = await shot(); await hide(false);
    const ink = await p.evaluate(async ([A, B]) => {
      const load = async (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i); const bmp = await createImageBitmap(new Blob([u], { type: "image/png" })); const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; const x = c.getContext("2d"); x.drawImage(bmp, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
      const [X, Y] = [await load(A), await load(B)]; const k = X.width / innerWidth; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      // only inside Chog's own parts box (Piggy breathes between the two shots)
      const P = [...document.querySelectorAll("#chogHome .chogHome__part")].map((e) => e.getBoundingClientRect()).filter((q) => q.width > 0);
      const [bx0, by0, bx1, by1] = [Math.min(...P.map((q) => q.left)), Math.min(...P.map((q) => q.top)), Math.max(...P.map((q) => q.right)), Math.max(...P.map((q) => q.bottom))].map((v) => Math.round(v * k));
      for (let y = Math.max(0, by0); y < Math.min(X.height, by1); y += 1) for (let x = Math.max(0, bx0); x < Math.min(X.width, bx1); x += 1) { const i = (y * X.width + x) * 4; if (Math.abs(X.data[i] - Y.data[i]) + Math.abs(X.data[i + 1] - Y.data[i + 1]) + Math.abs(X.data[i + 2] - Y.data[i + 2]) > 60) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
      const pig = document.querySelector("#piggy_seat_idle")?.getBoundingClientRect();
      return { chog: [x0 / k, y0 / k, (x1 + 1) / k, (y1 + 1) / k], pig: pig ? [pig.left, pig.top, pig.right, pig.bottom] : null };
    }, [a, b]);
    for (const [name, lines] of Object.entries(SAY)) {
      const r = await p.evaluate(([L]) => {
        document.querySelector("#zzA1359")?.remove();
        window.__arasoChogLine("zzA1359", L);
        const el = document.querySelector("#zzA1359");
        const parts = el.querySelectorAll(".chogCheckLine__line").length ? [...el.querySelectorAll(".chogCheckLine__line")] : [el];
        return { said: parts.map((e) => e.textContent), left: el.classList.contains("chogCheckLine--left"), boxes: parts.map((e) => { const g = document.createRange(); g.selectNodeContents(e); const q = g.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom]; }) };
      }, [lines]);
      const hit = (B, R) => R && B[0] < R[2] && B[2] > R[0] && B[1] < R[3] && B[3] > R[1];
      const inside = r.boxes.every((B) => B[0] >= 0 && B[2] <= w);
      const clear = r.boxes.every((B) => !hit(B, ink.chog) && !hit(B, ink.pig)) && r.boxes.every((B) => B[2] <= ink.chog[0] - 7.5); // [A-1366 RE-PIN · Owner 22:1x] every line ends ≥ 8 px before Chog (one start line · a1366 test); pre-A-1366: only the left-placed ones
      const same = r.said.join(" ") === lines.join(" ");
      const xs = r.boxes.map((B) => `[${Math.round(B[0])},${Math.round(B[2])}]`).join("");
      check(inside && clear && same, `${w} ${name}: inside the screen · clear of Chog / Piggy · same words (${xs} chog ${ink.chog.map(Math.round)} piggy ${ink.pig?.map(Math.round)} · ${JSON.stringify(r.said)})`);
      if (name.startsWith("job:") || name === "closingSoon" || name === "exploreCheck") await p.screenshot({ path: path.join(OUT, `${w}-${name.replace(":", "-")}.png`) });
    }
  }
} finally { await H.close(); }
console.log(`A-1359 Chog long lines: ${fail ? `FAIL ${fail}` : "PASS"} (${pass} PASS) · ${OUT}`);
process.exit(fail ? 1 : 0);
