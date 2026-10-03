// [A-654] Multi-Piggy living Home — measured safe slots + stable random ambient motion.
//   node app/test/a654-living-home.mjs
//
// Part N (node, always): the pure motion/slot model (weights, density, stable seed, runtime priority,
//   measured slot formulas incl. WA1/WA2 at 1440), source guards (visual code never touches money,
//   signer, permission or selection), and the public motion assets (present, SVG, no internal metadata).
// Part B (real browser, default ON when the local harness exists): Playwright + CDP virtual authenticator
//   on a local Vite dev server (127.0.0.1). One session builds 1→4 Piggies and checks every width.
//   Env: A654_BASE_URL reuses a running server (else this spawns one on 127.0.0.1:5669 and kills it);
//        A654_SHOTS=<dir> saves PNGs; A654_NODE_ONLY=1 skips Part B (prints SKIP; not a PASS).
// On the pre-A-654 tree the model exports and the living layer do not exist → Part N/B fail → exit 1.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const ASSET_DIR = path.join(REPO, "app/public/motion/home-ambient");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
function fnBody(name) {
  const m = MAIN.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`function missing: ${name}`);
  let depth = 0;
  for (let i = MAIN.indexOf("{", MAIN.indexOf(")", m.index)); i < MAIN.length; i += 1) {
    if (MAIN[i] === "{") depth += 1;
    else if (MAIN[i] === "}") { depth -= 1; if (depth === 0) return MAIN.slice(m.index, i + 1); }
  }
  throw new Error(`function end missing: ${name}`);
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// ═══ Part N ════════════════════════════════════════════════════════════════════════════════════
let M = null;
await check("N0 piggy-motion-state exports the living-Home model (pre-A-654: absent)", async () => {
  M = await import("../src/piggy-motion-state.js");
  for (const n of ["assignHomeAmbient", "orderHomeResidents", "planHomeSlots", "fitWideSlot", "hashSeed", "seededRandom", "isRuntimeMotionState"]) {
    assert.equal(typeof M[n], "function", `${n} missing`);
  }
  assert.deepEqual({ ...M.AMBIENT_WEIGHTS }, { idle: 30, watching: 20, drink: 15, listen: 15, sunshine: 15, "flop-sleep": 5 });
  for (const s of ["work", "away", "return"]) assert.equal(M.AMBIENT_MOTION_STATES.includes(s), false, `${s} is never ambient`);
});

await check("N1 same Piggy ids + same Home-life nonce → identical assignment; order/selection never matters", () => {
  const ids = ["p-honey", "p-mochi", "p-bebe", "p-dump"];
  const a = M.assignHomeAmbient(ids, "00aa11bb22cc33dd");
  const b = M.assignHomeAmbient([...ids].reverse(), "00aa11bb22cc33dd");
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  assert.deepEqual(M.orderHomeResidents(ids, "00aa11bb22cc33dd", "p-honey"), M.orderHomeResidents([...ids].reverse(), "00aa11bb22cc33dd", "p-honey"));
  assert.equal(M.orderHomeResidents(ids, "00aa11bb22cc33dd", "p-honey")[0], "p-honey", "scene Piggy keeps the seat");
  let differs = 0;
  for (let i = 0; i < 40; i += 1) {
    const x = M.assignHomeAmbient(ids, `n${i}`);
    if (JSON.stringify([...x]) !== JSON.stringify([...a])) differs += 1;
  }
  assert.ok(differs > 30, "a new Home-life nonce re-randomizes");
});

await check("N2 density over 3000 cycles: ≤1 flop-sleep, no duplicate prop-heavy, distinct phase buckets; weights hold", () => {
  const ids = ["a1", "b2", "c3", "d4"];
  const counts = {};
  for (let i = 0; i < 3000; i += 1) {
    const x = [...M.assignHomeAmbient(ids, `cycle-${i}`).values()];
    assert.ok(x.filter((v) => v.state === "flop-sleep").length <= 1);
    for (const s of ["watching", "listen", "drink"]) assert.ok(x.filter((v) => v.state === s).length <= 1, s);
    const buckets = x.map((v) => v.phaseS / M.AMBIENT_CYCLE_S[v.state]);
    assert.equal(new Set(buckets.map((b) => b.toFixed(9))).size, 4, "staggered phases");
  }
  for (let i = 0; i < 20000; i += 1) {
    const st = M.assignHomeAmbient([`solo${i}`], "w").get(`solo${i}`).state;
    counts[st] = (counts[st] || 0) + 1;
  }
  for (const [s, w] of Object.entries(M.AMBIENT_WEIGHTS)) {
    assert.ok(Math.abs(counts[s] / 20000 - w / 100) < 0.02, `${s} ${counts[s]}`);
  }
});

await check("N3 runtime priority: WORK → AWAY/RETURN → ambient → idle; only the affected Piggy changes", () => {
  const ambient = new Map([["h", { state: "drink" }], ["m", { state: "listen" }], ["b", { state: "watching" }]]);
  const runtime = new Map([["m", "away"], ["b", "return"]]);
  const map = M.buildPiggyMotionStateMap([{ id: "h" }, { id: "m" }, { id: "b" }, { id: "x" }], { affectedPiggyId: "h", cue: "work", runtime, ambient });
  assert.equal(map.get("h").state, "work");
  assert.equal(map.get("m").state, "away");
  assert.equal(map.get("b").state, "return");
  assert.equal(map.get("x").state, "idle");
  const calm = M.buildPiggyMotionStateMap([{ id: "h" }, { id: "m" }], { ambient });
  assert.equal(calm.get("h").state, "drink");
  assert.equal(calm.get("m").state, "listen");
});

// Anchors measured by the A-654 geometry lane (HISTORY closed paper, 4 Piggies).
const R = (x, y, r, b) => M.rect(x, y, r, b);
// [A-681 OWNER VISUAL DECISION — MOBILE MULTI-PIGGY HOME, 2026-10-03] `mobileVisibleCap`
// (default 2, matching Home's own default in main.js planHomeAmbient()) threaded through so
// action-scene cases below can pass 0.
function planAt(vw, vh, seat, chog, brand, histRight, mobileVisibleCap = 2) {
  const pw = 256.338;
  const px = vw / 2 - 32 - pw / 2;
  const py = vh / 2 - 48 - 182;
  const mobile = vw <= 640;
  const foot = mobile ? R(px, py, histRight, py + 467.8) : R(px - 46, py, px - 46 + 536.676, py + 456.9);
  const safe = mobile ? R(16, 14, vw - 16, vh - 20) : R(16, 16, vw - 16, vh - 16);
  return M.planHomeSlots({ width: vw, seat, chog, foot, paper: R(px, py, px + pw, py + 364), brand, safe, mobileVisibleCap });
}
// [A-659 OWNER CORRECTION — 1440 WEB VERTICAL CANON, 2026-10-01] 390/430's seat/chog anchors
// below are the OLD (pre-correction) measured rects, dy-shifted by exactly the same amount the
// 1440-canon correction moves the mobile cluster (coordinator's real-browser re-measurement:
// 390 foot 802.15→703.69 i.e. dy=-98.46; 430 foot 858.15(@vh900)→750.38 i.e. dy=-107.77 — both
// pure vertical translates, so x/width/height are byte-identical to the pre-correction rects,
// only y/b shift). See main.js computeHomeFootTargetViewportY()/HOME_FOOT_NORMALIZED_RATIO for
// the formula these numbers come from.
// [A-681 OWNER VISUAL DECISION — MOBILE MULTI-PIGGY HOME, 2026-10-03, supersedes the earlier
// "max 2 visible total" OWNER CLARIFICATION 2026-10-02 reading] Home (mobileVisibleCap=2, the
// default) now shows M0 (main seat, full size, unchanged) PLUS up to two small companions
// (M1≈0.425×, M2≈0.375× of the seat) near the lower-left floor line — 390/430 = M0+M1+M2 (3
// slots, not the earlier 2). Action scenes pass mobileVisibleCap=0 from main.js
// (placeHomeAmbientResidents()) and get M0 only. mid/web bands are untouched (unaffected by
// this card, still 641+/1200+ as before; `mobileVisibleCap` is only read inside
// planHomeSlots()'s own `band === "mobile"` branch).
await check("N4 [A-681 re-pin] measured slot formulas: 390/430 = M0+M1+M2 (main + 2 small companions, mobileVisibleCap=2/Home default), 700/900 = SEAT+WN1..3 (4, unchanged), 1200 = 6 (unchanged), 1440 = W1 W2 WA1 WA2 (4, unchanged)", () => {
  const cases = [
    [390, 844, R(290.3, 622.49, 368.3, 715.09), R(222.4, 642.19, 286.3, 708.59), R(20, 14, 65.5, 25), 370, ["M0", "M1", "M2"]],
    [430, 900, R(323.5, 669.18, 401.5, 761.78), R(255.5, 688.88, 319.5, 755.28), R(24, 14, 69.5, 25), 406, ["M0", "M1", "M2"]],
    [700, 900, R(538.5, 508.9, 622.0, 608.3), R(465.6, 530.1, 534.2, 601.3), R(140, 32, 190.2, 44), 0, ["SEAT", "WN1", "WN2", "WN3"]],
    [900, 900, R(692.3, 525.8, 799.8, 653.5), R(598.7, 553.0, 686.8, 644.5), R(140, 32, 190.2, 44), 0, ["SEAT", "WN1", "WN2", "WN3"]],
    [1200, 900, R(923.0, 551.0, 1066.4, 721.3), R(798.3, 587.3, 915.8, 709.3), R(140, 32, 190.2, 44), 0, ["W1", "W2", "W3", "W4", "WA1", "WA2"]],
    [1440, 900, R(1107.7, 571.2, 1279.6, 775.6), R(957.9, 614.7, 1098.9, 761.2), R(140, 32, 190.2, 44), 0, ["W1", "W2", "WA1", "WA2"]],
  ];
  const HOME_EXTRA_A_SCALE = 0.425, HOME_EXTRA_B_SCALE = 0.375;
  for (const [vw, vh, seat, chog, brand, hr, want] of cases) {
    const p = planAt(vw, vh, seat, chog, brand, hr);
    assert.deepEqual(p.slots.map((s) => s.name), want, `${vw}: ${JSON.stringify(p.rejected.map((r) => [r.name, r.why]))}`);
    for (const s of p.slots) {
      // [A-681] M1/M2 (Home's small companions) are DELIBERATELY smaller than the seat — every
      // other slot (M0, and every mid/web name) still keeps the pre-existing "approved scale, no
      // shrink" contract exactly.
      const expectScale = s.name === "M1" ? HOME_EXTRA_A_SCALE : s.name === "M2" ? HOME_EXTRA_B_SCALE : 1;
      const sw = s.rect.r - s.rect.x, sh = s.rect.b - s.rect.y;
      if (expectScale === 1) {
        assert.ok(sw === seat.w && sh === seat.h, `${vw} ${s.name} keeps the approved size (no shrink)`);
      } else {
        assert.ok(Math.abs(sw / seat.w - expectScale) < 0.01, `${vw} ${s.name} width ratio ${sw / seat.w} vs expected ${expectScale}`);
        assert.ok(Math.abs(sh / seat.h - expectScale) < 0.01, `${vw} ${s.name} height ratio ${sh / seat.h} vs expected ${expectScale}`);
      }
      assert.ok(s.rect.x >= 16 - 0.01 && s.rect.r <= vw - 16 + 0.01, `${vw} ${s.name} inside safe x`);
    }
    for (let i = 0; i < p.slots.length; i += 1) for (let j = i + 1; j < p.slots.length; j += 1) {
      assert.equal(M.rectsTouch(p.slots[i].rect, p.slots[j].rect, 0), false, `${vw} ${p.slots[i].name}/${p.slots[j].name} overlap`);
    }
  }
  const wa = planAt(1440, 900, R(1107.7, 571.2, 1279.6, 775.6), R(957.9, 614.7, 1098.9, 761.2), R(140, 32, 190.2, 44), 0).slots;
  const byName = Object.fromEntries(wa.map((s) => [s.name, s.rect]));
  assert.ok(Math.abs(byName.WA1.x - 317.9) < 0.2 && Math.abs(byName.WA1.y - 571.2) < 0.2, "WA1 = measured [317.9,571.2,…]");
  assert.ok(Math.abs(byName.WA2.x - 317.9) < 0.2 && Math.abs(byName.WA2.y - 220) < 0.2, "WA2 = measured [317.9,220,…]");
});

// [A-681 re-pin — supersedes the old N4b] The old N4b asserted the ≤2-total "M2/M3/M4 absent"
// contract. The Owner's 2026-10-03 visual decision supersedes that reading; M1/M2 are now the
// REAL companion cluster (not dropped), so N4b now checks: (a) Home (cap=2) places both M1 and
// M2, close together, near the lower-left floor line, correctly sized; (b) action scenes
// (cap=0) show M0 only — the companion cluster never carries into them; (c) a resident beyond
// the 2-companion cap at any cap level still falls back to the existing "card-only" path (no new
// fallback code — this is a planHomeSlots()-level guarantee already covered by N4's own `want`
// list never exceeding 3 at mobile, not re-tested here).
await check("N4b [A-681 OWNER VISUAL DECISION — MOBILE MULTI-PIGGY HOME, 2026-10-03] Home's two small companions sit close together near the lower-left floor line with the Owner-recommended size split; action scenes (mobileVisibleCap=0) show only the main seat", () => {
  for (const [vw, vh, seat, chog, brand, hr] of [
    [390, 844, R(290.3, 622.49, 368.3, 715.09), R(222.4, 642.19, 286.3, 708.59), R(20, 14, 65.5, 25), 370],
    [430, 900, R(323.5, 669.18, 401.5, 761.78), R(255.5, 688.88, 319.5, 755.28), R(24, 14, 69.5, 25), 406],
  ]) {
    const pHome = planAt(vw, vh, seat, chog, brand, hr, 2);
    const byName = Object.fromEntries(pHome.slots.map((s) => [s.name, s.rect]));
    assert.ok(byName.M1 && byName.M2, `${vw}: Home places both companions (${JSON.stringify(pHome.rejected)})`);
    // Close together, not scattered: the gap between M1's right edge and M2's left edge is the
    // existing mobile slot gap (12px) — not spread to opposite ends of `safe` like the old M1/M2.
    assert.ok(Math.abs(byName.M2.x - byName.M1.r) < 13, `${vw}: M1/M2 sit close together (gap ${byName.M2.x - byName.M1.r})`);
    // Near the lower-left floor line: both companions' LEFT edge is the safe-area left edge
    // (viewer-left), and both bottoms land within one companion-height of the main pair's own
    // floor line (seat.b/chog.b) — not scattered to the top or opposite corner.
    assert.ok(Math.abs(byName.M1.x - 16) < 0.5, `${vw}: M1 anchored at the left safe edge`);
    const floorY = Math.max(seat.b, chog.b);
    assert.ok(floorY - byName.M1.b < (byName.M1.b - byName.M1.y) && byName.M1.b <= floorY + 0.5, `${vw}: M1 sits on the main pair's own floor line`);
    // Slight vertical variation (organic, not identical/aligned copies).
    assert.ok(byName.M1.b !== byName.M2.b, `${vw}: M1/M2 have slight vertical variation, not perfectly aligned`);
    // Action scenes: only the active Piggy, no companion cluster at all.
    const pAction = planAt(vw, vh, seat, chog, brand, hr, 0);
    assert.deepEqual(pAction.slots.map((s) => s.name), ["M0"], `${vw}: action scenes show only the main seat`);
  }
});

await check("N5 visual-only: living-Home code calls no signer/permission/money/selection path and stores only the Home-life nonce", () => {
  const names = ["readHomeLife", "startHomeLife", "syncHomeLifeCycle", "homeResidentRuntimeStates", "homeAmbientAnchors", "planHomeAmbient", ...(MAIN.includes("function placeHomeAmbientSet(") ? ["placeHomeAmbientSet"] : []), "mountHomeAmbientResidents", "placeHomeAmbientResidents", "loadHomeAmbientAssets", "buildAmbientArt"];
  const body = names.map((n) => stripComments(fnBody(n))).join("\n");
  for (const re of [/requestPrf|activateSigningSession|requestMoneyPermission|sendTransaction|writeContract|signMessage|navigator\.credentials/, /localStorage\.setItem|saveRegistry|saveMyPiggiesIndex|rememberReceipt|settleSend|finishTrip/, /state\.(historyPiggyId|homePaperMode|addMoney|sendCardVisible)\s*=/, /controlModePiggyId\(|selectedHistoryPiggyId\(/]) {
    assert.equal(re.test(body), false, String(re));
  }
  assert.match(fnBody("startHomeLife"), /sessionStorage\.setItem\(HOME_LIFE_KEY/);
  assert.match(MAIN, /const HOME_LIFE_KEY = "araso\.homeLife\.v1";/);
  assert.match(fnBody("mountHomeAmbientResidents"), /indexedResidents\(\)\.length < 2\) return;/, "one Piggy → nothing runs");
});

await check("N5b F1: the ambient projection is decided over the FULL resident set; runtime Piggies are only dropped", () => {
  const plan = stripComments(fnBody("planHomeAmbient"));
  assert.match(plan, /placeHomeAmbientSet\(plan, anchors, everyone, sceneId, nonce\)/, "state/phase/density over all residents of the cycle");
  assert.match(plan, /full\.assignment\.get\(id\)/, "present Piggies take their full-cycle projection");
  assert.equal(/assignHomeAmbient\(/.test(plan), false, "no re-assignment over the present subset");
});

await check("N6 public motion assets: 19 confirmed SVGs present, well-formed, no internal paths/cards/provenance text", () => {
  const want = ["piggy_seat_idle", "piggy_seat_drink", "piggy_seat_drink-1", "piggy_seat_drink-2", "piggy_seat_listen", "piggy_seat_listen-1", "piggy_seat_phone", "piggy_seat_phone-1", "piggy_seat_phone-2", "piggy_seat_sunshine_tap2_owner", "piggy_watching_fit", "piggy_flop_zip5_squash", "piggy_flop_zip5_lean", "piggy_rolling", "rolling_right_owner", "lookdown_right_owner", "rolling_left_owner", "lookdown_left_owner", "piggy_seat_lookdownR_blanket"];
  const have = readdirSync(ASSET_DIR).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)).sort();
  assert.deepEqual(have, [...want].sort());
  for (const f of want) {
    const t = readFileSync(path.join(ASSET_DIR, `${f}.svg`), "utf8");
    assert.ok(t.startsWith("<svg") && t.trimEnd().endsWith("</svg>"), `${f} well-formed`);
    assert.equal(/_private|do not publish|generated_by|\/Users\/|\bA-[56]\d\d\b|로컬 사본|receipts\//i.test(t.replace(/<c2pa:manifest>[^<]*<\/c2pa:manifest>/, "")), false, `${f} hygiene`);
    assert.ok(MAIN.includes(`"${f}.svg"`), `${f} is used by the renderer`);
  }
});

// ═══ Part B ════════════════════════════════════════════════════════════════════════════════════
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIDTHS = [[390, 844], [430, 900], [700, 900], [900, 900], [1200, 900], [1440, 900]];
// [A-681 OWNER VISUAL DECISION — MOBILE MULTI-PIGGY HOME · 2026-10-03, supersedes the earlier
// OWNER CLARIFICATION 2026-10-02 "max 2 visible total" reading] Part B's own addPiggy()/living()
// flow runs against the Home (sendstay) scene, so its capacity is `mobileVisibleCap=2` (the
// default) — 390/430 re-pinned to 3 (M0 main seat + M1/M2, the two small lower-left companions),
// not 2. Logical/indexed Piggy count is NOT capped (`indexedResidents()`, main.js, a separate
// data path never touched by planHomeSlots()) — residents beyond the visible cap fall back to
// the existing "card-only"/list/HISTORY representation, which B3's own `g.layer.off` assertion
// below already covers. 700/900/1200/1440 unchanged (Δ0).
const CAP = { 390: 3, 430: 3, 700: 4, 900: 4, 1200: 6, 1440: 4 };
// Pre-A-654 one-Piggy Home (measured on the pre tree, same harness): seat and name rects.
// [A-656 decision 2, 2026-09-30] 700's reference is intentionally superseded: the mid-band
// (641≤vw<1200) vertical-anchor repair moves the settled cluster down by +154.36px (translate
// only, k=1) to match the 1440 foot fraction — this is the card's own fix, not a regression (see
// A-656 P12 §P2/sim_midband.diff, and the VERIFY receipt at
// _private/ops/receipts/A656_return_home_anchor/). 390/430/1440 are untouched (mobile floor and
// the 1440 web reference are both out of mid-band's scope). Re-measured on the POST-A-656 tree,
// same harness, same real WebAuthn birth flow.
const PRE_ONE = {
  390: { seat: [290.31, 720.75, 368.31, 802.15], name: [298.04, 805.12, 360.44, 813.44] },
  430: { seat: [323.46, 776.75, 401.46, 858.15], name: [331.19, 861.12, 393.59, 869.44] },
  700: { seat: [538.45, 663.30, 622.04, 750.54], name: [546.74, 753.72, 613.61, 762.64] },
  1440: { seat: [1107.66, 571.24, 1279.63, 750.7], name: [1124.71, 757.26, 1262.29, 775.61] },
};
const INIT = `(() => { const w = window.__wa = { create: 0, get: 0 }; const c = navigator.credentials;
  if (c) { const oc = c.create.bind(c), og = c.get.bind(c); c.create = (o) => { w.create++; return oc(o); }; c.get = (o) => { w.get++; return og(o); }; } })();`;

if (process.env.A654_NODE_ONLY === "1") {
  console.log("SKIP  Part B (A654_NODE_ONLY=1) — browser scenarios not run");
} else {
  await runBrowser();
}

async function runBrowser() {
  if (!existsSync(path.join(REPO, "_private"))) {
    console.log("SKIP  Part B — local browser harness absent (public checkout); browser scenarios not run");
    return;
  }
  let chromium;
  try {
    const req = createRequire(path.join(REPO, "_private/ops/harness/package.json"));
    ({ chromium } = req("playwright"));
  } catch (e) {
    await check("B0 playwright available (local harness)", () => { throw e; });
    return;
  }
  let server = null;
  let BASE = process.env.A654_BASE_URL || "";
  if (!BASE) {
    server = spawn("npx", ["vite", "app", "--mode", "a172-local", "--port", "5669", "--host", "127.0.0.1", "--strictPort"], {
      cwd: REPO, env: { ...process.env, VITE_ARASO_LOCAL_DEV_ENTRY: "1", VITE_ARASO_LOCAL_DEV_RP_ID: "localhost" }, stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("vite start timeout")), 20000);
      server.stdout.on("data", (d) => { if (/ready in/.test(String(d))) { clearTimeout(t); resolve(); } });
      server.on("exit", (c) => { clearTimeout(t); reject(new Error(`vite exited ${c}`)); });
    });
    BASE = "http://localhost:5669/";
  }
  const shots = process.env.A654_SHOTS || "";
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await browserRun(browser, BASE, shots);
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

async function browserRun(browser, BASE, shots) {
  const net = { tx: 0 };
  const assetBad = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(INIT);
  await context.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const body = req.postData() || "";
    if (/eth_sendRawTransaction|eth_sendTransaction|eth_sendUserOperation/.test(body)) { net.tx += 1; return route.abort(); }
    if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && req.method() === "POST" && /grant/i.test(u.pathname)) { net.tx += 1; return route.abort(); }
    return route.continue();
  });
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String((e && e.message) || e).slice(0, 200)));
  p.on("response", async (r) => {
    const u = r.url();
    if (!/\/motion\//.test(u)) return;
    const ct = r.headers()["content-type"] || "";
    if (r.status() >= 400 || (/\.svg$/.test(u) && !/svg/.test(ct))) assetBad.push(`${r.status()} ${ct} ${u}`);
  });
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });

  const shot = async (name) => { if (shots) await p.screenshot({ path: path.join(shots, `a654_${name}.png`) }); };
  const scene = () => p.evaluate(() => { const s = document.querySelector("[data-scene]"); const v = s?.dataset.scene ?? null; return v === "return" && s.querySelector(".secondJourney__mockTag") ? "secondReturn" : v; });
  const waitScene = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await scene().catch(() => null); if (want.includes(s)) return s; await sleep(100); } return `TIMEOUT:${await scene().catch(() => null)}`; };
  const pointAt = (sel, idx = 0) => p.evaluate(([s, i]) => {
    const el = document.querySelectorAll(s)[i]; if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width) return null;
    for (let dy = 0; dy < b.height / 2; dy += 2) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) {
      const x = b.left + b.width / 2 + sx * dx; const y = b.top + b.height / 2 + sy * dy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y };
    }
    return null;
  }, [sel, idx]);
  const realClick = async (sel, idx = 0) => { const r = await pointAt(sel, idx); if (!r) return "unreachable"; await p.mouse.click(r.x, r.y); return "pointer"; };
  const mustTap = async (sel, label, idx = 0) => { for (let i = 0; i < 6; i += 1) { if ((await realClick(sel, idx)) === "pointer") return; await sleep(600); } throw new Error(`${label}: ${sel} not pointer-reachable`); };
  const paperOpen = () => p.evaluate(() => { const r = document.querySelector("#homePaper")?.getBoundingClientRect(); return !!r && r.width > 100; });
  const openHomePaper = async () => { for (let i = 0; i < 5; i += 1) { if (await paperOpen()) return true; if (!(await p.locator("#chogHomeHit").count())) return false; await p.locator("#chogHomeHit").click({ force: true }); await sleep(1600); } return paperOpen(); };
  const recOpen = () => p.evaluate(() => { const a = document.querySelector("#recordsCardAnchor"); return !!a && !a.hidden && a.getBoundingClientRect().width > 1; });
  const closeRecords = async () => { if (!(await recOpen())) return; await mustTap("#recordsCardClose", "HISTORY close"); await sleep(1000); };
  const unlockIfLocked = async () => { for (let i = 0; i < 4; i += 1) { if (!(await p.locator("#loginChogButton").count())) return; await p.locator("#loginChogButton").click(); await sleep(2500); } };
  const atWidth = async (w, h) => { await p.setViewportSize({ width: w, height: h }); await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked(); await waitScene(["sendstay"], 9000); await sleep(4000); };
  const living = () => p.evaluate(() => {
    const L = document.querySelector(".homeLivingLayer");
    const box = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
    const hit = document.querySelector("#chogHomeHit");
    return {
      layer: L ? { cap: Number(L.dataset.capacity), off: Number(L.dataset.offstage), band: L.dataset.band } : null,
      res: [...document.querySelectorAll(".homeLiving")].map((e) => ({ id: e.dataset.piggyId, slot: e.dataset.slot, st: e.dataset.motionState, ph: e.dataset.phase, seat: e.dataset.seat === "1", shown: e.style.visibility !== "hidden", r: box(e) })),
      seatHidden: document.querySelector("#homeChar")?.dataset.ambientSeat === "1",
      seat: document.querySelector("#homeSeat") ? box(document.querySelector("#homeSeat")) : null,
      name: document.querySelector("#homeName") ? box(document.querySelector("#homeName")) : null,
      chog: hit ? box(hit) : null,
      nonce: JSON.parse(sessionStorage.getItem("araso.homeLife.v1") || "null")?.nonce || null,
      sw: document.documentElement.scrollWidth, iw: innerWidth,
    };
  });
  const sig = (g) => g.res.map((r) => `${r.id}@${r.slot}:${r.st}`).sort().join("|");
  const touch = (a, b) => a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5;
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.6);
  const counters = async () => ({ wa: await p.evaluate(() => ({ ...window.__wa })), tx: net.tx });

  const addPiggy = async (name) => {
    await closeRecords();
    await atWidth(1440, 900);
    await openHomePaper(); await sleep(800);
    const idx = await p.evaluate(() => [...document.querySelectorAll(".homePlusPiggyTab")].findIndex((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0));
    assert.ok(idx >= 0, "+Piggy visible");
    await mustTap(".homePlusPiggyTab", "+Piggy", idx);
    assert.equal(await waitScene(["name"], 15000), "name"); await sleep(1200);
    for (let t0 = Date.now(); Date.now() - t0 < 20000;) { const v = await p.evaluate(() => !!document.querySelector("#piggyNameInput") && document.querySelector("#piggyNameInput").getBoundingClientRect().width > 0); if (v) break; if (await p.locator(".nameCard__okBtn").count()) await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(700); }
    await p.locator("#piggyNameInput").fill(name); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    assert.equal(await waitScene(["sendstay"], 8000), "sendstay"); await sleep(4000);
  };

  try {
    // ── birth + closed First + confirmed Second (same harness as A-644/A-646 Part B) ──────────
    await p.goto(BASE, { waitUntil: "networkidle" });
    for (let a = 0; a < 4; a += 1) {
      if (await p.locator("#inviteFaceButton").count()) await p.locator("#inviteFaceButton").click().catch(() => {});
      await p.waitForFunction(() => ["hatch", "name"].includes(document.querySelector("[data-scene]")?.dataset.scene) || document.querySelector("#authTryAgainButton"), { timeout: 25000 }).catch(() => {});
      if (["hatch", "name"].includes(await scene())) break;
      await p.locator("#authTryAgainButton").click().catch(() => {}); await sleep(800);
    }
    for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
      const v = await p.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden && getComputedStyle(e).visibility !== "hidden"; }; return { input: vis("#piggyNameInput"), ok: vis(".nameCard__okBtn") }; });
      if (v.input) break;
      if (v.ok) { await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(900); continue; }
      await sleep(300);
    }
    await p.locator("#piggyNameInput").fill("Honeybun"); await sleep(150);
    await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
    await waitScene(["sendstay"], 10000); await sleep(4500);
    if (await p.locator("#stayButton").count()) { await p.evaluate(() => document.querySelector("#stayButton")?.click()); await sleep(700); }
    await p.evaluate(() => {
      const a = localStorage.getItem("araso.address");
      const rec = { before: "1000000000000000000", after: "900000000000000000", gas: "21000", sent: "100000000000000000", txHash: "0x" + "a654f1f5eed".padEnd(64, "0") + "1", depositTxHash: "0xa654-dep", redeemTxHash: "0xa654-red", grantTxHash: "0xa654-grant", status: "success", at: Date.parse("2026-09-29T00:00:00Z"), piggyId: `legacy-${String(a).toLowerCase()}` };
      localStorage.setItem("araso.receipts", JSON.stringify([rec])); localStorage.setItem("araso.txHash", rec.txHash); localStorage.setItem("araso.tripClosed", "1");
    });
    await p.reload({ waitUntil: "networkidle" }); await sleep(600);
    await unlockIfLocked();
    await waitScene(["explore"], 9000);
    await realClick("#stayButton"); await waitScene(["sendstay"], 4000); await sleep(3000);
    await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true })); await sleep(1900);
    const step = () => p.evaluate(() => document.querySelector("#exploreForm") ? "interests" : document.querySelector(".secondJourney__jitBtn") ? "jit" : document.querySelector("#secondSendButton") ? "readiness" : document.querySelector(".secondJourney__pick") ? "candidates" : null);
    let st = await step();
    if (st === "interests") { await realClick(".secondJourney__item", 0); await sleep(250); await realClick("#exploreSaveButton"); await sleep(2400); st = await step(); }
    if (st === "candidates") {
      const first = await p.evaluate(() => [...document.querySelectorAll(".secondJourney__pick")].find((b) => !b.disabled && !b.hidden)?.dataset.destinationId);
      await realClick(`.secondJourney__pick[data-destination-id="${first}"]`); await sleep(400);
      await realClick("#secondOkButton"); await sleep(900);
      if ((await step()) === "jit") { await realClick(".secondJourney__jitBtn", 0); await sleep(900); }
    }
    if (await p.locator("#secondAmount").count()) { await p.locator("#secondAmount").fill("1"); await sleep(400); }
    await mustTap("#secondSendButton", "second send");
    await waitScene(["secondAway"], 4000);
    await waitScene(["secondReturn"], 45000);
    for (let t0 = Date.now(); Date.now() - t0 < 60000;) {
      if ((await scene()) !== "secondReturn") break;
      const v = await p.evaluate(() => { const ok = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; }; return { open: ok("returnOpen"), tap: ok("returnTap") }; });
      if (v.open) { if ((await realClick("#returnOpen")) !== "pointer") await p.evaluate(() => document.getElementById("returnOpen").click()); await sleep(900); continue; }
      if (v.tap) { if ((await realClick("#returnTap")) !== "pointer") await p.evaluate(() => document.getElementById("returnTap").click()); await sleep(1200); continue; }
      await sleep(250);
    }
    await sleep(4500);

    // ── 1 Piggy: Home exactly as before ────────────────────────────────────────────────────────
    // [A-659 OWNER CORRECTION — 1440 WEB VERTICAL CANON, 2026-10-01 — re-pin AGAIN, round 2] this
    // used to split into a 390/430 loop pinned to the EXACT pre-A-654 rects ("≤640 untouched by
    // A-659") and a separate 700/1440 loop. That split is now WRONG: the Owner's latest correction
    // extends the SAME 1440-canon-derived proportional target to the narrow/mobile scale-floor
    // branch too (main.js computeHomeFootTargetViewportY(), used by BOTH branches now — see its
    // own header comment) — coordinator's real-browser recapture confirmed 390's foot actually
    // moved 802.15→≈703.8 and 430's 858.15(@vh900)→≈750.4, exactly matching this formula, and
    // caught the previous fixed pins as a real FAIL, not just a stale pin. 1440×900's CURRENT
    // settled foot is still canon (PRE_ONE[1440] IS that canon — measured on the POST-A-656 tree,
    // before either repair pass touched it) and 700/1440 were BOTH already at this ratio under the
    // original (pre-any-repair) A-656 rule (PRE_ONE 700→750.54, 1440→750.7, both ≈0.834·900) — Δ0
    // at both. 390/430 move UP (bigger bottom gap) since their old target was a fixed ~42px gap,
    // now superseded by the SAME proportional ratio. Since the seat/name are translated together
    // as one group (applyHomeCharacterScaleFloor() wraps `#homeChar`, which contains both
    // `#homeSeat` and `#homeName`), a pure Y-translate preserves their RELATIVE offset exactly even
    // when dy≠0 — this asserts (a) the seat's own foot lands at the derived target within a loose
    // ±2px real-browser-noise tolerance, (b) seat x-bounds and width/height are byte-unchanged
    // (translate-only, dx=0, never a rescale), and (c) the name keeps EXACTLY the old relative
    // offset under the seat (gap + its own width/height) — for ALL FOUR widths alike now.
    const HOME_BOARD_W = 1256, HOME_BOARD_H = 772, HOME_FLOOR = 648;
    const HOME_FOOT_REF_S = Math.min(1440 / HOME_BOARD_W, 900 / HOME_BOARD_H);
    const HOME_FOOT_REF_TOP = (900 - HOME_BOARD_H * HOME_FOOT_REF_S) / 2;
    const HOME_FOOT_NORMALIZED_RATIO = (HOME_FOOT_REF_TOP + HOME_FLOOR * HOME_FOOT_REF_S) / 900;
    const WEB_FOOT_TARGET = (vh) => Math.min(HOME_FOOT_NORMALIZED_RATIO * vh, vh - 42);
    // [A-681 OWNER DIRECTION (coordinator chat, 2026-10-03), item 3: "the current Home bottom
    // breathing room (~128px@390, ~137px@430) is too large — derive an iPhone-safe bottom target
    // from actual safe-area/viewport geometry; supersedes the earlier 'preserve current bottom
    // breathing room' note"] 390/430 ONLY: the mobile floor branch now targets
    // `computeHomeFootTargetViewportY()`'s own mobile-only max() branch (vh - bottomSafeMinPx,
    // bottomSafeMinPx = --mobile-bottom-safe(20, env(safe-area-inset-bottom)=0 in this Chromium
    // harness) + HOME_CHAR_BOTTOM_ANCHOR_GAP_PX(22) = 42), MINUS the A-681 ink-overhang
    // correction (`homeCharFloorInkOverhangCorrectionPx()`, main.js): the floor-wrapped
    // character's drawn ink extends a measured-constant 12.48px below the anchor point at the
    // UN-boosted floor scale (exact at both 390/430 — `s·k_raw` is always exactly
    // HOME_CHAR_SCALE_FLOOR once the floor is active), and that overhang itself grows by the
    // same HOME_CHAR_MOBILE_GROUP_BOOST(1.5) the rest of the character group does, so it is
    // subtracted from the anchor target to land the REAL ink-bottom at the planned ~42px gap.
    // 700/1440 keep the original `WEB_FOOT_TARGET` (1440-canon ratio) formula, byte-identical,
    // Δ0 — this card's mobile-only changes are explicitly gated `window.innerWidth<=640` in
    // main.js and do not touch the >640 branch at all.
    const MOBILE_BOTTOM_SAFE_MIN_PX = 20 + 22; // --mobile-bottom-safe + HOME_CHAR_BOTTOM_ANCHOR_GAP_PX
    const HOME_CHAR_MOBILE_GROUP_BOOST = 1.5;
    const HOME_CHAR_FLOOR_INK_OVERHANG_PX = 12.48;
    const MOBILE_FOOT_TARGET = (vh) => vh - MOBILE_BOTTOM_SAFE_MIN_PX - HOME_CHAR_FLOOR_INK_OVERHANG_PX * HOME_CHAR_MOBILE_GROUP_BOOST;
    for (const [w, h] of [[390, 844], [430, 900], [700, 900], [1440, 900]]) {
      await check(`B1 [${w}] one Piggy: no living layer, seat visible, seat foot follows the iPhone-safe mobile bottom anchor at 390/430 (A-681, Owner direction 2026-10-03) and the 1440-canon normalized ratio unchanged at 700/1440 (Δ0), name stays directly under the seat with no overlap`, async () => {
        await atWidth(w, h);
        const g = await living();
        assert.equal(g.layer, null); assert.equal(g.res.length, 0); assert.equal(g.seatHidden, false);
        const old = PRE_ONE[w];
        const target = w <= 640 ? MOBILE_FOOT_TARGET(h) : WEB_FOOT_TARGET(h);
        assert.ok(Math.abs(g.seat[3] - target) < 2, `seat foot ${g.seat[3]} vs target ${target}`);
        const dy = g.seat[3] - old.seat[3];
        // [A-681 OWNER VISUAL DECISION — MOBILE MULTI-PIGGY HOME, 2026-10-03 / OWNER DIRECTION
        // (coordinator chat) 2026-10-03 item 1, "enlarge the whole Chog+Piggy group"] 390/430
        // ONLY: the seat is no longer a pure translate of the pre-A-681 reference shape — it is
        // ALSO scaled by HOME_CHAR_MOBILE_GROUP_BOOST (1.5×, main.js homeCharMobileBoost()),
        // uniformly about the foot pivot (HOME_CENTER horizontally — which the solo final run
        // confirms stays centered on the reference's own horizontal center, since HOME_CENTER
        // already sits ~0px from the seat's own center; HOME_FLOOR vertically, already covered by
        // this check's own `target` assertion above). Expected shape = reference shape × boost:
        // width/height scale by exactly 1.5×, horizontal center is unchanged (not a left/right
        // drift), bottom edge is the already-asserted `target`. 700/1440 keep the original
        // byte-identical pure-translate assertion (boost is an exact no-op there,
        // homeCharMobileBoost() returns 1 for width>640).
        if (w <= 640) {
          const oldW = old.seat[2] - old.seat[0], oldH = old.seat[3] - old.seat[1];
          const gw = g.seat[2] - g.seat[0], gh = g.seat[3] - g.seat[1];
          assert.ok(Math.abs(gw - oldW * HOME_CHAR_MOBILE_GROUP_BOOST) < 2, `seat width ${gw} vs reference×boost ${oldW * HOME_CHAR_MOBILE_GROUP_BOOST}`);
          assert.ok(Math.abs(gh - oldH * HOME_CHAR_MOBILE_GROUP_BOOST) < 2, `seat height ${gh} vs reference×boost ${oldH * HOME_CHAR_MOBILE_GROUP_BOOST}`);
          // [A-681 FINAL CLOSEOUT B re-pin — RIGHT SAFE RAIL, named reason] the old "center unchanged vs the
          // pre-A-681 reference" assertion (±2) is REPLACED, not weakened: the Owner's right-safe-rail
          // decision shifts the whole Piggy+Chog group left (main.js homeFloorNudgeViewportX: -17.8px @390,
          // -15.0px @430) so the rightmost character leaf (the seat box) lands on the rail. New invariant:
          // seat right edge == vw - --mobile-inset (20 @<=400, 24 above) within 1px; width/height/foot
          // rules above are unchanged. 700/1440 keep the original pure-translate check below.
          const inset = w <= 400 ? 20 : 24;
          assert.ok(Math.abs(g.seat[2] - (w - inset)) <= 1, `seat right edge ${g.seat[2]} vs rail ${w - inset} (vw - --mobile-inset)`);
        } else {
          assert.ok(near([old.seat[0], old.seat[1] + dy, old.seat[2], old.seat[3] + dy], g.seat), `seat translate-only shape drifted ${g.seat}`);
        }
        // [A-666 re-pin, named reason] Owner's global mobile type-scale decision
        // (TYPOGRAPHY_SCALE.md) raised `.homeChar__name` (#homeName) 13px → 15px at
        // ≤640px only — this element's own rendered width/height and exact gap-under-seat
        // are therefore EXPECTED to shift at 390/430 (never at 700/1440, where that ≤640
        // rule does not apply — those two widths keep the original byte-exact check
        // below). What still must hold at every width either way: the name sits directly
        // under the seat (small positive gap) with zero overlap — a geometry invariant,
        // not a byte-identical box.
        if (w <= 640) {
          const gap = g.name[1] - g.seat[3];
          assert.ok(gap > 0 && gap < 12, `name must sit just under the seat with a small positive gap, got ${gap}`);
          assert.equal(touch(g.name, g.seat), false, "name must not overlap the seat");
        } else {
          const oldGap = old.name[1] - old.seat[3];
          const newGap = g.name[1] - g.seat[3];
          assert.ok(Math.abs(newGap - oldGap) < 0.6, `name→seat relative offset drifted: old ${oldGap} new ${newGap}`);
          assert.ok(Math.abs((old.name[2] - old.name[0]) - (g.name[2] - g.name[0])) < 0.6, "name width unchanged");
          assert.ok(Math.abs((old.name[3] - old.name[1]) - (g.name[3] - g.name[1])) < 0.6, "name height unchanged");
        }
        assert.ok(g.sw <= g.iw);
        await shot(`n1_w${w}`);
      });
    }

    // ── 2 / 3 / 4 Piggies at every width ────────────────────────────────────────────────────
    const names = ["Mochi", "Bebe", "Dumpling"];
    for (let n = 2; n <= 4; n += 1) {
      await check(`B2 +Piggy (${names[n - 2]}) → Home: the new Piggy appears on Home (${n} Piggies)`, async () => {
        await addPiggy(names[n - 2]);
        const g = await living();
        assert.ok(g.layer, "layer mounted");
        assert.equal(g.res.length, Math.min(n, g.layer.cap));
      });
      for (const [w, h] of WIDTHS) {
        await check(`B3 [${w}] ${n} Piggies: distinct measured slots, capacity ${CAP[w]}, no overlap with each other/Chog, drawn, overflow 0`, async () => {
          await atWidth(w, h);
          const g = await living();
          assert.ok(g.layer);
          assert.equal(g.layer.cap, CAP[w], `capacity ${g.layer.cap}`);
          assert.equal(g.res.length, Math.min(n, CAP[w]));
          assert.equal(g.layer.off, Math.max(0, n - CAP[w]), "residents beyond capacity stay off Home (never shrunk)");
          assert.equal(new Set(g.res.map((r) => r.slot)).size, g.res.length);
          assert.equal(new Set(g.res.map((r) => r.id)).size, g.res.length);
          if (w === 1440 && n === 4) assert.deepEqual(g.res.map((r) => r.slot).sort(), ["W1", "W2", "WA1", "WA2"]);
          for (const r of g.res) {
            assert.ok(r.shown, `${r.slot} drawn`);
            assert.ok(r.r[0] >= 0 && r.r[2] <= w && r.r[1] >= 0 && r.r[3] <= h, `${r.slot} inside viewport`);
            if (!r.seat) assert.equal(touch(r.r, g.chog), false, `${r.slot} clear of Chog`);
          }
          for (let i = 0; i < g.res.length; i += 1) for (let j = i + 1; j < g.res.length; j += 1) assert.equal(touch(g.res[i].r, g.res[j].r), false);
          const seatRes = g.res.find((r) => r.seat);
          assert.ok(seatRes && near(seatRes.r.slice(0, 2), [g.seat[0], g.seat[1]]), "seat Piggy keeps the established seat");
          assert.ok(g.sw <= g.iw, "horizontal overflow 0");
          await shot(`n${n}_w${w}`);
        });
      }
    }

    // ── stability, selection, HISTORY / MY MONEY, reload ─────────────────────────────────────
    await check("B4 [390/1440] HISTORY open/close, MY MONEY open/close, another Piggy's records: no reroll, no move, no overlap with Paper/HISTORY; WebAuthn/tx Δ0", async () => {
      for (const [w, h] of [[390, 844], [1440, 900]]) {
        await atWidth(w, h);
        const g0 = await living();
        const c0 = await counters();
        await openHomePaper(); await sleep(1200);
        const g1 = await living();
        assert.equal(sig(g1), sig(g0)); assert.equal(g1.nonce, g0.nonce);
        await mustTap(".homePaper__records", "records", 0); await sleep(1600);
        const g2 = await living();
        assert.equal(sig(g2), sig(g0), "HISTORY open → same slots/motions");
        const rects = await p.evaluate(() => ["#homePaper", "#recordsCardAnchor"].map((s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b && b.width > 1 ? [b.left, b.top, b.right, b.bottom] : null; }));
        for (const r of g2.res) for (const o of rects) if (o) assert.equal(touch(r.r, o), false, `${r.slot} vs paper/HISTORY ${o}`);
        await shot(`n4_w${w}_history_open`);
        await closeRecords();
        if (w > 640) {
          // Selection change: open another Piggy's HISTORY (first other records entry the pointer can reach).
          // (another Piggy's records when reachable, else a Piggy card → its detail = MY MONEY selection).
          let picked = false;
          const recCount = await p.locator(".homePaper__records").count();
          for (let i = 1; i < recCount && !picked; i += 1) if ((await realClick(".homePaper__records", i)) === "pointer") picked = true;
          if (!picked) {
            const cardCount = await p.locator(".homePaper__card--piggy").count();
            for (let i = cardCount - 1; i >= 0 && !picked; i -= 1) if ((await realClick(".homePaper__card--piggy", i)) === "pointer") picked = true;
          }
          assert.ok(picked, "a selection target is reachable");
          await sleep(1400);
          const gs = await living();
          assert.equal(sig(gs), sig(g0), "selection change → same slots/motions");
          await closeRecords();
          if (await p.locator("#homePiggyDetailBack").count()) { await realClick("#homePiggyDetailBack"); await sleep(900); }
        }
        if (await p.locator("#homePaperMoneyToggle").count()) { await mustTap("#homePaperMoneyToggle", "MY MONEY"); await sleep(1500); await mustTap("#homePaperMoneyToggle", "back"); await sleep(900); }
        const g3 = await living();
        assert.equal(sig(g3), sig(g0), "after HISTORY/MY MONEY/selection → no reroll");
        for (const r of g3.res) assert.ok(near(r.r, g0.res.find((x) => x.id === r.id).r), `${r.slot} did not move`);
        const c1 = await counters();
        assert.equal(c1.wa.get + c1.wa.create - c0.wa.get - c0.wa.create, 0, "WebAuthn Δ0");
        assert.equal(c1.tx - c0.tx, 0, "tx Δ0");
        await p.reload({ waitUntil: "networkidle" }); await sleep(600); await unlockIfLocked(); await waitScene(["sendstay"], 9000); await sleep(4000);
        const g4 = await living();
        assert.equal(g4.nonce, g0.nonce, "reload keeps the Home-life cycle");
        assert.equal(sig(g4), sig(g0), "reload → same slots/motions");
      }
    });

    await check("B5 [1440] motion evidence: residents animate between frames (not a still image)", async () => {
      await atWidth(1440, 900);
      const g = await living();
      let moved = 0;
      for (const r of g.res) {
        const clip = { x: Math.max(0, r.r[0] - 40), y: Math.max(0, r.r[1] - 40), width: r.r[2] - r.r[0] + 80, height: r.r[3] - r.r[1] + 60 };
        // Idle only blinks (eyes shut ≈190 ms once per 3.2 s), so watch a little longer than one
        // blink cycle and sample densely enough never to step over the shut window.
        const first = await p.screenshot({ clip });
        const until = Date.now() + 4200;
        while (Date.now() < until) { await sleep(40); if (!(await p.screenshot({ clip })).equals(first)) { moved += 1; break; } }
        if (shots) { await p.screenshot({ clip, path: path.join(shots, `a654_motion_${r.slot}_a.png`) }); await sleep(700); await p.screenshot({ clip, path: path.join(shots, `a654_motion_${r.slot}_b.png`) }); }
      }
      assert.equal(moved, g.res.length, `moving residents ${moved}/${g.res.length} ${g.res.map((r) => r.st)}`);
    });

    await check("B6 [390/1440] reduced motion: every resident is a stable still pose (identical frames)", async () => {
      await p.emulateMedia({ reducedMotion: "reduce" });
      for (const [w, h] of [[390, 844], [1440, 900]]) {
        await atWidth(w, h);
        const g = await living();
        assert.ok(g.res.length >= 2);
        for (const r of g.res) {
          const clip = { x: Math.max(0, r.r[0] - 30), y: Math.max(0, r.r[1] - 30), width: Math.min(w, r.r[2] + 30) - Math.max(0, r.r[0] - 30), height: Math.min(h, r.r[3] + 20) - Math.max(0, r.r[1] - 30) };
          const a = await p.screenshot({ clip }); await sleep(1600); const b = await p.screenshot({ clip });
          assert.ok(a.equals(b), `${r.slot} (${r.st}) still`);
        }
        await shot(`n4_w${w}_reduced`);
      }
      await p.emulateMedia({ reducedMotion: "no-preference" });
    });

    await check("B7 [1440] WORK: only the working (scene) Piggy leaves its ambient pose; the others stay", async () => {
      await atWidth(1440, 900);
      const g0 = await living();
      const seatId = g0.res.find((r) => r.seat)?.id;
      assert.ok(seatId);
      const sp = (list, skip) => list.filter((r) => !skip.includes(r.id)).map((r) => `${r.id}:${r.st}@${r.ph}`).sort();
      await p.evaluate(() => window.__arasoScene("explore", { secondJourneyPreview: true })); await sleep(2500);
      const g1 = await living();
      assert.equal(g1.res.some((r) => r.id === seatId), false, "working Piggy has no ambient copy");
      assert.equal(g1.seatHidden, false, "seat belongs to the work pose again");
      const others = g0.res.filter((r) => r.id !== seatId).map((r) => `${r.id}@${r.slot}:${r.st}`).sort();
      assert.deepEqual(g1.res.map((r) => `${r.id}@${r.slot}:${r.st}`).sort(), others, "other Piggies keep slot + motion");
      // [F1] ... and keep their phase (the ambient projection of the others is not recomputed).
      assert.deepEqual(sp(g1.res, [seatId]), sp(g0.res, [seatId]), "other Piggies keep state + phase (1 Piggy working)");
      await shot("n4_w1440_work");
      // [F1] A second Piggy leaves too (its own registry location → away): the rest still keep state + phase.
      const leaver = g1.res.find((r) => r.id !== seatId)?.id;
      assert.ok(leaver);
      const saved = await p.evaluate((id) => {
        const key = Object.keys(localStorage).find((k) => k.startsWith("araso.piggyRegistry.") && (localStorage.getItem(k) || "").includes(`"${id}"`));
        if (!key) return null;
        const raw = localStorage.getItem(key);
        const reg = JSON.parse(raw);
        const row = reg.piggies.find((r) => r.id === id);
        if (!row) return null;
        row.location = "away";
        localStorage.setItem(key, JSON.stringify(reg));
        dispatchEvent(new Event("resize"));
        return { key, raw };
      }, leaver);
      assert.ok(saved, "second Piggy found in the local registry");
      await sleep(1500);
      const g2 = await living();
      try {
        assert.equal(g2.res.some((r) => r.id === leaver), false, "away Piggy has no ambient copy");
        assert.ok(g2.res.length >= 1);
        assert.deepEqual(sp(g2.res, [seatId, leaver]), sp(g0.res, [seatId, leaver]), "remaining Piggies keep state + phase (2 Piggies gone)");
      } finally {
        await p.evaluate((s) => { localStorage.setItem(s.key, s.raw); dispatchEvent(new Event("resize")); }, saved);
        await sleep(1200);
      }
      const g3 = await living();
      assert.deepEqual(sp(g3.res, [seatId]), sp(g0.res, [seatId]), "leaver back home: same projection as before (same cycle)");
    });

    await check("B8 AWAY/RETURN: no ambient Home copy during the trip; a genuine Home re-entry starts a new Home-life cycle", async () => {
      const before = (await living()).nonce;
      const step2 = () => p.evaluate(() => document.querySelector("#exploreForm") ? "interests" : document.querySelector(".secondJourney__jitBtn") ? "jit" : document.querySelector("#secondSendButton") ? "readiness" : document.querySelector(".secondJourney__pick") ? "candidates" : null);
      let s2 = await step2();
      if (s2 === "interests") { await realClick(".secondJourney__item", 0); await sleep(250); await realClick("#exploreSaveButton"); await sleep(2400); s2 = await step2(); }
      if (s2 === "candidates") {
        const first = await p.evaluate(() => [...document.querySelectorAll(".secondJourney__pick")].find((b) => !b.disabled && !b.hidden)?.dataset.destinationId);
        await realClick(`.secondJourney__pick[data-destination-id="${first}"]`); await sleep(400);
        await realClick("#secondOkButton"); await sleep(900);
        if ((await step2()) === "jit") { await realClick(".secondJourney__jitBtn", 0); await sleep(900); }
      }
      if (await p.locator("#secondAmount").count()) { await p.locator("#secondAmount").fill("1"); await sleep(400); }
      await mustTap("#secondSendButton", "second send");
      assert.equal(await waitScene(["secondAway"], 6000), "secondAway");
      const away = await living();
      assert.equal(away.layer, null, "away: no living copy"); assert.equal(away.res.length, 0);
      await waitScene(["secondReturn"], 45000);
      const ret = await living();
      assert.equal(ret.res.length, 0, "return: no living copy");
      for (let t0 = Date.now(); Date.now() - t0 < 60000;) {
        if ((await scene()) !== "secondReturn") break;
        const v = await p.evaluate(() => { const ok = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && !e.disabled && e.getBoundingClientRect().width > 0; }; return { open: ok("returnOpen"), tap: ok("returnTap") }; });
        if (v.open) { if ((await realClick("#returnOpen")) !== "pointer") await p.evaluate(() => document.getElementById("returnOpen").click()); await sleep(900); continue; }
        if (v.tap) { if ((await realClick("#returnTap")) !== "pointer") await p.evaluate(() => document.getElementById("returnTap").click()); await sleep(1200); continue; }
        await sleep(250);
      }
      await waitScene(["sendstay"], 15000); await sleep(4500);
      const back = await living();
      assert.ok(back.layer && back.res.length >= 2, `back home: residents on Home again ${await scene()} ${JSON.stringify(back)}`);
      assert.notEqual(back.nonce, before, "genuine re-entry → new Home-life cycle");
    });

    await check("B9 whole run: pageerror 0, broken motion asset 0, tx 0, credentials.create 0", async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(assetBad, []);
      assert.equal(net.tx, 0);
      assert.equal((await p.evaluate(() => window.__wa)).create, 0);
    });
  } catch (e) {
    await check("B! browser run", () => { throw e; });
  } finally {
    await context.close();
  }
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
