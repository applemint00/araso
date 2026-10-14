// [A-725] HOME TAP-CUE → FIRST SEND PACING — timing-only regression.
//   node app/test/a725-tap-cue-pacing.mjs            (node part + browser part)
//   A725_NODE_ONLY=1 node app/test/a725-tap-cue-pacing.mjs   (node part only)
//
// Owner device finding (INBOX "OWNER DEVICE FINDING — A-722 · TAP-ME → FIRST SEND PACING"): the
// first-arrival "tap me!" cue passes too quickly and runs into the First Job (send?) card. A-626 A
// recorded the Owner envelope "after the label reaches full opacity, keep it fully readable for about
// 1.0–1.5 seconds before First Job takes the slot". A-725 moves ONLY the full-visible hold to the upper
// edge of that envelope: 1200 → 1500ms. Delay / wave / fade / copy / position / size unchanged.
//
// Part 1 (no browser): TAP_CUE_TIMING values; the First Job reveal still derives its wait from the
//   cue's own remaining time (tapCueHoldRemainingMs) — no hard-coded total in main.js.
// Part 2 (LIVE: vite --mode a172-local on :5801 + Playwright Chromium from the local harness): the
//   real first-arrival settle path (existing DEV-only __arasoScene("sendstay", {arrival:true})) at
//   390/430/700/1440, normal + reduced motion. An in-page recorder samples EVERY animation frame
//   (requestAnimationFrame) plus a MutationObserver:
//     - full-opacity hold = (cue label removed) − (first frame the label is at opacity 1) ≈ 1500ms
//     - zero frames where the cue label and the First Job card are both in the document
//     - zero mutation batches that leave both in the document (DOM-level, stricter than paint)
//     - the cue is gone (not in DOM) before the First Job card first appears; it never comes back
//     - the Home paper never auto-opens (pad opacity 0 in every frame before the card)
//   Reduced motion: static label at opacity 1 from its first frame, arm never rotates, same First
//   Job card, no overlap. No WebAuthn, no tx, no network beyond the local dev server.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { admitSequencedPiggy, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { migrateSinglePiggy, createPiggy, saveRegistry, piggyRegistryKey } from "../src/piggy-registry.js";
import { TAP_CUE_TIMING, tapCueFrame } from "../src/chog-home.js";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(REPO_ROOT, "app");
const VITE_PORT = Number(process.env.A725_PORT) || 5801;
const APP_URL = `http://127.0.0.1:${VITE_PORT}/`;
const HARD_TIMEOUT_MS = 240_000;
const NODE_ONLY = process.env.A725_NODE_ONLY === "1";

// Measured-hold acceptance. Target = TAP_CUE_TIMING.holdMs (1500). rAF sampling reports "first frame at
// opacity 1" up to one frame late, and the reveal timer fires on the next task after the cue clock
// passes readyMs, so the measured hold sits in [target − 1 frame, target + a few frames]. The window
// below is ±~5 frames around 1500 — it excludes the old 1200ms hold by a wide margin.
const HOLD_TARGET_MS = 1500;
const HOLD_MIN_MS = 1420;
const HOLD_MAX_MS = 1700;

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  return ok;
}

// ═══ Part 1 — node ══════════════════════════════════════════════════════════════════════════
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const RAW_MAIN = readFileSync(path.join(APP_DIR, "src/main.js"), "utf8");
const MAIN = stripComments(RAW_MAIN);
const CHOG = stripComments(readFileSync(path.join(APP_DIR, "src/chog-home.js"), "utf8"));

check("TAP_CUE_TIMING.holdMs = 1500 (upper edge of the recorded 1.0–1.5s Owner envelope)", TAP_CUE_TIMING.holdMs, HOLD_TARGET_MS);
check("TAP_CUE_TIMING delay/wave/fade/entrance unchanged = 300/1320/250/1870",
  [TAP_CUE_TIMING.delayMs, TAP_CUE_TIMING.waveMs, TAP_CUE_TIMING.fadeMs, TAP_CUE_TIMING.entranceMs], [300, 1320, 250, 1870]);
check("TAP_CUE_TIMING.readyMs = entrance 1870 + hold 1500 = 3370", TAP_CUE_TIMING.readyMs, 3370);
check("wave keys unchanged (A-614 PREVIEW WAVE_SUBTLE_KEYS)", TAP_CUE_TIMING.waveKeys, [[0, 0], [350, -7], [550, -4], [770, -8], [960, -4], [1320, 0]]);
// [A-779 RE-PIN] A-777 §8.2 LOCKED Chog microcopy legibility bump: "tap me!" 15 -> 18 screen px (text size only; timing pins below unchanged).
check("label screen size = A-779 legibility value (18px)", TAP_CUE_TIMING.screenPx, 18);
check("hold envelope: 1000 ≤ holdMs ≤ 1500", TAP_CUE_TIMING.holdMs >= 1000 && TAP_CUE_TIMING.holdMs <= 1500, true);
check("tapCueFrame: opacity 1 across the whole hold (1870 / 2620 / 3369), wave 0 during hold",
  [tapCueFrame(1870).labelOpacity, tapCueFrame(2620).labelOpacity, tapCueFrame(3369).labelOpacity, tapCueFrame(2620).waveDeg, tapCueFrame(3369).entering], [1, 1, 1, 0, false]);
check("tapCueFrame(reduced) = static: wave 0, opacity 1", tapCueFrame(500, true), { waveDeg: 0, labelOpacity: 1, entering: false });
check("copy unchanged: label text 'tap me!'", /label\.textContent = "tap me!";/.test(CHOG), true);
check("hold getter still = readyMs − cue clock (0 for reduced/hidden/none)",
  /get tapCueHoldRemainingMs\(\) \{\s*if \(!tapCue \|\| tapCue\.hidden \|\| reduced\) return 0;\s*return Math\.max\(0, TAP_CUE_TIMING\.readyMs - tapCue\.t\);/.test(CHOG), true);
check("main.js revealSendCard waits on tapCueHoldRemainingMs, then closeCard() BEFORE the card renders",
  /const cueWait = homeChog\?\.tapCueHoldRemainingMs \|\| 0;[\s\S]*?if \(cueWait > 0\) \{\s*sceneTimeout\(revealSendCard, Math\.max\(50, cueWait\)\);\s*return;\s*\}[\s\S]*?homeChog\?\.closeCard\?\.\(\);\s*state\.sendCardVisible = true;\s*render\(\);/.test(RAW_MAIN), true);
check("main.js has no hard-coded cue total (3070 / 3370 / 1870) — handoff follows TAP_CUE_TIMING", /\b(3070|3370|1870)\b/.test(MAIN), false);
check("closeCard() hides (removes) the cue first", /const closeCard = \(\) => \{\s*hideTapCue\(\);/.test(CHOG), true);
check("hideTapCue() removes the label node (no opacity-0 ghost left in the DOM)", /tapCue\.hidden = true;\s*waveDeg = 0;\s*tapCue\.label\.remove\(\);/.test(CHOG), true);

// ═══ Part 2 — live browser ══════════════════════════════════════════════════════════════════
function stagingStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const CHAIN = "monad-testnet";
const AT = "2026-09-23T06:00:00.000Z";
const AT_MS = Date.parse(AT);
const makeAddr = (seed) => "0x" + seed.toString(16).padStart(40, "0");
const SELF_ADDR = makeAddr(0xa552100);
const MOCHI_ADDR = makeAddr(0xa552200);
const honeybunId = `legacy-${SELF_ADDR.toLowerCase()}`;
const mochiId = `piggy-${MOCHI_ADDR.toLowerCase()}`;
// Same construction as a624-home-cue-history-residents.mjs (REAL product functions).
async function buildFixture() {
  const idx = stagingStorage();
  const cred = { credentialId: Buffer.from("root-cred").toString("base64url") };
  const r1 = registerControlledPiggy(idx, CHAIN, { id: honeybunId, name: "Honeybun", address: SELF_ADDR, signerAddress: SELF_ADDR, locator: cred, at: AT });
  if (!r1.ok) throw new Error(`registerControlledPiggy: ${r1.reason}`);
  const r2 = await admitSequencedPiggy({
    storage: idx, chainId: CHAIN, sequence: 1, rootCredential: cred,
    requestPrf: async (c) => ({ credentialId: c.credentialId, prfOutput: new Uint8Array(32) }),
    deriveAddress: () => MOCHI_ADDR, now: () => AT,
  });
  if (!r2.ok) throw new Error(`admitSequencedPiggy: ${r2.reason}`);
  renameIndexedPiggy(idx, CHAIN, { id: mochiId, name: "Mochi" });
  const indexKey = `araso.myPiggiesIndex.v1.${CHAIN}`;
  const first = migrateSinglePiggy({ address: SELF_ADDR, name: "Honeybun", createdAt: AT });
  const born = createPiggy({ piggies: [first.piggy], newPiggy: { id: mochiId, name: null, address: MOCHI_ADDR }, at: AT });
  if (!born.ok) throw new Error(`createPiggy: ${born.reason}`);
  const reg = stagingStorage();
  const scope = { accountId: SELF_ADDR, chainId: CHAIN };
  saveRegistry(reg, scope, { piggies: born.piggies });
  const mk = ({ piggyId, at, txHash }) => ({
    before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000",
    txHash, depositTxHash: `${txHash}-dep`, redeemTxHash: `${txHash}-red`, grantTxHash: `${txHash}-grant`,
    status: "success", at, ...(piggyId ? { piggyId } : {}),
  });
  return {
    "araso.address": SELF_ADDR,
    "araso.passkey": JSON.stringify(cred),
    "araso.piggyName": "Honeybun",
    "araso.birthPlayed": "1",
    "araso.piggyReceived": "1",
    "araso.secondJourneyClosed": "1",
    "araso.receipts": JSON.stringify([mk({ piggyId: honeybunId, at: AT_MS + 60_000, txHash: "0xhoneybun1" }), mk({ piggyId: mochiId, at: AT_MS + 120_000, txHash: "0xmochi1" })]),
    [indexKey]: idx.getItem(indexKey),
    [piggyRegistryKey(scope)]: reg.getItem(piggyRegistryKey(scope)),
  };
}

// In-page recorder. Installed, then the first arrival is triggered in the SAME evaluate so the very
// first cue frame is captured. Each rAF sample = the state the previous frame painted plus whatever
// tasks ran since; the MutationObserver sees every DOM batch (incl. one where both exist even if no
// frame was painted in between).
const RECORD_AND_ARRIVE = `(() => {
  const rec = { frames: [], muts: [], domOverlap: 0, done: false };
  window.__a725 = rec;
  const cueEl = () => document.querySelector(".chogHome__tapCue");
  const sendEl = () => document.querySelector("#sendCardAnchor");
  const sendVisible = () => { const s = sendEl(); if (!s) return false; const r = s.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const has = (n, sel) => n.nodeType === 1 && (n.matches(sel) || !!n.querySelector(sel));
  const mo = new MutationObserver((list) => {
    const t = performance.now();
    for (const m of list) {
      for (const n of m.addedNodes) { if (has(n, ".chogHome__tapCue")) rec.muts.push({ t, k: "cueAdd" }); if (has(n, "#sendCardAnchor")) rec.muts.push({ t, k: "sendAdd" }); }
      for (const n of m.removedNodes) { if (has(n, ".chogHome__tapCue")) rec.muts.push({ t, k: "cueRemove" }); }
    }
    if (cueEl() && sendEl()) rec.domOverlap += 1;
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  let sendSeenAt = -1;
  const t0 = performance.now();
  const tick = () => {
    const t = performance.now();
    const c = cueEl();
    const armT = document.querySelector('[data-part="home-near-arm"]')?.style.transform || "";
    const m = /rotate\\((-?[\\d.e-]+)deg\\)/.exec(armT);
    rec.frames.push({
      t, cues: document.querySelectorAll(".chogHome__tapCue").length,
      op: c ? Number(getComputedStyle(c).opacity) : null,
      send: sendVisible(),
      pad: Number(document.querySelector("#chogHomePad")?.style.opacity || 0),
      arm: m ? Number(m[1]) : 0,
      cueState: document.querySelector("#chogHome")?.dataset.tapCue ?? null,
    });
    if (sendSeenAt < 0 && rec.frames[rec.frames.length - 1].send) sendSeenAt = rec.frames.length;
    if ((sendSeenAt > 0 && rec.frames.length - sendSeenAt >= 30) || t - t0 > 9000) { rec.done = true; mo.disconnect(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__arasoScene("sendstay", { arrival: true });
  return true;
})()`;

function analyse(rec) {
  const F = rec.frames;
  const firstIdx = (pred) => F.findIndex(pred);
  const iCue = firstIdx((f) => f.cues > 0);
  const iFull = firstIdx((f) => f.cues > 0 && f.op >= 0.999);
  const iGone = iFull >= 0 ? F.findIndex((f, i) => i > iFull && f.cues === 0) : -1;
  const iSend = firstIdx((f) => f.send);
  // The cue removal that ends the hold = the first cueRemove after the label reached full opacity
  // (a mobile mount can replace an earlier, not-yet-visible label instance at t≈0 — not the handoff).
  const tFullRaw = iFull >= 0 ? F[iFull].t : Infinity;
  const iRemove = rec.muts.findIndex((m) => m.k === "cueRemove" && m.t >= tFullRaw);
  const iSendAdd = rec.muts.findIndex((m) => m.k === "sendAdd");
  const tCueRemove = iRemove >= 0 ? rec.muts[iRemove].t : null;
  const tSendAdd = iSendAdd >= 0 ? rec.muts[iSendAdd].t : null;
  const tGone = tCueRemove ?? (iGone >= 0 ? F[iGone].t : null);
  const overlapFrames = F.filter((f) => f.cues > 0 && f.send).length;
  const cueAfterSend = iSend >= 0 ? F.slice(iSend).filter((f) => f.cues > 0).length : null;
  const maxPadBeforeSend = Math.max(0, ...F.slice(0, iSend >= 0 ? iSend : F.length).map((f) => f.pad));
  const t0 = iCue >= 0 ? F[iCue].t : null;
  const rel = (t) => (t == null || t0 == null ? null : Math.round(t - t0));
  return {
    frames: F.length,
    cueFirst: iCue >= 0 ? 0 : null,
    fullAt: iFull >= 0 ? rel(F[iFull].t) : null,
    goneAt: rel(tGone),
    sendAt: iSend >= 0 ? rel(F[iSend].t) : null,
    sendAddAt: rel(tSendAdd),
    hold: iFull >= 0 && tGone != null ? Math.round(tGone - F[iFull].t) : null,
    removeBeforeSendAdd: iRemove >= 0 && iSendAdd >= 0 ? iRemove < iSendAdd : null,
    cueAdds: rec.muts.filter((m) => m.k === "cueAdd").length,
    gapFrames: iGone >= 0 && iSend >= 0 ? iSend - iGone : null,
    overlapFrames, domOverlap: rec.domOverlap, cueAfterSend, maxPadBeforeSend,
    minArm: Math.min(0, ...F.map((f) => f.arm)), firstOp: iCue >= 0 ? F[iCue].op : null,
    labelsMax: Math.max(0, ...F.map((f) => f.cues)),
  };
}

const VIEWPORTS = [[390, 844], [430, 932], [700, 1000], [1440, 900]];
const timeline = [];
let viteProc = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { const r = await fetch(url); if (r.ok || r.status === 404) return; } catch { /* retry */ } await wait(200); }
  throw new Error(`timed out waiting for ${url}`);
}
function cleanup() {
  try { if (viteProc && viteProc.exitCode == null) process.kill(-viteProc.pid, "SIGKILL"); } catch { /* best effort */ }
}

async function live() {
  if (!existsSync(privatePath("ops/harness/package.json"))) {
    console.log("SKIP  Part 2 — local Playwright harness absent (public checkout)");
    return;
  }
  const req = createRequire(privatePath("ops/harness/package.json"));
  const { chromium } = req("playwright");
  const fx = await buildFixture();
  viteProc = spawn(path.join(REPO_ROOT, "node_modules/.bin/vite"), ["--mode", "a172-local", "--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], {
    cwd: APP_DIR, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost", VITE_RELAYER_URL: "__HARNESS_NO_GRANT__" },
  });
  await waitForHttp(APP_URL, 25_000);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const reduced of [false, true]) {
      for (const [W, H] of VIEWPORTS) {
        const tag = `${W}${reduced ? "R" : ""}`;
        const context = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: reduced ? "reduce" : "no-preference" });
        let blockedTx = 0;
        await context.route("**/*", async (route) => {
          const r = route.request();
          if (/eth_sendRawTransaction|eth_sendTransaction|eth_sendUserOperation/.test(r.postData() || "")) { blockedTx += 1; return route.abort(); }
          const u = new URL(r.url());
          if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return route.abort();
          return route.continue();
        });
        const p = await context.newPage();
        await p.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        const errors = [];
        p.on("pageerror", (e) => errors.push(String(e?.message || e).slice(0, 200)));
        await p.goto(APP_URL);
        await p.evaluate((kv) => { localStorage.clear(); for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, fx);
        await p.goto(APP_URL);
        await p.waitForSelector("#chogHomeHit", { timeout: 15000 });
        await wait(1800);
        if (await p.$("#stayButton")) { await p.click("#stayButton"); await wait(700); }
        check(`${tag}: reduced-motion media matches the run`, await p.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), reduced);
        await p.evaluate(RECORD_AND_ARRIVE);
        await p.waitForFunction(() => window.__a725?.done === true, null, { timeout: 15000 });
        const a = analyse(await p.evaluate(() => window.__a725));
        timeline.push({ tag, ...a });
        // [A-895 P-D COVERAGE POINTER] The check titles below still describe the pre-A-891 first-arrival cue, but they now pin its ABSENCE
        // (re-pinned values). The cue's timing coverage (entrance / hold / wave / cue-before-Send) is no longer in this file: the First Send reveal
        // timing is covered by a891-wave4-file-quiet-tapme.mjs Part B (firstArrival: cardsInQuiet 0, readyMs), and the post-file / revisit cue's
        // entrance + 18px render by a779-small-text-unify.mjs B5 and a891 Part B. Read "exactly one 'tap me!' label" etc. as "zero (A-891)".
        // [A-891 CG-04, Owner 2026-10-08] First Home stays quiet: no first-arrival "tap me!". Re-pinned to the coordinator browser run 2026-10-08 (browser_merged/a725-tap-cue-pacing.log).
        // pre-A-891 baseline: [0, 1, true] (sendAt is measured from the first cue frame, so it is null without a cue)
        check(`${tag}: exactly one 'tap me!' label appears, the First Job card follows`, [a.cueFirst, a.labelsMax, a.sendAt != null], [null, 0, false]);
        check(`${tag}: zero frames with cue + First Job card together (paint-level)`, a.overlapFrames, 0);
        check(`${tag}: zero DOM batches with cue + First Job card together`, a.domOverlap, 0);
        // pre-A-891 baseline: true
        check(`${tag}: cue removed in the DOM before the card is inserted`, a.removeBeforeSendAdd, null);
        // pre-A-891 baseline: [true, 0]
        check(`${tag}: cue fully gone (not in DOM) by the first card frame, never returns`, [a.goneAt != null && a.sendAt != null && a.goneAt <= a.sendAt, a.cueAfterSend], [false, 0]);
        check(`${tag}: Home paper never auto-opens (pad opacity 0 every frame before the card)`, a.maxPadBeforeSend, 0);
        if (!reduced) {
          // pre-A-891 baseline: true, true, true (no first-arrival label → no entrance, no hold, no wave; the A-725 hold now belongs to the post-file cue, a891 Part B)
          check(`${tag}: label reaches full opacity at ≈ entrance (1870ms ±150 after the cue appears)`, a.fullAt != null && Math.abs(a.fullAt - TAP_CUE_TIMING.entranceMs) <= 150, false);
          check(`${tag}: full-opacity hold measured ${a.hold}ms ∈ [${HOLD_MIN_MS}, ${HOLD_MAX_MS}] (target ${HOLD_TARGET_MS})`, a.hold != null && a.hold >= HOLD_MIN_MS && a.hold <= HOLD_MAX_MS, false);
          check(`${tag}: the wave still plays (min arm ≤ −5°, never beyond −8°)`, a.minArm <= -5 && a.minArm >= -8.0001, false);
        } else {
          // pre-A-891 baseline: [1, 0] and true
          check(`${tag}: reduced → static label at opacity 1 from its first frame, arm never rotates`, [a.firstOp, a.minArm], [null, 0]);
          check(`${tag}: reduced → readable ≥ 1.0s before the same First Job card (existing reveal)`, a.hold != null && a.hold >= 1000 && a.hold <= 1700, false);
        }
        check(`${tag}: page errors 0, blocked tx 0`, [errors, blockedTx], [[], 0]);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log("\nTIMELINE (ms from first cue frame) — tag | full | gone | send(frame) | hold | gapFrames | overlapFrames | domOverlap | frames");
  for (const r of timeline) console.log(`  ${r.tag} | ${r.fullAt} | ${r.goneAt} | ${r.sendAt} | ${r.hold} | ${r.gapFrames} | ${r.overlapFrames} | ${r.domOverlap} | ${r.frames}`);
}

const timeout = setTimeout(() => { console.error("FAIL  hard timeout"); cleanup(); process.exit(1); }, HARD_TIMEOUT_MS);
timeout.unref?.();
if (NODE_ONLY) console.log("SKIP  Part 2 — A725_NODE_ONLY=1 (browser part not run)");
else { try { await live(); } catch (err) { fail += 1; console.error("FAIL  uncaught:", err && err.stack ? err.stack : err); } finally { clearTimeout(timeout); cleanup(); } }
clearTimeout(timeout);
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — pass ${pass} · fail ${fail}`);
process.exit(fail ? 1 : 0);
